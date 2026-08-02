import type {
	CircularContactMotionSegment,
	RunContactSearchDiagnostic,
	Vec2
} from '../../../../contracts';
import { dotVec2 } from '../../../../math';
import { evaluateCircularContactState } from '../../../../motion';
import { entryTransition, slidingTransition } from '../contact-mode-results';
import { supportCandidate } from '../geometry';
import type { SustainedContactRequest, SustainedContactResult } from '../types';
import type { AngularEvent } from './angular-event-search';

export function circularBoundaryResult(
	entryRequest: SustainedContactRequest,
	request: SustainedContactRequest,
	boundary: AngularEvent,
	leg: CircularContactMotionSegment,
	endState: ReturnType<typeof evaluateCircularContactState>,
	segments: readonly CircularContactMotionSegment[],
	contactSearches: readonly RunContactSearchDiagnostic[]
): SustainedContactResult | null {
	if (boundary.type === 'turning-point') {
		const support = -dotVec2(request.input.settings.gravity, endState.normal);
		return support < -request.input.settings.tolerances.eventTime
			? unresolvedCircularResult(
					entryRequest,
					{
						...request,
						time: leg.endTime,
						position: endState.position,
						normal: endState.normal,
						outgoingVelocity: [0, 0]
					},
					segments,
					contactSearches,
					'Circular support was unavailable at the selected turning point.'
				)
			: null;
	}
	if (boundary.type === 'terminal') {
		return completedResult(
			entryRequest,
			segments,
			contactSearches,
			slidingTransition(
				entryRequest,
				'free-flight',
				'terminal-region',
				leg.endTime,
				endState.position,
				endState.normal
			),
			boundary.terminalReason,
			null
		);
	}
	const isContact = boundary.type === 'contact';
	const retained = isContact
		? supportCandidate(request, leg.endTime, endState.position, endState.velocity)
		: null;
	return completedResult(
		entryRequest,
		segments,
		contactSearches,
		slidingTransition(
			entryRequest,
			isContact ? 'impact' : 'free-flight',
			isContact ? 'collider-contact' : 'support-lost',
			leg.endTime,
			endState.position,
			endState.normal
		),
		null,
		{
			time: leg.endTime,
			position: endState.position,
			velocity: endState.velocity,
			releasedContactColliderId: entryRequest.colliderId,
			releasedContactColliderIds: [entryRequest.colliderId],
			retainedSupportCandidates: retained ? [retained] : [],
			acceptInitialContact: isContact
		}
	);
}

export function circularTimeLimitResult(
	entryRequest: SustainedContactRequest,
	currentRequest: SustainedContactRequest,
	leg: CircularContactMotionSegment,
	previousSegments: readonly CircularContactMotionSegment[],
	previousSearches: readonly RunContactSearchDiagnostic[]
): SustainedContactResult {
	const endTime = currentRequest.input.settings.maximumSimulationTime;
	const cutoffState = evaluateCircularContactState(leg, endTime);
	const segment = { ...leg, endTime, endAngle: cutoffState.angle };
	return {
		segments: [...previousSegments, segment],
		events: [entryTransition(entryRequest, 'sliding')],
		contactSearches: [...previousSearches, circularSearchDiagnostic(currentRequest, segment, null)],
		terminalReason: { type: 'time-limit', time: endTime, limit: endTime },
		nextState: null
	};
}

export function restingCircularResult(
	request: SustainedContactRequest,
	time: number,
	position: Vec2,
	normal: Vec2,
	segments: readonly CircularContactMotionSegment[],
	contactSearches: readonly RunContactSearchDiagnostic[]
): SustainedContactResult {
	return {
		segments,
		events: [
			entryTransition(request, 'sliding'),
			slidingTransition(request, 'resting', 'resting', time, position, normal)
		],
		contactSearches,
		terminalReason: {
			type: 'resting-contact',
			time,
			colliderId: request.colliderId,
			position,
			normal,
			contacts: request.manifoldContacts,
			reason: 'zero-tangential-motion'
		},
		nextState: null
	};
}

export function unresolvedCircularResult(
	entryRequest: SustainedContactRequest,
	currentRequest: SustainedContactRequest,
	segments: readonly CircularContactMotionSegment[],
	contactSearches: readonly RunContactSearchDiagnostic[],
	detail: string
): SustainedContactResult {
	return {
		segments,
		events: [
			entryTransition(entryRequest, 'sliding'),
			slidingTransition(
				entryRequest,
				'free-flight',
				'unresolved',
				currentRequest.time,
				currentRequest.position,
				currentRequest.normal
			)
		],
		contactSearches,
		terminalReason: {
			type: 'unresolved-collision-search',
			time: currentRequest.time,
			detail
		},
		nextState: null
	};
}

export function circularSearchDiagnostic(
	request: SustainedContactRequest,
	segment: CircularContactMotionSegment,
	colliderId: string | null
): RunContactSearchDiagnostic {
	return {
		searchInterval: [segment.startTime, segment.endTime],
		eventTimeTolerance: request.input.settings.tolerances.eventTime,
		outcome: colliderId ? 'contact' : 'no-event',
		reason: null,
		selectedColliderId: colliderId,
		candidates: colliderId
			? [
					{
						colliderId,
						feature: 'constrained-path',
						time: segment.endTime,
						classification: 'accepted'
					}
				]
			: []
	};
}

function completedResult(
	request: SustainedContactRequest,
	segments: readonly CircularContactMotionSegment[],
	contactSearches: readonly RunContactSearchDiagnostic[],
	exit: ReturnType<typeof slidingTransition>,
	terminalReason: SustainedContactResult['terminalReason'],
	nextState: SustainedContactResult['nextState']
): SustainedContactResult {
	return {
		segments,
		events: [entryTransition(request, 'sliding'), exit],
		contactSearches,
		terminalReason,
		nextState
	};
}
