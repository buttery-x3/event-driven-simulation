import {
	addScaled,
	dot,
	gramMatrix,
	independentBasis,
	pseudoInverseSolveSymmetric,
	weightedNorm
} from '../linear-algebra';
import { solveNonnegativeLeastSquares, solveNonnegativeQuadratic } from '../nonnegative-qp';
import type { PreparedLowSpeedProblem } from './problem';

export const LOW_SPEED_ELASTIC_IMPACT = 0.05;

export interface ConstrainedElasticSolution {
	readonly finalMassNormalisedVelocity: readonly number[];
	readonly impactImpulses: readonly number[];
	readonly equalityReactions: readonly number[];
	readonly projectionCorrectionNorm: number;
	readonly momentumResidualNorm: number;
	readonly reflectionCount: number;
}

interface ElasticEndpoint {
	readonly velocity: readonly number[];
	readonly reflectionCount: number;
}

export function solveConstrainedElastic(
	problem: PreparedLowSpeedProblem,
	tolerance: number
): ConstrainedElasticSolution | string {
	const equalityBasis = independentBasis(
		problem.equalities.map(({ massNormalisedGradient }) => massNormalisedGradient),
		tolerance * 16
	);
	const incoming = certifyIncomingCompatibility(problem, equalityBasis, tolerance);
	if (typeof incoming === 'string') return incoming;
	const endpoint = solveElastic(problem, equalityBasis, incoming.velocity, tolerance);
	if (typeof endpoint === 'string') return endpoint;
	const decomposition = decomposeMomentum(problem, endpoint.velocity, equalityBasis, tolerance);
	if (typeof decomposition === 'string') return decomposition;
	return {
		finalMassNormalisedVelocity: endpoint.velocity,
		impactImpulses: decomposition.impactImpulses,
		equalityReactions: decomposition.equalityReactions,
		projectionCorrectionNorm: incoming.correctionNorm,
		momentumResidualNorm: decomposition.residualNorm,
		reflectionCount: endpoint.reflectionCount
	};
}

function certifyIncomingCompatibility(
	problem: PreparedLowSpeedProblem,
	equalityBasis: readonly (readonly number[])[],
	tolerance: number
): { readonly velocity: readonly number[]; readonly correctionNorm: number } | string {
	const scale = Math.max(1, weightedNorm(problem.velocity, problem.masses));
	const compatibilityTolerance = tolerance * scale * 64;
	const violations = problem.equalities.map(({ gradient }) =>
		Math.abs(dot(gradient, problem.velocity))
	);
	if (violations.some((value) => value > compatibilityTolerance)) {
		return 'The pre-impact state is inconsistent with authoritative support or anchored-component equalities.';
	}
	const projected = project(problem.massNormalisedVelocity, equalityBasis);
	const delta = projected.map((value, index) => value - problem.massNormalisedVelocity[index]!);
	const correctionNorm = Math.sqrt(dot(delta, delta));
	if (
		correctionNorm >
		tolerance * Math.max(1, weightedNorm(problem.velocity, problem.masses)) * 128
	) {
		return 'The support-compatible projection would materially alter the pre-impact state.';
	}
	return { velocity: projected, correctionNorm };
}

