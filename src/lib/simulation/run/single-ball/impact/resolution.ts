import type {
	ContactEvent,
	FreeFlightMotionSegment,
	InitialDynamicCircleBodyState,
	RunTerminalReason,
	SimulationInput,
	Vec2
} from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../../motion';
import { acquireAlternatingContactLimit, solveSupportReactions } from '../manifold';
import { appendSustainedContact, type RunAssembly } from '../run-assembly';
import { continueSustainedContact } from '../sustained-contact';
import { commitAlternatingLimitRelease } from './alternating-limit';
import { recordAlternatingLimitEvidence, recordImpactEvidence } from './evidence';
import { isContractingAlternatingImpactSequence, resolveImpactResponse } from './response';

export interface ImpactNextState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly releasedContactColliderId: string | null;
	readonly releasedContactColliderIds: readonly string[];
	readonly retainedSupportCandidates: readonly FixedWorldContactCandidate[];
	readonly pendingContactCandidates: readonly FixedWorldContactCandidate[];
	readonly acceptInitialContact: boolean;
	readonly toleranceContainedReleaseColliderIds?: readonly string[];
}

export type ImpactResolution =
	| { readonly type: 'terminal'; readonly reason: RunTerminalReason; readonly time: number }
	| { readonly type: 'continue'; readonly nextState: ImpactNextState };

export function resolvePendingContact(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	state: ImpactNextState,
	assembly: RunAssembly
): ImpactResolution | null {
	const candidate = state.pendingContactCandidates[0];
	return candidate
		? resolveContact(
				input,
				body,
				null,
				makeContactEvent(candidate),
				mergeContactCandidates(state.retainedSupportCandidates, state.pendingContactCandidates),
				assembly,
				{ position: state.position, velocity: state.velocity }
			)
		: null;
}

export function resolveContact(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	path: FreeFlightMotionSegment | null,
	event: ContactEvent,
	candidates: readonly FixedWorldContactCandidate[],
	assembly: RunAssembly,
	authoritativeState: { readonly position: Vec2; readonly velocity: Vec2 } | null
): ImpactResolution {
	const state = authoritativeState ?? stateFromPath(path, event.time);
	if (!state || !isFiniteVec2(state.velocity) || !isFiniteVec2(state.position)) {
		return numericalFailure(
			event,
			'The selected contact state could not be evaluated as finite numbers.'
		);
	}
	const alternating = isContractingAlternatingImpactSequence(
		event.time,
		candidates,
		assembly.impactHistory
	);
	const acquisition = alternating
		? acquireAlternatingContactLimit(
				input,
				body,
				event.time,
				state.position,
				state.velocity,
				candidates,
				assembly.impactHistory
			)
		: null;
	const manifoldCandidates = acquisition?.candidates ?? candidates;
	const response = resolveImpactResponse(
		input,
		event.time,
		manifoldCandidates,
		state.velocity,
		assembly.impactHistory,
		acquisition ? 'alternating-contact-limit' : null
	);
	if (!response) {
		return numericalFailure(
			event,
			'The restitution response did not produce a finite outgoing velocity.'
		);
	}
	const acquisitionSupport = acquisition
		? solveSupportReactions(
				manifoldCandidates,
				input.settings.gravity,
				input.settings.tolerances.eventTime
			)
		: null;
	if (
		acquisition &&
		!acquisitionSupport &&
		Math.hypot(...response.outgoingVelocity) > input.settings.tolerances.eventTime
	) {
		const committed = commitAlternatingLimitRelease(
			input,
			body,
			event,
			state.velocity,
			candidates,
			manifoldCandidates,
			response,
			acquisition,
			assembly
		);
		if (!committed) {
			return numericalFailure(
				event,
				'The observed contact could not be reconciled with the acquired accumulation manifold.'
			);
		}
		return freeFlightAfterManifold(
			event,
			response.outgoingVelocity,
			manifoldCandidates,
			manifoldCandidates.map(({ colliderId }) => colliderId)
		);
	}
	const committedEvent: ContactEvent = {
		...event,
		contacts: response.contacts,
		preContactVelocity: state.velocity,
		postContactVelocity: response.outgoingVelocity
	};
	const retainedAfterImpact = response.enterSustainedContact
		? manifoldCandidates.filter((candidate, index) => {
				const evidence = response.contacts[index];
				const pressing = dotGravity(input.settings.gravity, candidate.normal) < 0;
				return Boolean(
					evidence &&
					pressing &&
					(response.collapseReason !== null ||
						Math.abs(evidence.postImpactNormalVelocity) <= input.settings.tolerances.eventTime)
				);
			})
		: [];
	recordImpactEvidence(
		assembly,
		body,
		committedEvent,
		manifoldCandidates,
		state.velocity,
		response,
		retainedAfterImpact,
		input.settings.tolerances.eventTime
	);
	if (!response.enterSustainedContact) {
		return freeFlightAfterManifold(event, response.outgoingVelocity, manifoldCandidates);
	}

	const mayRest =
		Math.hypot(...response.outgoingVelocity) <= input.settings.tolerances.eventTime ||
		response.collapseReason === 'contracting-impacts' ||
		response.collapseReason === 'alternating-contact-limit';
	const support = mayRest
		? (acquisitionSupport ??
			solveSupportReactions(
				manifoldCandidates,
				input.settings.gravity,
				input.settings.tolerances.eventTime
			))
		: null;
	if (acquisition) {
		recordAlternatingLimitEvidence(
			assembly,
			body,
			event.time,
			acquisition,
			support !== null,
			retainedAfterImpact.length === 0
		);
	}
	if (support) return restingManifold(body, event, response, support.reactions, assembly);
	if (acquisition && retainedAfterImpact.length > 0) {
		return {
			type: 'terminal',
			time: event.time,
			reason: {
				type: 'unresolved-collision-search',
				time: event.time,
				detail:
					'The acquired alternating-contact manifold was pressing but had no certified resting support or common release.'
			}
		};
	}

	const supportCandidate = retainedAfterImpact[0];
	if (!supportCandidate)
		return freeFlightAfterManifold(event, response.outgoingVelocity, manifoldCandidates);
	const continuation = continueSustainedContact({
		input,
		body,
		colliderId: supportCandidate.colliderId,
		time: event.time,
		position: event.position,
		normal: supportCandidate.normal,
		outgoingVelocity: response.outgoingVelocity,
		entryFrom: response.collapseReason === 'initial-supported-state' ? 'free-flight' : 'impact',
		entryReason:
			response.collapseReason === 'initial-supported-state'
				? 'supported-initial-state'
				: response.collapseReason
					? 'impact-collapse'
					: 'collider-contact',
		manifoldContacts: response.contacts
	});
	appendSustainedContact(assembly, continuation);
	if (continuation.terminalReason) {
		return {
			type: 'terminal',
			time: continuation.terminalReason.time ?? event.time,
			reason: continuation.terminalReason
		};
	}
	return { type: 'continue', nextState: continuation.nextState! };
}

