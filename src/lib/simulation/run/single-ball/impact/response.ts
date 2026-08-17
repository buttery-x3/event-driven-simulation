import type {
	ContactCaptureDiagnostic,
	ContactManifoldMember,
	SimulationInput,
	Vec2
} from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { dotVec2 } from '../../../math';
import { fixedContactId } from '../../contact-resolution';
import { selectContactCapture, type ContactCaptureEndpoint } from '../../dynamic-impact';
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
		'zero-restitution' | 'initial-supported-state' | 'finite-contact-capture' | null;
	readonly contactCapture: ContactCaptureDiagnostic;
}

export function resolveImpactResponse(
	input: SimulationInput,
	time: number,
	candidates: readonly FixedWorldContactCandidate[],
	incomingVelocity: Vec2
): ImpactResponse | null {
	const tolerance = input.settings.tolerances.eventTime;
	const ordinary = solveImpactManifold(
		candidates,
		incomingVelocity,
		input.settings.restitution,
		tolerance
	);
	const inelastic = solveImpactManifold(candidates, incomingVelocity, 0, tolerance);
	if (!ordinary) return null;
	if (!inelastic) return ordinaryOnlyResponse(input, candidates, ordinary);
	const ids = candidates.map(fixedContactId);
	const selected = selectContactCapture({
		bodies: [
			{
				id: candidates[0]!.bodyId,
				mass: input.initialDynamicBodies.find(({ id }) => id === candidates[0]!.bodyId)!.mass,
				incomingVelocity,
				freeAcceleration: input.settings.gravity
			}
		],
		contacts: candidates.map((candidate) => ({
			id: fixedContactId(candidate),
			type: 'body-fixed' as const,
			bodyId: candidate.bodyId,
			normal: candidate.normal,
			curvatureRadius: curvatureRadius(input, candidate)
		})),
		ordinary: endpoint(candidates, ordinary.outgoingVelocity, ordinary.contacts),
		inelastic: endpoint(candidates, inelastic.outgoingVelocity, inelastic.contacts),
		contactCaptureDistance: input.settings.contactCaptureDistance,
		numericalTolerance: tolerance,
		solveInelastic: (contactIds) => {
			const retained = candidates.filter((candidate) =>
				contactIds.includes(fixedContactId(candidate))
			);
			const result = solveImpactManifold(retained, incomingVelocity, 0, tolerance);
			return result ? endpoint(retained, result.outgoingVelocity, result.contacts) : null;
		}
	});
	const selectedVelocity = selected.endpoint.bodyVelocities[0]!.velocity;
	const selectedById = new Map(
		selected.endpoint.contacts.map((contact) => [contact.contactId, contact])
	);
	const ordinaryById = new Map(ordinary.contacts.map((contact, index) => [ids[index]!, contact]));
	const retained = new Set(selected.diagnostic.retainedContactIds);
	const activeCandidates = candidates.filter((candidate) =>
		retained.has(fixedContactId(candidate))
	);
	const contacts = candidates.map((candidate) => {
		const id = fixedContactId(candidate);
		const result = selectedById.get(id);
		return {
			...ordinaryById.get(id)!,
			postImpactNormalVelocity: normalizeZero(dotVec2(selectedVelocity, candidate.normal)),
			impulse: result?.impulse ?? 0
		};
	});
	const captured = selected.diagnostic.selectedEndpoint === 'captured';
	const incomingNormalSpeed = Math.max(
		0,
		...ordinary.contacts.map(({ preImpactNormalVelocity }) => -preImpactNormalVelocity)
	);
	const collapseReason: ImpactResponse['collapseReason'] = !captured
		? null
		: time === 0 && incomingNormalSpeed <= tolerance
			? 'initial-supported-state'
			: input.settings.restitution === 0
				? 'zero-restitution'
				: 'finite-contact-capture';
	return {
		outgoingVelocity: selectedVelocity,
		contacts,
		activeCandidates,
		enterSustainedContact: activeCandidates.length > 0,
		collapseReason,
		contactCapture: selected.diagnostic
	};
}

