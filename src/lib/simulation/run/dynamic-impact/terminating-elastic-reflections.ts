import { addScaled, dot, gramMatrix, weightedNorm } from './linear-algebra';
import { detectLineality, projectEqualityCompatible } from './lineality';
import { solveNonnegativeQuadratic } from './nonnegative-qp';

export interface TerminatingElasticReflectionProblem {
	readonly velocity: readonly number[];
	readonly masses: readonly number[];
	readonly inverseMasses: readonly number[];
	readonly gradients: readonly (readonly number[])[];
	readonly tolerances: {
		readonly numerical: number;
		readonly absoluteNormalVelocityFloor: number;
		readonly relativeViolationEpsilon: number;
		readonly maximumReflections: number;
	};
}

export interface ElasticReflectionTrace {
	readonly iteration: number;
	readonly violatingGradientIndices: readonly number[];
	readonly impulse: readonly number[];
	readonly velocityBefore: readonly number[];
	readonly tentativeVelocity: readonly number[];
	readonly velocityAfter: readonly number[];
	readonly energyBefore: number;
	readonly energyAfterTentative: number;
	readonly energyAfterRenormalisation: number;
	readonly energyRenormalisationFactor: number;
	readonly maximumSignificantViolationBefore: number;
	readonly maximumSignificantViolationAfter: number;
	readonly checks: {
		readonly norm: boolean;
		readonly kin: boolean;
		readonly one: boolean;
		readonly vio: boolean;
		readonly mod: boolean;
	};
}

export interface TerminatingElasticReflectionEndpoint {
	readonly velocity: readonly number[];
	readonly projectedVelocity: readonly number[];
	readonly projectedGradients: readonly (readonly number[])[];
	readonly removedGradientIndices: readonly number[];
	readonly linealityGradientIndices: readonly number[];
	readonly equalityBasis: readonly (readonly number[])[];
	readonly violationThreshold: number;
	readonly reflections: readonly ElasticReflectionTrace[];
}

export function solveTerminatingElasticReflections(
	problem: TerminatingElasticReflectionProblem
): TerminatingElasticReflectionEndpoint | string {
	const tolerance = problem.tolerances.numerical;
	const lineality = detectLineality(problem.gradients, tolerance);
	const projectedVelocity = projectEqualityCompatible(
		problem.velocity,
		lineality.basis,
		problem.inverseMasses,
		tolerance
	);
	if (!projectedVelocity)
		return 'impact-termination-certification-failed: anti-locking projection failed.';
	const projected: { readonly index: number; readonly gradient: readonly number[] }[] = [];
	const removedGradientIndices: number[] = [];
	for (let index = 0; index < problem.gradients.length; index += 1) {
		const gradient = projectEqualityCompatible(
			problem.gradients[index]!,
			lineality.basis,
			problem.inverseMasses,
			tolerance
		);
		if (!gradient) return 'impact-termination-certification-failed: contact projection failed.';
		const norm = weightedNorm(gradient, problem.inverseMasses);
		if (norm <= tolerance * 16) removedGradientIndices.push(index);
		else projected.push({ index, gradient: gradient.map((value) => value / norm) });
	}
	let velocity = [...projectedVelocity];
	const initialNorm = weightedNorm(projectedVelocity, problem.masses);
	const violationThreshold = Math.max(
		problem.tolerances.absoluteNormalVelocityFloor,
		problem.tolerances.relativeViolationEpsilon * initialNorm
	);
	const reflections: ElasticReflectionTrace[] = [];
	for (let iteration = 0; iteration < problem.tolerances.maximumReflections; iteration += 1) {
		const violating = projected.filter(
			({ gradient }) => dot(gradient, velocity) < -violationThreshold
		);
		if (violating.length === 0) {
			if (
				normalVelocities(problem.gradients, velocity).some(
					(value) => value < -violationThreshold * 16
				)
			)
				return 'impact-termination-certification-failed: reduced feasibility did not imply complete feasibility.';
			return {
				velocity,
				projectedVelocity,
				projectedGradients: projected.map(({ gradient }) => gradient),
				removedGradientIndices,
				linealityGradientIndices: lineality.contactIndices,
				equalityBasis: lineality.basis,
				violationThreshold,
				reflections
			};
		}
		const gradients = violating.map(({ gradient }) => gradient);
		const hessian = gramMatrix(gradients, problem.inverseMasses);
		const linear = gradients.map((gradient) => 2 * dot(gradient, velocity));
		const solution = solveNonnegativeQuadratic(hessian, linear, tolerance);
		if (!solution || solution.values.every((value) => value <= tolerance))
			return 'impact-termination-certification-failed: a violating subset was not materially modified.';
		let tentativeMomentum = velocity.map((value, index) => problem.masses[index]! * value);
		for (let index = 0; index < gradients.length; index += 1)
			tentativeMomentum = addScaled(tentativeMomentum, gradients[index]!, solution.values[index]!);
		const tentativeVelocity = tentativeMomentum.map(
			(value, index) => value * problem.inverseMasses[index]!
		);
		const tentativeNorm = weightedNorm(tentativeVelocity, problem.masses);
		if (!Number.isFinite(tentativeNorm) || (initialNorm > tolerance && tentativeNorm <= tolerance))
			return 'impact-termination-certification-failed: elastic energy renormalisation was undefined.';
		const factor = tentativeNorm > tolerance ? initialNorm / tentativeNorm : 1;
		const next = tentativeVelocity.map((value) => value * factor);
		const beforeViolation = maximumViolation(projected, velocity);
		const afterViolation = maximumViolation(projected, next);
		const energyBefore = kineticEnergy(velocity, problem.masses);
		const energyAfterTentative = kineticEnergy(tentativeVelocity, problem.masses);
		const energyAfter = kineticEnergy(next, problem.masses);
		const modification = weightedNorm(
			next.map((value, index) => value - velocity[index]!),
			problem.masses
		);
		const checks = {
			norm: true,
			kin: Math.abs(energyAfter - energyBefore) <= tolerance * Math.max(1, energyBefore) * 64,
			one: solution.values.every((value) => value >= -tolerance),
			vio: violating.every(({ gradient }) => dot(gradient, velocity) < -violationThreshold),
			mod: modification > tolerance
		};
		reflections.push({
			iteration,
			violatingGradientIndices: violating.map(({ index }) => index),
			impulse: solution.values,
			velocityBefore: velocity,
			tentativeVelocity,
			velocityAfter: next,
			energyBefore,
			energyAfterTentative,
			energyAfterRenormalisation: energyAfter,
			energyRenormalisationFactor: factor,
			maximumSignificantViolationBefore: beforeViolation,
			maximumSignificantViolationAfter: afterViolation,
			checks
		});
		if (!Object.values(checks).every(Boolean))
			return 'impact-termination-certification-failed: a reflection invariant failed.';
		velocity = next;
	}
	return 'impact-termination-certification-failed: defensive reflection cap reached.';
}

function normalVelocities(
	gradients: readonly (readonly number[])[],
	velocity: readonly number[]
): number[] {
	return gradients.map((gradient) => dot(gradient, velocity));
}

function maximumViolation(
	projected: readonly { readonly gradient: readonly number[] }[],
	velocity: readonly number[]
): number {
	return Math.max(0, ...projected.map(({ gradient }) => -dot(gradient, velocity)));
}

function kineticEnergy(velocity: readonly number[], masses: readonly number[]): number {
	return 0.5 * velocity.reduce((sum, value, index) => sum + masses[index]! * value * value, 0);
}
