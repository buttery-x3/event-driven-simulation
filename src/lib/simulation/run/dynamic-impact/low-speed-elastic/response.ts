import type { Vec2 } from '../../../contracts';
import { addScaled, dot } from '../linear-algebra';
import {
	anchoredCoordinateLocks,
	effectiveLowSpeedTolerance,
	prepareLowSpeedProblem,
	type EqualityConstraint,
	type PreparedLowSpeedProblem
} from './problem';
import {
	LOW_SPEED_ELASTIC_IMPACT,
	solveConstrainedElastic,
	type ConstrainedElasticSolution
} from './solver';
import type {
	AnchoredCoordinateReaction,
	AnchoredElasticFallbackInput,
	LowSpeedElasticInput,
	LowSpeedElasticResponse,
	LowSpeedElasticResult
} from './types';

export { LOW_SPEED_ELASTIC_IMPACT };

export function resolveSupportPreservingElasticResponse(
	input: LowSpeedElasticInput
): LowSpeedElasticResult {
	return resolve(input, []);
}

export function resolveAnchoredComponentElasticFallback(
	input: AnchoredElasticFallbackInput
): LowSpeedElasticResult {
	const locks = anchoredCoordinateLocks(input);
	return typeof locks === 'string' ? rejected(locks) : resolve(input, locks);
}

function resolve(
	input: LowSpeedElasticInput,
	locks: readonly EqualityConstraint[]
): LowSpeedElasticResult {
	const problem = prepareLowSpeedProblem(input, locks);
	if (typeof problem === 'string') return rejected(problem);
	const tolerance = effectiveLowSpeedTolerance(input);
	const solution = solveConstrainedElastic(problem, tolerance);
	if (typeof solution === 'string') return rejected(solution);
	const response = certifyResponse(problem, solution, tolerance);
	return typeof response === 'string' ? rejected(response) : { type: 'response', response };
}

