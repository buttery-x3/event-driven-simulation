import type { ContactManifoldMember, SimulationInput, Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { dotVec2 } from '../../../math';
import { solveImpactManifold } from '../manifold';

export interface ImpactObservation {
	readonly manifoldKey: string;
	readonly colliderIds: readonly string[];
	readonly time: number;
	readonly incomingNormalSpeed: number;
}

export interface ImpactResponse {
	readonly outgoingVelocity: Vec2;
	readonly contacts: readonly ContactManifoldMember[];
	readonly activeCandidates: readonly FixedWorldContactCandidate[];
	readonly enterSustainedContact: boolean;
	readonly collapseReason:
		| 'zero-restitution'
		| 'contracting-impacts'
		| 'initial-supported-state'
		| 'sub-tolerance-release'
		| null;
	readonly releaseRetention: ReleaseRetentionEvidence | null;
}

export interface ReleaseRetentionEvidence {
	readonly colliderId: string;
	readonly outgoingNormalSpeed: number;
	readonly pressingNormalAcceleration: number;
	readonly maximumNormalSeparation: number;
	readonly contactDistanceTolerance: number;
}

export function resolveImpactResponse(
	input: SimulationInput,
	time: number,
	candidates: readonly FixedWorldContactCandidate[],
	incomingVelocity: Vec2,
	history: readonly ImpactObservation[]
): ImpactResponse | null {
	const tolerance = input.settings.tolerances.eventTime;
	const solution = solveImpactManifold(
		candidates,
		incomingVelocity,
		input.settings.restitution,
		tolerance
	);
	if (!solution) return null;
	const pressingAcceleration = Math.max(
		0,
		...candidates.map(({ normal }) => -dotVec2(input.settings.gravity, normal))
	);
	const incomingNormalSpeed = Math.max(
		0,
		...solution.contacts.map(({ preImpactNormalVelocity }) => -preImpactNormalVelocity)
	);
	const retainedConstraint = candidates.some(
		(candidate, index) =>
			candidate.response === 'non-impulsive-contact' &&
			Math.abs(solution.contacts[index]?.postImpactNormalVelocity ?? Infinity) <= tolerance &&
			dotVec2(input.settings.gravity, candidate.normal) < 0
	);
	if (pressingAcceleration <= 0) return response(solution, false, null);
	if (time === 0 && incomingNormalSpeed <= tolerance) {
		return response(solution, true, 'initial-supported-state');
	}
	if (input.settings.restitution === 0) return response(solution, true, 'zero-restitution');

	const releaseRetention = subToleranceReleaseEvidence(input, candidates, solution.contacts);
	if (releaseRetention) {
		return response(solution, true, 'sub-tolerance-release', releaseRetention);
	}

	const collapse = certifiesSameManifoldCollapse(
		input,
		time,
		candidates,
		incomingVelocity,
		incomingNormalSpeed,
		pressingAcceleration,
		history
	);
	if (collapse) return response(solution, true, 'contracting-impacts');

	return response(solution, retainedConstraint, null);
}

function certifiesSameManifoldCollapse(
	input: SimulationInput,
	time: number,
	candidates: readonly FixedWorldContactCandidate[],
	incomingVelocity: Vec2,
	incomingNormalSpeed: number,
	pressingAcceleration: number,
	history: readonly ImpactObservation[]
): boolean {
	const sameManifold = history
		.filter((observation) => observation.manifoldKey === contactManifoldKey(candidates))
		.slice(-2);
	if (sameManifold.length < 2) return false;
	const previous = sameManifold[1]!;
	const beforePrevious = sameManifold[0]!;
	const previousInterval = previous.time - beforePrevious.time;
	const currentInterval = time - previous.time;
	const tolerance = input.settings.tolerances.eventTime;
	const speedThreshold = Math.sqrt(
		2 * pressingAcceleration * input.settings.tolerances.contactDistance
	);
	const contracting =
		previousInterval > tolerance &&
		currentInterval > tolerance &&
		currentInterval < previousInterval &&
		incomingNormalSpeed < previous.incomingNormalSpeed;
	const ratio = contracting ? currentInterval / previousInterval : 1;
	const predictedRemainingTime = ratio < 1 ? (currentInterval * ratio) / (1 - ratio) : Infinity;
	const oneDimensional =
		candidates.length === 1 &&
		Math.abs(
			incomingVelocity[0] * -candidates[0]!.normal[1] +
				incomingVelocity[1] * candidates[0]!.normal[0]
		) <= speedThreshold;
	const nearbyWindow = Math.max(
		64 * tolerance,
		(oneDimensional ? 16 : 8) *
			Math.sqrt(input.settings.tolerances.contactDistance / pressingAcceleration)
	);
	return (
		contracting &&
		incomingNormalSpeed * input.settings.restitution <= 2 * speedThreshold &&
		predictedRemainingTime <= nearbyWindow
	);
}

export function impactObservation(
	candidates: readonly FixedWorldContactCandidate[],
	time: number,
	contacts: readonly ContactManifoldMember[]
): ImpactObservation {
	return {
		manifoldKey: contactManifoldKey(candidates),
		colliderIds: [...new Set(candidates.map(({ colliderId }) => colliderId))].sort(),
		time,
		incomingNormalSpeed: Math.max(
			0,
			...contacts.map(({ preImpactNormalVelocity }) => -preImpactNormalVelocity)
		)
	};
}

function response(
	solution: NonNullable<ReturnType<typeof solveImpactManifold>>,
	enterSustainedContact: boolean,
	collapseReason: ImpactResponse['collapseReason'],
	releaseRetention: ReleaseRetentionEvidence | null = null
): ImpactResponse {
	return { ...solution, enterSustainedContact, collapseReason, releaseRetention };
}

function subToleranceReleaseEvidence(
	input: SimulationInput,
	candidates: readonly FixedWorldContactCandidate[],
	contacts: readonly ContactManifoldMember[]
): ReleaseRetentionEvidence | null {
	if (candidates.length !== 1 || contacts.length !== 1) return null;
	const candidate = candidates[0]!;
	const outgoingNormalSpeed = contacts[0]!.postImpactNormalVelocity;
	const pressingNormalAcceleration = -dotVec2(input.settings.gravity, candidate.normal);
	if (outgoingNormalSpeed <= 0 || pressingNormalAcceleration <= 0) return null;
	const maximumNormalSeparation =
		(outgoingNormalSpeed * outgoingNormalSpeed) / (2 * pressingNormalAcceleration);
	return maximumNormalSeparation <= input.settings.tolerances.contactDistance
		? {
				colliderId: candidate.colliderId,
				outgoingNormalSpeed,
				pressingNormalAcceleration,
				maximumNormalSeparation,
				contactDistanceTolerance: input.settings.tolerances.contactDistance
			}
		: null;
}

function contactManifoldKey(candidates: readonly FixedWorldContactCandidate[]): string {
	return candidates
		.map(({ colliderId, feature }) => `${colliderId}:${feature}`)
		.sort()
		.join('|');
}