export function mergeContactCandidates(
	retained: readonly FixedWorldContactCandidate[],
	incoming: readonly FixedWorldContactCandidate[]
): readonly FixedWorldContactCandidate[] {
	const merged = [...retained];
	for (const candidate of incoming) {
		if (
			!merged.some(
				({ colliderId, feature }) =>
					colliderId === candidate.colliderId && feature === candidate.feature
			)
		)
			merged.push(candidate);
	}
	return merged;
}

function makeContactEvent(candidate: FixedWorldContactCandidate): ContactEvent {
	return {
		type: 'contact',
		time: candidate.time,
		bodyId: candidate.bodyId,
		colliderId: candidate.colliderId,
		position: candidate.position,
		normal: candidate.normal
	};
}

function restingManifold(
	body: InitialDynamicCircleBodyState,
	event: ContactEvent,
	response: NonNullable<ReturnType<typeof resolveImpactResponse>>,
	supportReactions: readonly number[],
	assembly: RunAssembly
): ImpactResolution {
	const supportedInitial = response.collapseReason === 'initial-supported-state';
	assembly.events.push({
		type: 'contact-mode-transition',
		time: event.time,
		bodyId: body.id,
		colliderId: event.colliderId,
		from: supportedInitial ? 'free-flight' : 'impact',
		to: 'resting',
		reason: supportedInitial ? 'supported-initial-state' : 'impact-collapse',
		position: event.position,
		normal: event.normal,
		contacts: response.contacts
	});
	assembly.entries.push({
		severity: 'info',
		code: 'CONTACT_MODE_TRANSITION',
		message: `${supportedInitial ? 'free-flight' : 'impact'} -> resting on manifold: ${supportedInitial ? 'supported-initial-state' : 'impact-collapse'}.`,
		time: event.time,
		bodyId: body.id
	});
	return {
		type: 'terminal',
		time: event.time,
		reason: {
			type: 'resting-contact',
			time: event.time,
			colliderId: event.colliderId,
			position: event.position,
			normal: event.normal,
			contacts: response.contacts,
			supportReactions,
			reason: supportedInitial ? 'zero-tangential-motion' : 'impact-collapse'
		}
	};
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

function numericalFailure(event: ContactEvent, detail: string): ImpactResolution {
	return {
		type: 'terminal',
		time: event.time,
		reason: { type: 'numerical-failure', time: event.time, detail }
	};
}

function stateFromPath(
	path: FreeFlightMotionSegment | null,
	time: number
): { readonly position: Vec2; readonly velocity: Vec2 } | null {
	return path
		? {
				position: evaluateMotionSegmentPosition(path, time),
				velocity: evaluateMotionSegmentVelocity(path, time)
			}
		: null;
}

function dotGravity(gravity: Vec2, normal: Vec2): number {
	return gravity[0] * normal[0] + gravity[1] * normal[1];
}

function isFiniteVec2(vector: Vec2): boolean {
	return vector.every(Number.isFinite);
}
