import type {
	CircularContactMotionSegment,
	ContactModeTransitionEvent,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	Vec2
} from '../../contracts';
import { dotVec2 } from '../../math';
import {
	circularContactSpeedSquared,
	circularContactTravelTime,
	evaluateCircularContactState
} from '../../motion';
import type { SustainedContactRequest, SustainedContactResult } from './sustained-contact';
import {
	circularPosition,
	colliderSeparation,
	containsPosition,
	outsideBounds
} from './constrained-path-geometry';

interface AngularEvent {
	readonly angle: number;
	readonly type: 'contact' | 'terminal';
	readonly colliderId?: string;
	readonly terminalReason?: RunTerminalReason;
}

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
		return resting(request);
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
		return detachedAtEntry(request, [ccwTangent[0] * signedSpeed, ccwTangent[1] * signedSpeed]);
	}
	const detachAngle = findDetachAngle(seed);
	if (detachAngle === null) {
		return unresolved(request, 'Circular contact could not certify a detachment angle.');
	}
	const sceneEvent = findEarliestAngularSceneEvent(request, seed, detachAngle);
	const endAngle = sceneEvent?.angle ?? detachAngle;
	const travelTime = circularContactTravelTime(seed, endAngle);
	if (!Number.isFinite(travelTime) || travelTime <= request.input.settings.tolerances.eventTime) {
		return unresolved(request, 'Circular contact travel time was not finite and positive.');
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
				transition(
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
				transition(
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
				ignoreInitialContactColliderId: request.colliderId,
				acceptInitialContact: true
			}
		};
	}
	return {
		segments: [segment],
		events: [
			entryTransition(request, 'sliding'),
			transition(
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
			ignoreInitialContactColliderId: request.colliderId,
			acceptInitialContact: false
		}
	};
}

function findEarliestAngularSceneEvent(
	request: SustainedContactRequest,
	seed: Parameters<typeof findDetachAngle>[0],
	detachAngle: number
): AngularEvent | null {
	const angularDistance = seed.direction * (detachAngle - seed.startAngle);
	let previousAngle = seed.startAngle;
	let previousPosition = circularPosition(seed.centre, seed.contactRadius, previousAngle);
	for (let index = 1; index <= 512; index += 1) {
		const angle = seed.startAngle + seed.direction * ((angularDistance * index) / 512);
		const position = circularPosition(seed.centre, seed.contactRadius, angle);
		const event = crossedSceneEvent(
			request,
			previousAngle,
			angle,
			previousPosition,
			position,
			seed
		);
		if (event) return event;
		previousAngle = angle;
		previousPosition = position;
	}
	return null;
}

function crossedSceneEvent(
	request: SustainedContactRequest,
	startAngle: number,
	endAngle: number,
	startPosition: Vec2,
	endPosition: Vec2,
	seed: Parameters<typeof findDetachAngle>[0]
): AngularEvent | null {
	const events: AngularEvent[] = [];
	for (const region of request.input.scene.terminationRegions) {
		if (
			!containsPosition(region.minimum, region.maximum, startPosition) &&
			containsPosition(region.minimum, region.maximum, endPosition)
		) {
			const angle = bisectNumber(startAngle, endAngle, (candidate) =>
				containsPosition(
					region.minimum,
					region.maximum,
					circularPosition(seed.centre, seed.contactRadius, candidate)
				)
			);
			events.push({
				type: 'terminal',
				angle,
				terminalReason: {
					type: region.purpose === 'complete' ? 'completion-region' : 'escape-region',
					regionId: region.id,
					time: request.time + circularContactTravelTime(seed, angle)
				}
			});
		}
	}
	const halfWidth = request.input.scene.bounds.width / 2;
	const boundsBoundary = outsideBounds(endPosition, halfWidth, request.input.scene.bounds.height);
	if (
		!outsideBounds(startPosition, halfWidth, request.input.scene.bounds.height) &&
		boundsBoundary
	) {
		const angle = bisectNumber(startAngle, endAngle, (candidate) =>
			Boolean(
				outsideBounds(
					circularPosition(seed.centre, seed.contactRadius, candidate),
					halfWidth,
					request.input.scene.bounds.height
				)
			)
		);
		events.push({
			type: 'terminal',
			angle,
			terminalReason: {
				type: 'bounds-escape',
				boundary: boundsBoundary,
				time: request.time + circularContactTravelTime(seed, angle)
			}
		});
	}
	for (const collider of request.input.scene.staticColliders) {
		if (collider.id === request.colliderId) continue;
		const startSeparation = colliderSeparation(
			startPosition,
			request.body.physicalShape.radius,
			collider
		);
		const endSeparation = colliderSeparation(
			endPosition,
			request.body.physicalShape.radius,
			collider
		);
		if (
			startSeparation > request.input.settings.tolerances.contactDistance &&
			endSeparation <= request.input.settings.tolerances.contactDistance
		) {
			const angle = bisectNumber(
				startAngle,
				endAngle,
				(candidate) =>
					colliderSeparation(
						circularPosition(seed.centre, seed.contactRadius, candidate),
						request.body.physicalShape.radius,
						collider
					) <= request.input.settings.tolerances.contactDistance
			);
			events.push({ type: 'contact', angle, colliderId: collider.id });
		}
	}
	return (
		events.sort(
			(left, right) =>
				seed.direction * (left.angle - right.angle) ||
				(left.colliderId ?? '').localeCompare(right.colliderId ?? '')
		)[0] ?? null
	);
}

