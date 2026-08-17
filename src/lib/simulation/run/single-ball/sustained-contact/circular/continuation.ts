import type {
	CircularContactMotionSegment,
	RunContactSearchDiagnostic,
	Vec2
} from '../../../../contracts';
import { dotVec2 } from '../../../../math';
import { circularContactTravelTime, evaluateCircularContactState } from '../../../../motion';
import { classifySupportedMotion, type SupportedMotionEvidence } from '../../../contact-resolution';
import { detachedContactResult, restingContactResult } from '../contact-mode-results';
import { colliderCandidateAtState } from '../geometry';
import type { SustainedContactRequest, SustainedContactResult } from '../types';
import { findEarliestAngularEvent, type CircularContactSeed } from './angular-event-search';
import {
	circularBoundaryResult,
	circularSearchDiagnostic,
	circularTimeLimitResult,
	restingCircularResult,
	unresolvedCircularResult
} from './results';

interface CircularLegStart {
	readonly request: SustainedContactRequest;
	readonly seed: CircularContactSeed;
}

export function continueCircularContact(
	request: SustainedContactRequest,
	centre: Vec2,
	contactRadius: number
): SustainedContactResult {
	const motion = circularMotionEvidence(request);
	if (classifySupportedMotion(motion) === 'resting-qualified') {
		return restingContactResult(request, motion);
	}
	const start = classifyCircularLegStart(request, centre, contactRadius);
	if (start.type === 'detached') return detachedContactResult(request, start.velocity);

	return continueCircularLegs(request, start.value);
}

function classifyCircularLegStart(
	request: SustainedContactRequest,
	centre: Vec2,
	contactRadius: number
):
	| { readonly type: 'detached'; readonly velocity: Vec2 }
	| { readonly type: 'sliding'; readonly value: CircularLegStart } {
	const startAngle = Math.atan2(request.normal[1], request.normal[0]);
	const ccwTangent: Vec2 = [-request.normal[1], request.normal[0]];
	const signedSpeed = dotVec2(request.outgoingVelocity, ccwTangent);
	const tangentAcceleration = dotVec2(request.input.settings.gravity, ccwTangent);
	const speedIsSignificant = Math.abs(signedSpeed) > request.input.settings.tolerances.eventTime;
	const direction: -1 | 1 = speedIsSignificant
		? signedSpeed > 0
			? 1
			: -1
		: tangentAcceleration > 0
			? 1
			: -1;
	const startTangentialSpeed = speedIsSignificant ? Math.abs(signedSpeed) : 0;
	const initialSupport = -(
		startTangentialSpeed ** 2 / contactRadius +
		dotVec2(request.input.settings.gravity, request.normal)
	);
	if (initialSupport < -request.input.settings.tolerances.eventTime) {
		return {
			type: 'detached',
			velocity: [ccwTangent[0] * signedSpeed, ccwTangent[1] * signedSpeed]
		};
	}
	return {
		type: 'sliding',
		value: {
			request,
			seed: {
				centre,
				contactRadius,
				startAngle,
				direction,
				startTangentialSpeed,
				gravity: request.input.settings.gravity
			}
		}
	};
}

