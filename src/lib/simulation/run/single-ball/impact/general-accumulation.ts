import type {
	ContactEvent,
	InitialDynamicCircleBodyState,
	SimulationInput,
	Vec2
} from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import {
	certifyAccumulationLimit,
	physicalEventsFromImpactHistory,
	promoteSingleBodyAccumulation
} from '../../accumulation';
import type { RunAssembly } from '../run-assembly';
import { recordAccumulationEvidence, recordImpactEvidence } from './evidence';
import { resolveImpactResponse } from './response';
import type { ImpactResolution } from './types';

export function tryGeneralAccumulation(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	event: ContactEvent,
	candidates: readonly FixedWorldContactCandidate[],
	state: { readonly position: Vec2; readonly velocity: Vec2 },
	assembly: RunAssembly
): ImpactResolution | null {
	const physicalEvents = physicalEventsFromImpactHistory(assembly.impactHistory, {
		time: event.time,
		bodyId: body.id,
		mass: body.mass,
		radius: body.physicalShape.radius,
		position: state.position,
		velocity: state.velocity,
		candidates
	});
	const certified = certifyAccumulationLimit({
		simulation: input,
		events: physicalEvents,
		currentBodies: [
			{
				bodyId: body.id,
				mass: body.mass,
				radius: body.physicalShape.radius,
				position: state.position,
				velocity: state.velocity
			}
		],
		minimumEvents: 5
	});
	if (certified.type !== 'certified') return null;
	const limit = certified.limit;
	const promoted = promoteSingleBodyAccumulation(input, body, limit);
	if (!promoted) return null;

	assembly.impactSolves.push(promoted.impactDiagnostic);
	const observedResponse = resolveImpactResponse(
		input,
		event.time,
		candidates,
		state.velocity,
		assembly.impactHistory
	);
	if (!observedResponse) return null;

	recordImpactEvidence(
		assembly,
		body,
		{
			...event,
			contacts: observedResponse.contacts,
			preContactVelocity: state.velocity,
			postContactVelocity: observedResponse.outgoingVelocity
		},
		candidates,
		state.velocity,
		observedResponse,
		[],
		input.settings.tolerances.eventTime
	);

	const manifoldCandidates = promoted.activeCandidates;
	const retainedAfterImpact = manifoldCandidates.filter((candidate, index) => {
		const evidence = promoted.contacts[index];
		const pressing = dotGravity(input.settings.gravity, candidate.normal) < 0;
		return Boolean(
			evidence &&
			pressing &&
			Math.abs(evidence.postImpactNormalVelocity) <= input.settings.tolerances.eventTime
		);
	});
	const support = promoted.supportReactions;
	const supported = support !== null;
	const released =
		!supported &&
		(retainedAfterImpact.length === 0 ||
			Math.hypot(...promoted.outgoingVelocity) > input.settings.tolerances.eventTime);

	recordAccumulationEvidence(assembly, body, event.time, limit, {
		supported,
		released,
		impactSolveId: promoted.impactSolveId,
		linealityContactIds: promoted.linealityContactIds,
		outgoingVelocity: promoted.outgoingVelocity
	});

	if (
		supported &&
		Math.hypot(...promoted.outgoingVelocity) <= input.settings.tolerances.eventTime
	) {
		const primary = promoted.activeCandidates[0]!;
		assembly.events.push({
			type: 'contact-mode-transition',
			time: event.time,
			bodyId: body.id,
			colliderId: primary.colliderId,
			from: 'impact',
			to: 'resting',
			reason: 'impact-collapse',
			position: event.position,
			normal: primary.normal,
			contacts: promoted.contacts
		});
		assembly.entries.push({
			severity: 'info',
			code: 'CONTACT_MODE_TRANSITION',
			message: 'impact -> resting on certified accumulation manifold: impact-collapse.',
			time: event.time,
			bodyId: body.id
		});
		return {
			type: 'terminal',
			time: event.time,
			reason: {
				type: 'resting-contact',
				time: event.time,
				colliderId: primary.colliderId,
				position: event.position,
				normal: primary.normal,
				contacts: promoted.contacts,
				supportReactions: support!,
				reason: 'impact-collapse'
			}
		};
	}

	if (released) {
		assembly.events.push({
			type: 'contact-mode-transition',
			time: event.time,
			bodyId: body.id,
			colliderId: event.colliderId,
			from: 'impact',
			to: 'free-flight',
			reason: 'impact-collapse',
			position: event.position,
			normal: event.normal,
			contacts: promoted.contacts
		});
		assembly.entries.push({
			severity: 'info',
			code: 'CONTACT_MODE_TRANSITION',
			message: 'impact -> free-flight on certified accumulation manifold: impact-collapse.',
			time: event.time,
			bodyId: body.id
		});
		return freeFlightAfterManifold(
			event,
			promoted.outgoingVelocity,
			manifoldCandidates,
			manifoldCandidates.map(({ colliderId }) => colliderId)
		);
	}

	if (retainedAfterImpact.length > 0) {
		return {
			type: 'terminal',
			time: event.time,
			reason: {
				type: 'unresolved-collision-search',
				time: event.time,
				detail:
					'The certified accumulation manifold was pressing but had no certified resting support or common release.'
			}
		};
	}

	return freeFlightAfterManifold(event, promoted.outgoingVelocity, manifoldCandidates);
}

function freeFlightAfterManifold(
	event: ContactEvent,
	velocity: Vec2,
	candidates: readonly FixedWorldContactCandidate[],
	toleranceContainedReleaseColliderIds?: readonly string[]
): ImpactResolution {
	return {
		type: 'continue',
		nextState: {
			time: event.time,
			position: event.position,
			velocity,
			releasedContactColliderId: null,
			releasedContactColliderIds: candidates.map(({ colliderId }) => colliderId),
			retainedSupportCandidates: [],
			pendingContactCandidates: [],
			acceptInitialContact: false,
			toleranceContainedReleaseColliderIds
		}
	};
}

function dotGravity(gravity: Vec2, normal: Vec2): number {
	return gravity[0] * normal[0] + gravity[1] * normal[1];
}