function certifyResponse(
	problem: PreparedLowSpeedProblem,
	solution: ConstrainedElasticSolution,
	tolerance: number
): LowSpeedElasticResponse | string {
	const finalVelocity = solution.finalMassNormalisedVelocity.map(
		(value, index) => value / problem.squareRootMasses[index]!
	);
	const preNormal = problem.contactGradients.map((gradient) => dot(gradient, problem.velocity));
	const postNormal = problem.contactGradients.map((gradient) => dot(gradient, finalVelocity));
	const maximumPreSupportViolation = maximumSupportViolation(problem, preNormal);
	const maximumPostSupportViolation = maximumSupportViolation(problem, postNormal);
	const maximumPostImpactViolation = Math.max(
		0,
		...problem.impactIndices.map((index) => -postNormal[index]!)
	);
	const velocityScale = Math.max(
		1,
		...problem.velocity.map(Math.abs),
		...finalVelocity.map(Math.abs)
	);
	if (maximumPostSupportViolation > tolerance * velocityScale * 128) {
		return 'The elastic endpoint violates an authoritative support equality.';
	}
	if (maximumPostImpactViolation > tolerance * velocityScale * 128) {
		return 'The elastic endpoint leaves a unilateral impact contact incoming.';
	}
	const kineticEnergyBefore = kineticEnergy(problem.velocity, problem.masses);
	const kineticEnergyAfter = kineticEnergy(finalVelocity, problem.masses);
	const energyError = Math.abs(kineticEnergyAfter - kineticEnergyBefore);
	if (energyError > tolerance * Math.max(1, kineticEnergyBefore) * 256) {
		return 'The constrained elastic endpoint does not preserve kinetic energy.';
	}
	const momentumResidualNorm = physicalMomentumResidual(problem, solution, finalVelocity);
	const momentumScale = Math.max(
		1,
		...problem.masses.map((mass, index) =>
			Math.abs(mass * (finalVelocity[index]! - problem.velocity[index]!))
		)
	);
	if (momentumResidualNorm > tolerance * momentumScale * 512) {
		return 'The declared impact impulses and signed equality reactions do not reconstruct momentum.';
	}
	const supportReactions = problem.equalities.flatMap((equality, index) =>
		equality.source.type === 'support-contact'
			? [
					{
						contactId: equality.source.contactId,
						multiplier: solution.equalityReactions[index]!
					}
				]
			: []
	);
	const lockReactions: AnchoredCoordinateReaction[] = problem.equalities.flatMap(
		(equality, index) =>
			equality.source.type === 'anchored-coordinate'
				? [
						{
							componentId: equality.source.componentId,
							bodyId: equality.source.bodyId,
							axis: equality.source.axis,
							multiplier: solution.equalityReactions[index]!
						}
					]
				: []
	);
	const impactSpeed = Math.max(
		0,
		...problem.impactIndices.map((index) => Math.max(0, -preNormal[index]!))
	);
	return {
		bodyVelocities: problem.input.bodies.map((body, index) => ({
			bodyId: body.id,
			velocity: [
				normalize(finalVelocity[index * 2]!, tolerance * velocityScale * 64),
				normalize(finalVelocity[index * 2 + 1]!, tolerance * velocityScale * 64)
			] as Vec2
		})),
		contacts: problem.input.contacts.map((contact, index) => ({
			contactId: contact.id,
			role: problem.supportIndices.includes(index) ? 'support-constraint' : 'impact',
			preImpactNormalVelocity: preNormal[index]!,
			postImpactNormalVelocity: postNormal[index]!
		})),
		impactImpulses: problem.impactIndices.map((contactIndex, index) => ({
			contactId: problem.input.contacts[contactIndex]!.id,
			impulse: solution.impactImpulses[index]!
		})),
		supportReactions,
		lockReactions,
		preImpactVelocity: problem.velocity,
		finalVelocity,
		certification: {
			impactSpeed,
			maximumPreSupportViolation,
			maximumPostSupportViolation,
			maximumPostImpactViolation,
			incomingProjectionCorrectionNorm: solution.projectionCorrectionNorm,
			kineticEnergyBefore,
			kineticEnergyAfter,
			energyError,
			momentumResidualNorm,
			reflectionCount: solution.reflectionCount
		}
	};
}

function physicalMomentumResidual(
	problem: PreparedLowSpeedProblem,
	solution: ConstrainedElasticSolution,
	finalVelocity: readonly number[]
): number {
	const target = finalVelocity.map(
		(value, index) => problem.masses[index]! * (value - problem.velocity[index]!)
	);
	let reconstructed = Array.from({ length: target.length }, () => 0);
	for (let index = 0; index < problem.impactIndices.length; index += 1) {
		reconstructed = addScaled(
			reconstructed,
			problem.contactGradients[problem.impactIndices[index]!]!,
			solution.impactImpulses[index]!
		);
	}
	for (let index = 0; index < problem.equalities.length; index += 1) {
		reconstructed = addScaled(
			reconstructed,
			problem.equalities[index]!.gradient,
			solution.equalityReactions[index]!
		);
	}
	return Math.sqrt(
		dot(
			target.map((value, index) => value - reconstructed[index]!),
			target.map((value, index) => value - reconstructed[index]!)
		)
	);
}

function maximumSupportViolation(
	problem: PreparedLowSpeedProblem,
	normalVelocities: readonly number[]
): number {
	return Math.max(0, ...problem.supportIndices.map((index) => Math.abs(normalVelocities[index]!)));
}

function kineticEnergy(velocity: readonly number[], masses: readonly number[]): number {
	return 0.5 * velocity.reduce((sum, value, index) => sum + masses[index]! * value * value, 0);
}

function normalize(value: number, tolerance: number): number {
	return Math.abs(value) <= tolerance ? 0 : value;
}

function rejected(reason: string): LowSpeedElasticResult {
	return { type: 'rejected', reason };
}