function continueCircularLegs(
	entryRequest: SustainedContactRequest,
	initial: CircularLegStart
): SustainedContactResult {
	const segments: CircularContactMotionSegment[] = [];
	const contactSearches: RunContactSearchDiagnostic[] = [];
	let current = initial;

	while (true) {
		const boundary = findEarliestAngularEvent(current.request, current.seed);
		if (!boundary) {
			return unresolvedCircularResult(
				entryRequest,
				current.request,
				segments,
				contactSearches,
				'Circular contact could not certify a next angular event.'
			);
		}
		const leg = createCircularLeg(current.request, current.seed, boundary.angle);
		if (!leg) {
			return unresolvedCircularResult(
				entryRequest,
				current.request,
				segments,
				contactSearches,
				'Circular contact travel time was not finite and positive.'
			);
		}
		if (leg.endTime > current.request.input.settings.maximumSimulationTime) {
			return circularTimeLimitResult(entryRequest, current.request, leg, segments, contactSearches);
		}

		const endState = evaluateCircularContactState(leg, leg.endTime);
		const incomingCandidate =
			boundary.type === 'contact'
				? colliderCandidateAtState(
						current.request,
						boundary.colliderId,
						leg.endTime,
						endState.position,
						endState.velocity
					)
				: null;
		if (boundary.type === 'contact' && !incomingCandidate) {
			return unresolvedCircularResult(
				entryRequest,
				current.request,
				segments,
				contactSearches,
				'Circular contact could not construct authoritative event-time collider geometry.'
			);
		}
		segments.push(leg);
		contactSearches.push(circularSearchDiagnostic(current.request, leg, incomingCandidate));
		const result = circularBoundaryResult(
			entryRequest,
			current.request,
			boundary,
			leg,
			endState,
			incomingCandidate,
			segments,
			contactSearches
		);
		if (result) return result;

		const tangentAcceleration = dotVec2(current.seed.gravity, [
			-endState.normal[1],
			endState.normal[0]
		]);
		const motion: SupportedMotionEvidence = {
			constrainedAccelerationComponents: [tangentAcceleration],
			tolerance: current.request.input.settings.tolerances.eventTime
		};
		const direction: -1 | 1 = tangentAcceleration > 0 ? 1 : -1;
		if (classifySupportedMotion(motion) === 'resting-qualified') {
			return restingCircularResult(
				entryRequest,
				leg.endTime,
				endState.position,
				endState.normal,
				segments,
				contactSearches,
				motion
			);
		}
		if (direction === current.seed.direction) {
			return unresolvedCircularResult(
				entryRequest,
				requestAtTurning(current.request, leg.endTime, endState.position, endState.normal),
				segments,
				contactSearches,
				'Tangential acceleration did not establish reversed circular motion.'
			);
		}
		const nextRequest = requestAtTurning(
			current.request,
			leg.endTime,
			endState.position,
			endState.normal
		);
		current = {
			request: nextRequest,
			seed: {
				...current.seed,
				startAngle: boundary.angle,
				direction,
				startTangentialSpeed: 0
			}
		};
	}
}

function circularMotionEvidence(request: SustainedContactRequest): SupportedMotionEvidence {
	const tangent: Vec2 = [-request.normal[1], request.normal[0]];
	const speed = dotVec2(request.outgoingVelocity, tangent);
	const acceleration = dotVec2(request.input.settings.gravity, tangent);
	return {
		velocityComponents: [speed],
		constrainedAccelerationComponents: [acceleration],
		tolerance: request.input.settings.tolerances.eventTime
	};
}

function createCircularLeg(
	request: SustainedContactRequest,
	seed: CircularContactSeed,
	endAngle: number
): CircularContactMotionSegment | null {
	const travelTime = circularContactTravelTime(seed, endAngle);
	if (!Number.isFinite(travelTime) || travelTime <= request.input.settings.tolerances.eventTime) {
		return null;
	}
	const tangent: Vec2 = [
		-Math.sin(seed.startAngle) * seed.direction,
		Math.cos(seed.startAngle) * seed.direction
	];
	return {
		type: 'circular-contact',
		bodyId: request.body.id,
		startTime: request.time,
		endTime: request.time + travelTime,
		startPosition: request.position,
		startVelocity:
			seed.startTangentialSpeed === 0
				? [0, 0]
				: [tangent[0] * seed.startTangentialSpeed, tangent[1] * seed.startTangentialSpeed],
		supportingColliderId: request.colliderId,
		centre: seed.centre,
		contactRadius: seed.contactRadius,
		startAngle: seed.startAngle,
		endAngle,
		direction: seed.direction,
		startTangentialSpeed: seed.startTangentialSpeed,
		gravity: seed.gravity
	};
}

function requestAtTurning(
	request: SustainedContactRequest,
	time: number,
	position: Vec2,
	normal: Vec2
): SustainedContactRequest {
	return { ...request, time, position, normal, outgoingVelocity: [0, 0] };
}
