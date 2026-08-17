import type {
	CircularContactMotionSegment,
	RunContactSearchDiagnostic,
	Vec2
} from '../../../../contracts';
import { dotVec2 } from '../../../../math';
import { evaluateCircularContactState } from '../../../../motion';
import type { FixedWorldContactCandidate } from '../../../../collision';
import type { SupportedMotionEvidence } from '../../../contact-resolution';
import { entryTransition, slidingTransition } from '../contact-mode-results';
import { resolveSustainedBoundaryMode } from '../mode';
import type { SustainedContactRequest, SustainedContactResult } from '../types';
import type { AngularEvent } from './angular-event-search';

export function circularBoundaryResult(
	entryRequest: SustainedContactRequest,
	request: SustainedContactRequest,
	boundary: AngularEvent,
	leg: CircularContactMotionSegment,
	endState: ReturnType<typeof evaluateCircularContactState>,
	incomingCandidate: FixedWorldContactCandidate | null,
	segments: readonly CircularContactMotionSegment[],
	contactSearches: readonly RunContactSearchDiagnostic[]
): SustainedContactResult | null {
	if (boundary.type === 'turning-point') {
		const support = -dotVec2(request.input.settings.gravity, endState.normal);
		const resolution = resolveSustainedBoundaryMode(
			request,
			leg.endTime,
			endState.position,
			endState.velocity,
			endState.normal,
			support < -request.input.settings.tolerances.eventTime ? 'released' : 'retained',
			null,
			support < -request.input.settings.tolerances.eventTime
				? 'Circular support was unavailable at the selected turning point.'
				: null
		);
		return resolution.mode.type === 'unresolved'
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
					resolution.mode.detail
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
	const supportResolution = resolveSustainedBoundaryMode(
		request,
		leg.endTime,
		endState.position,
		endState.velocity,
		endState.normal,
		isContact ? 'retained' : 'released',
		null
	);
	const retained =
		supportResolution.mode.type === 'fixed-sustained-contact' ? supportResolution.candidate : null;
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
			pendingContactCandidates: incomingCandidate ? [incomingCandidate] : [],
			acceptInitialContact: false
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
	contactSearches: readonly RunContactSearchDiagnostic[],
	motion: SupportedMotionEvidence
): SustainedContactResult {
	const resolution = resolveSustainedBoundaryMode(
		request,
		time,
		position,
		[0, 0],
		normal,
		'retained',
		motion
	);
	if (resolution.mode.type !== 'resting-anchored') {
		return unresolvedCircularResult(
			request,
			{ ...request, time, position, normal, outgoingVelocity: [0, 0] },
			segments,
			contactSearches,
			'The stationary circular contact did not receive a resting-anchored mode decision.'
		);
	}
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
	candidate: FixedWorldContactCandidate | null
): RunContactSearchDiagnostic {
	return {
		searchInterval: [segment.startTime, segment.endTime],
		eventTimeTolerance: request.input.settings.tolerances.eventTime,
		outcome: candidate ? 'contact' : 'no-event',
		reason: null,
		selectedColliderId: candidate?.colliderId ?? null,
		candidates: candidate
			? [
					{
						colliderId: candidate.colliderId,
						feature: candidate.feature,
						time: candidate.time,
						classification:
							candidate.response === 'impact' ? 'accepted-impact' : 'accepted-non-impulsive',
						position: candidate.position,
						contactPoint: candidate.contactPoint,
						normal: candidate.normal,
						normalVelocity: candidate.normalVelocity,
						eventContactSetMember: true
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