function ordinaryOnlyResponse(
	input: SimulationInput,
	candidates: readonly FixedWorldContactCandidate[],
	ordinary: NonNullable<ReturnType<typeof solveImpactManifold>>
): ImpactResponse {
	const tolerance = input.settings.tolerances.eventTime;
	const retained = candidates.filter(
		(_, index) => ordinary.contacts[index]!.postImpactNormalVelocity <= tolerance
	);
	const retainedIds = retained.map(fixedContactId);
	const retainedSet = new Set(retainedIds);
	return {
		outgoingVelocity: ordinary.outgoingVelocity,
		contacts: ordinary.contacts,
		activeCandidates: retained,
		enterSustainedContact: retained.length > 0,
		collapseReason: null,
		contactCapture: {
			captureDistance: input.settings.contactCaptureDistance,
			selectedEndpoint: 'ordinary',
			meaningfulReboundVeto: false,
			meaningfulReboundContactIds: [],
			activeSetRemovalSequence: [],
			retainedContactIds: retainedIds,
			releasedContactIds: candidates.map(fixedContactId).filter((id) => !retainedSet.has(id)),
			contacts: candidates.map((candidate, index) => ({
				contactId: fixedContactId(candidate),
				ordinaryPostImpactNormalVelocity: ordinary.contacts[index]!.postImpactNormalVelocity,
				geometricNormalAcceleration: geometricNormalAcceleration(
					input,
					candidate,
					ordinary.outgoingVelocity
				),
				pressingNormalAcceleration: null,
				reboundExcursion: null,
				withinCaptureDistance: null,
				impulsivelyActive: ordinary.contacts[index]!.impulse > tolerance,
				supportReaction: 0,
				retained: retainedSet.has(fixedContactId(candidate))
			}))
		}
	};
}

function endpoint(
	candidates: readonly FixedWorldContactCandidate[],
	velocity: Vec2,
	contacts: readonly ContactManifoldMember[]
): ContactCaptureEndpoint {
	return {
		bodyVelocities: [{ bodyId: candidates[0]!.bodyId, velocity }],
		contacts: contacts.map((contact, index) => ({
			contactId: fixedContactId(candidates[index]!),
			impulse: contact.impulse,
			preImpactNormalVelocity: contact.preImpactNormalVelocity,
			postImpactNormalVelocity: contact.postImpactNormalVelocity
		}))
	};
}

function curvatureRadius(
	input: SimulationInput,
	candidate: FixedWorldContactCandidate
): number | null {
	const body = input.initialDynamicBodies.find(({ id }) => id === candidate.bodyId)!;
	if (candidate.feature === 'start-endpoint' || candidate.feature === 'end-endpoint') {
		return body.physicalShape.radius;
	}
	if (candidate.feature !== 'circle') return null;
	const collider = input.scene.staticColliders.find(({ id }) => id === candidate.colliderId);
	return collider?.physicalShape.type === 'circle'
		? body.physicalShape.radius + collider.physicalShape.radius
		: null;
}

function geometricNormalAcceleration(
	input: SimulationInput,
	candidate: FixedWorldContactCandidate,
	velocity: Vec2
): number {
	const radius = curvatureRadius(input, candidate);
	if (radius === null) return 0;
	const normalSpeed = dotVec2(velocity, candidate.normal);
	return Math.max(0, dotVec2(velocity, velocity) - normalSpeed * normalSpeed) / radius;
}

function normalizeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
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

export function isContractingAlternatingImpactSequence(
	time: number,
	candidates: readonly FixedWorldContactCandidate[],
	history: readonly ImpactObservation[]
): boolean {
	if (candidates.length !== 1) return false;
	const current = candidates[0]!;
	const observations = [
		...history,
		{
			time,
			manifoldKey: contactManifoldKey(candidates),
			colliderIds: [current.colliderId],
			incomingNormalSpeed: Math.max(0, -current.normalVelocity)
		}
	].slice(-5);
	if (observations.length < 5 || observations.some(({ colliderIds }) => colliderIds.length !== 1)) {
		return false;
	}
	const keys = observations.map(({ manifoldKey }) => manifoldKey);
	if (keys[0] !== keys[2] || keys[2] !== keys[4] || keys[1] !== keys[3] || keys[0] === keys[1]) {
		return false;
	}
	const intervals = observations.slice(1).map((observation, index) => {
		return observation.time - observations[index]!.time;
	});
	return (
		intervals.every((interval) => interval > 0) &&
		intervals[3]! < intervals[0]! &&
		intervals.slice(1).filter((interval, index) => interval < intervals[index]!).length >= 2 &&
		observations[4]!.incomingNormalSpeed < observations[2]!.incomingNormalSpeed &&
		observations[3]!.incomingNormalSpeed < observations[1]!.incomingNormalSpeed
	);
}

function contactManifoldKey(candidates: readonly FixedWorldContactCandidate[]): string {
	return candidates
		.map(({ colliderId, feature }) => `${colliderId}:${feature}`)
		.sort()
		.join('|');
}