function solveElastic(
	problem: PreparedLowSpeedProblem,
	equalityBasis: readonly (readonly number[])[],
	initialVelocity: readonly number[],
	tolerance: number
): ElasticEndpoint | string {
	const projectedImpacts = problem.impactIndices.map((index) => {
		const gradient = project(problem.massNormalisedContactGradients[index]!, equalityBasis);
		const length = Math.sqrt(dot(gradient, gradient));
		return {
			index,
			direction: length > tolerance * 16 ? gradient.map((value) => value / length) : null
		};
	});
	const impactSpeed = Math.max(
		0,
		...problem.impactIndices.map(
			(index) => -dot(problem.contactGradients[index]!, problem.velocity)
		)
	);
	const incomingFloor = tolerance * Math.max(1, ...problem.velocity.map(Math.abs)) * 32;
	if (
		!problem.impactIndices.some(
			(index) => dot(problem.contactGradients[index]!, problem.velocity) < -incomingFloor
		)
	) {
		return 'The low-speed elastic phase has no genuinely incoming non-support impact contact.';
	}
	if (impactSpeed > LOW_SPEED_ELASTIC_IMPACT + incomingFloor) {
		return 'The incoming non-support impact speed exceeds the low-speed elastic boundary.';
	}
	const initialNorm = Math.sqrt(dot(initialVelocity, initialVelocity));
	const threshold = Math.max(
		problem.input.tolerances.absoluteNormalVelocityFloor,
		problem.input.tolerances.relativeViolationEpsilon * initialNorm
	);
	let velocity = [...initialVelocity];
	for (
		let reflectionCount = 0;
		reflectionCount < problem.input.tolerances.maximumReflections;
		reflectionCount += 1
	) {
		const violating = projectedImpacts.filter(
			(item) => item.direction && dot(item.direction, velocity) < -threshold
		);
		if (violating.length === 0) {
			const maximumViolation = Math.max(
				0,
				...problem.impactIndices.map(
					(index) => -dot(problem.massNormalisedContactGradients[index]!, velocity)
				)
			);
			if (maximumViolation > threshold * 16) {
				return 'The reduced elastic response did not imply complete impact feasibility.';
			}
			return { velocity, reflectionCount };
		}
		const directions = violating.map(({ direction }) => direction!);
		const solution = solveNonnegativeQuadratic(
			gramMatrix(directions),
			directions.map((direction) => 2 * dot(direction, velocity)),
			tolerance
		);
		if (!solution || solution.values.every((value) => value <= tolerance)) {
			return 'A violating impact subset could not be modified by a non-negative reflection.';
		}
		let tentative = [...velocity];
		for (let index = 0; index < directions.length; index += 1) {
			tentative = addScaled(tentative, directions[index]!, solution.values[index]!);
		}
		const tentativeNorm = Math.sqrt(dot(tentative, tentative));
		if (
			!Number.isFinite(tentativeNorm) ||
			(initialNorm > tolerance && tentativeNorm <= tolerance)
		) {
			return 'Elastic energy renormalisation was undefined.';
		}
		const factor = tentativeNorm > tolerance ? initialNorm / tentativeNorm : 1;
		velocity = tentative.map((value) => value * factor);
		if (!velocity.every(Number.isFinite))
			return 'The elastic reflection produced non-finite velocity.';
	}
	return 'The support-constrained elastic reflection cap was reached.';
}

function decomposeMomentum(
	problem: PreparedLowSpeedProblem,
	finalVelocity: readonly number[],
	equalityBasis: readonly (readonly number[])[],
	tolerance: number
):
	| {
			readonly impactImpulses: readonly number[];
			readonly equalityReactions: readonly number[];
			readonly residualNorm: number;
	  }
	| string {
	const target = finalVelocity.map(
		(value, index) => value - problem.massNormalisedVelocity[index]!
	);
	const impactColumns = problem.impactIndices.map((index) =>
		project(problem.massNormalisedContactGradients[index]!, equalityBasis)
	);
	const projectedTarget = project(target, equalityBasis);
	const impact = solveNonnegativeLeastSquares(impactColumns, projectedTarget, tolerance);
	const scale = Math.max(1, Math.sqrt(dot(target, target)));
	if (!impact || impact.residualNorm > tolerance * scale * 256) {
		return 'The elastic endpoint has no certified non-negative impact-impulse decomposition.';
	}
	let equalityTarget = [...target];
	for (let index = 0; index < problem.impactIndices.length; index += 1) {
		equalityTarget = addScaled(
			equalityTarget,
			problem.massNormalisedContactGradients[problem.impactIndices[index]!]!,
			-impact.values[index]!
		);
	}
	const equalityColumns = problem.equalities.map(
		({ massNormalisedGradient }) => massNormalisedGradient
	);
	const reactions = signedLeastSquares(equalityColumns, equalityTarget, tolerance);
	if (!reactions) return 'The bilateral support and lock reactions could not be solved.';
	let reconstructed = Array.from({ length: target.length }, () => 0);
	for (let index = 0; index < problem.impactIndices.length; index += 1) {
		reconstructed = addScaled(
			reconstructed,
			problem.massNormalisedContactGradients[problem.impactIndices[index]!]!,
			impact.values[index]!
		);
	}
	for (let index = 0; index < equalityColumns.length; index += 1) {
		reconstructed = addScaled(reconstructed, equalityColumns[index]!, reactions[index]!);
	}
	const residual = reconstructed.map((value, index) => value - target[index]!);
	const residualNorm = Math.sqrt(dot(residual, residual));
	if (residualNorm > tolerance * scale * 512) {
		return 'The constrained momentum decomposition residual exceeds tolerance.';
	}
	return { impactImpulses: impact.values, equalityReactions: reactions, residualNorm };
}

function signedLeastSquares(
	columns: readonly (readonly number[])[],
	target: readonly number[],
	tolerance: number
): readonly number[] | null {
	if (columns.length === 0) return Math.sqrt(dot(target, target)) <= tolerance ? [] : null;
	return pseudoInverseSolveSymmetric(
		gramMatrix(columns),
		columns.map((column) => dot(column, target)),
		tolerance
	);
}

function project(vector: readonly number[], basis: readonly (readonly number[])[]): number[] {
	let result = [...vector];
	for (const direction of basis) result = addScaled(result, direction, -dot(direction, result));
	return result;
}
