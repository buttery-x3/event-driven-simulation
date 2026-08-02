import type {
	CircularContactMotionSegment,
	RunContactSearchDiagnostic,
	Vec2
} from '../../../contracts';
import { dotVec2 } from '../../../math';
import { circularContactTravelTime, evaluateCircularContactState } from '../../../motion';
import { findDetachAngle, findEarliestAngularSceneEvent } from './angular-event-search';
import {
	detachedContactResult,
	entryTransition,
	restingContactResult,
	slidingTransition,
	unresolvedContactResult
} from './contact-mode-results';
import type { SustainedContactRequest, SustainedContactResult } from './types';

export function continueCircularContact(
	request: SustainedContactRequest,
	centre: Vec2,
	contactRadius: number
): SustainedContactResult {
	const startAngle = Math.atan2(request.normal[1], request.normal[0]);
	const ccwTangent: Vec2 = [-request.normal[1], request.normal[0]];
	const signedSpeed = dotVec2(request.outgoingVelocity, ccwTangent);
	const tangentAcceleration = dotVec2(request.input.settings.gravity, ccwTangent);
	if (
		Math.abs(signedSpeed) <= request.input.settings.tolerances.eventTime &&
		Math.abs(tangentAcceleration) <= request.input.settings.tolerances.eventTime
	) {
		return restingContactResult(request);
	}
	const direction: -1 | 1 =
		signedSpeed !== 0 ? (signedSpeed > 0 ? 1 : -1) : tangentAcceleration > 0 ? 1 : -1;
	const startTangentialSpeed = Math.abs(signedSpeed);
	const seed = {
		centre,
		contactRadius,
		startAngle,
		direction,
		startTangentialSpeed,
		gravity: request.input.settings.gravity
	} as const;
	const initialSupport = -(
		startTangentialSpeed ** 2 / contactRadius +
		dotVec2(request.input.settings.gravity, request.normal)
	);
	if (initialSupport < -request.input.settings.tolerances.eventTime) {
		return detachedContactResult(request, [
			ccwTangent[0] * signedSpeed,
			ccwTangent[1] * signedSpeed
		]);
	}
	const detachAngle = findDetachAngle(seed);
	if (detachAngle === null) {
		return unresolvedContactResult(
			request,
			'Circular contact could not certify a detachment angle.'
		);
	}
	const sceneEvent = findEarliestAngularSceneEvent(request, seed, detachAngle);
	const endAngle = sceneEvent?.angle ?? detachAngle;
	const travelTime = circularContactTravelTime(seed, endAngle);
	if (!Number.isFinite(travelTime) || travelTime <= request.input.settings.tolerances.eventTime) {
		return unresolvedContactResult(
			request,
			'Circular contact travel time was not finite and positive.'
		);
	}
	const naturalEndTime = request.time + travelTime;
	let segment = circularSegment(
		request,
		centre,
		contactRadius,
		startAngle,
		endAngle,
		direction,
		startTangentialSpeed,
		naturalEndTime
	);
	if (naturalEndTime > request.input.settings.maximumSimulationTime) {
		const cutoffState = evaluateCircularContactState(
			segment,
			request.input.settings.maximumSimulationTime
		);
		segment = {
			...segment,
			endTime: request.input.settings.maximumSimulationTime,
			endAngle: cutoffState.angle
		};
		return {
			segments: [segment],
			events: [entryTransition(request, 'sliding')],
			contactSearches: [circularSearchDiagnostic(request, segment, null)],
			terminalReason: {
				type: 'time-limit',
				time: segment.endTime,
				limit: request.input.settings.maximumSimulationTime
			},
			nextState: null
		};
	}
	const endState = evaluateCircularContactState(segment, naturalEndTime);
	if (sceneEvent?.type === 'terminal') {
		return {
			segments: [segment],
			events: [
				entryTransition(request, 'sliding'),
				slidingTransition(
					request,
					'free-flight',
					'terminal-region',
					naturalEndTime,
					endState.position,
					endState.normal
				)
			],
			contactSearches: [circularSearchDiagnostic(request, segment, null)],
			terminalReason: sceneEvent.terminalReason!,
			nextState: null
		};
	}
	if (sceneEvent?.type === 'contact') {
		return {
			segments: [segment],
			events: [
				entryTransition(request, 'sliding'),
				slidingTransition(
					request,
					'impact',
					'collider-contact',
					naturalEndTime,
					endState.position,
					endState.normal
				)
			],
			contactSearches: [circularSearchDiagnostic(request, segment, sceneEvent.colliderId ?? null)],
			terminalReason: null,
			nextState: {
				time: naturalEndTime,
				position: endState.position,
				velocity: endState.velocity,
				releasedContactColliderId: request.colliderId,
				acceptInitialContact: true
			}
		};
	}
	return {
		segments: [segment],
		events: [
			entryTransition(request, 'sliding'),
			slidingTransition(
				request,
				'free-flight',
				'support-lost',
				naturalEndTime,
				endState.position,
				endState.normal
			)
		],
		contactSearches: [circularSearchDiagnostic(request, segment, null)],
		terminalReason: null,
		nextState: {
			time: naturalEndTime,
			position: endState.position,
			velocity: endState.velocity,
			releasedContactColliderId: request.colliderId,
			acceptInitialContact: false
		}
	};
}

function circularSegment(
	request: SustainedContactRequest,
	centre: Vec2,
	contactRadius: number,
	startAngle: number,
	endAngle: number,
	direction: -1 | 1,
	startTangentialSpeed: number,
	endTime: number
): CircularContactMotionSegment {
	const tangent: Vec2 = [-Math.sin(startAngle) * direction, Math.cos(startAngle) * direction];
	return {
		type: 'circular-contact',
		bodyId: request.body.id,
		startTime: request.time,
		endTime,
		startPosition: request.position,
		startVelocity: [tangent[0] * startTangentialSpeed, tangent[1] * startTangentialSpeed],
		supportingColliderId: request.colliderId,
		centre,
		contactRadius,
		startAngle,
		endAngle,
		direction,
		startTangentialSpeed,
		gravity: request.input.settings.gravity
	};
}

function circularSearchDiagnostic(
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
