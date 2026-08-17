import {
	addScaled,
	dot,
	gramMatrix,
	independentBasis,
	pseudoInverseSolveSymmetric,
	weightedNorm
} from '../linear-algebra';
import { solveNonnegativeLeastSquares } from '../nonnegative-qp';
import {
	solveTerminatingElasticReflections,
	type TerminatingElasticReflectionEndpoint
} from '../terminating-elastic-reflections';
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
	const endpoint = solveSupportCompatibleEndpoint(
		problem,
		equalityBasis,
		incoming.velocity,
		tolerance
	);
	if (typeof endpoint === 'string') return endpoint;
	const decomposition = decomposeMomentum(problem, endpoint.velocity, equalityBasis, tolerance);
	if (typeof decomposition === 'string') return decomposition;
	return {
		finalMassNormalisedVelocity: endpoint.velocity,
		impactImpulses: decomposition.impactImpulses,
		equalityReactions: decomposition.equalityReactions,
		projectionCorrectionNorm: incoming.correctionNorm,
		momentumResidualNorm: decomposition.residualNorm,
		reflectionCount: endpoint.reflections.length
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

function solveSupportCompatibleEndpoint(
	problem: PreparedLowSpeedProblem,
	equalityBasis: readonly (readonly number[])[],
	initialVelocity: readonly number[],
	tolerance: number
): TerminatingElasticReflectionEndpoint | string {
	const incomingFloor = tolerance * Math.max(1, ...problem.velocity.map(Math.abs)) * 32;
	const incomingSpeeds = problem.impactIndices.flatMap((index) => {
		const contact = problem.input.contacts[index]!;
		const speed = -dot(problem.contactGradients[index]!, problem.velocity);
		return contact.type === 'body-body' && speed > incomingFloor ? [speed] : [];
	});
	if (incomingSpeeds.length === 0) {
		return 'The low-speed elastic phase has no genuinely incoming non-support impact contact.';
	}
	const impactSpeed = Math.max(...incomingSpeeds);
	if (impactSpeed > LOW_SPEED_ELASTIC_IMPACT + incomingFloor) {
		return 'The incoming non-support impact speed exceeds the low-speed elastic boundary.';
	}
	const supportCompatibleImpactGradients = problem.impactIndices.map((index) =>
		project(problem.massNormalisedContactGradients[index]!, equalityBasis)
	);
	// Mass-normalised coordinates carry the kinetic metric as the identity.
	const unitMasses = Array.from({ length: initialVelocity.length }, () => 1);
	return solveTerminatingElasticReflections({
		velocity: initialVelocity,
		masses: unitMasses,
		inverseMasses: unitMasses,
		gradients: supportCompatibleImpactGradients,
		tolerances: {
			numerical: tolerance,
			absoluteNormalVelocityFloor: problem.input.tolerances.absoluteNormalVelocityFloor,
			relativeViolationEpsilon: problem.input.tolerances.relativeViolationEpsilon,
			maximumReflections: problem.input.tolerances.maximumReflections
		}
	});
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