function findDetachAngle(seed: {
	readonly centre: Vec2;
	readonly contactRadius: number;
	readonly startAngle: number;
	readonly direction: -1 | 1;
	readonly startTangentialSpeed: number;
	readonly gravity: Vec2;
}): number | null {
	const supportExpression = (angle: number) => {
		const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
		return (
			circularContactSpeedSquared(seed, angle) / seed.contactRadius + dotVec2(seed.gravity, normal)
		);
	};
	let previousAngle = seed.startAngle;
	let previous = supportExpression(previousAngle);
	for (let index = 1; index <= 512; index += 1) {
		const angle = seed.startAngle + seed.direction * ((Math.PI * 2 * index) / 512);
		if (circularContactSpeedSquared(seed, angle) < -1e-10) return null;
		const current = supportExpression(angle);
		if (previous <= 0 && current >= 0) {
			return bisectNumber(previousAngle, angle, (candidate) => supportExpression(candidate) >= 0);
		}
		previousAngle = angle;
		previous = current;
	}
	return null;
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

function resting(request: SustainedContactRequest): SustainedContactResult {
	return {
		segments: [],
		events: [entryTransition(request, 'resting')],
		contactSearches: [],
		terminalReason: {
			type: 'resting-contact',
			time: request.time,
			colliderId: request.colliderId,
			position: request.position,
			normal: request.normal,
			reason:
				request.entryReason === 'supported-initial-state'
					? 'zero-tangential-motion'
					: 'impact-collapse'
		},
		nextState: null
	};
}

function detachedAtEntry(request: SustainedContactRequest, velocity: Vec2): SustainedContactResult {
	return {
		segments: [],
		events: [entryTransition(request, 'free-flight', 'support-lost')],
		contactSearches: [],
		terminalReason: null,
		nextState: {
			time: request.time,
			position: request.position,
			velocity,
			ignoreInitialContactColliderId: request.colliderId,
			acceptInitialContact: false
		}
	};
}

function unresolved(request: SustainedContactRequest, detail: string): SustainedContactResult {
	return {
		segments: [],
		events: [
			entryTransition(request, 'sliding'),
			transition(
				request,
				'free-flight',
				'unresolved',
				request.time,
				request.position,
				request.normal
			)
		],
		contactSearches: [],
		terminalReason: { type: 'unresolved-collision-search', time: request.time, detail },
		nextState: null
	};
}

function entryTransition(
	request: SustainedContactRequest,
	to: 'resting' | 'sliding' | 'free-flight',
	reason: ContactModeTransitionEvent['reason'] = to === 'free-flight'
		? 'support-lost'
		: 'impact-collapse'
): ContactModeTransitionEvent {
	return {
		type: 'contact-mode-transition',
		time: request.time,
		bodyId: request.body.id,
		colliderId: request.colliderId,
		from: request.entryFrom,
		to,
		reason: to === 'free-flight' ? reason : request.entryReason,
		position: request.position,
		normal: request.normal
	};
}

function transition(
	request: SustainedContactRequest,
	to: ContactModeTransitionEvent['to'],
	reason: ContactModeTransitionEvent['reason'],
	time: number,
	position: Vec2,
	normal: Vec2
): ContactModeTransitionEvent {
	return {
		type: 'contact-mode-transition',
		time,
		bodyId: request.body.id,
		colliderId: request.colliderId,
		from: 'sliding',
		to,
		reason,
		position,
		normal
	};
}

function bisectNumber(left: number, right: number, predicate: (value: number) => boolean): number {
	let lower = left;
	let upper = right;
	for (let iteration = 0; iteration < 60; iteration += 1) {
		const middle = (lower + upper) / 2;
		if (predicate(middle)) upper = middle;
		else lower = middle;
	}
	return (lower + upper) / 2;
}
