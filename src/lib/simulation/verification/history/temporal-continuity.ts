import type { MotionSegment, Vec2 } from '../../contracts';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';
import { bodyFor, terminalTime } from './record-integrity';
import { reportRunValidationFailure, type RunValidationContext } from '../results';

export function validateTemporalContinuity(context: RunValidationContext): void {
	validateMonotonicEvents(context);
	validateSearchIntervals(context);
	for (const [trajectoryIndex, trajectory] of context.run.trajectories.entries()) {
		const body = bodyFor(context.submittedInput, trajectory.bodyId);
		if (!body) continue;
		for (const [segmentIndex, segment] of trajectory.segments.entries()) {
			validateSegmentInterval(context, segment, trajectoryIndex, segmentIndex);
			const previous = trajectory.segments[segmentIndex - 1];
			if (previous) validateJoin(context, previous, segment, trajectoryIndex, segmentIndex);
			else
				validateInitialState(
					context,
					segment,
					body.position,
					body.velocity,
					body.releaseTime,
					trajectoryIndex
				);
		}
	}
	validateEventStates(context);
}

function validateMonotonicEvents(context: RunValidationContext): void {
	let previousTime = Number.NEGATIVE_INFINITY;
	for (const [index, event] of context.run.events.entries()) {
		if (event.time < previousTime) {
			fail(context, 'NON_MONOTONIC_TIME', 'Events must be ordered by non-decreasing time.', {
				path: `$.events[${index}].time`,
				time: event.time,
				bodyId: event.bodyId
			});
		}
		previousTime = event.time;
		if (event.time > terminalTime(context.run) + timeTolerance(context)) {
			fail(context, 'PREFIX_AFTER_TERMINAL', 'An event extends beyond the terminal boundary.', {
				path: `$.events[${index}].time`,
				time: event.time,
				bodyId: event.bodyId
			});
		}
	}
}

function validateSearchIntervals(context: RunValidationContext): void {
	const previousStartByBody = new Map<string, number>();
	for (const [index, search] of context.run.diagnostics.contactSearches.entries()) {
		const [start, end] = search.searchInterval;
		const bodyKey = search.bodyId ?? '__legacy-global__';
		const previousStart = previousStartByBody.get(bodyKey) ?? Number.NEGATIVE_INFINITY;
		if (start > end || start < previousStart) {
			fail(
				context,
				'NON_MONOTONIC_TIME',
				'Contact-search intervals must be ordered and non-empty.',
				{
					path: `$.diagnostics.contactSearches[${index}].searchInterval`,
					time: start
				}
			);
		}
		if (start > terminalTime(context.run) + timeTolerance(context)) {
			fail(
				context,
				'PREFIX_AFTER_TERMINAL',
				'Contact-search evidence begins beyond the terminal boundary.',
				{
					path: `$.diagnostics.contactSearches[${index}].searchInterval[0]`,
					time: start
				}
			);
		}
		previousStartByBody.set(bodyKey, start);
	}
}

function validateSegmentInterval(
	context: RunValidationContext,
	segment: MotionSegment,
	trajectoryIndex: number,
	segmentIndex: number
): void {
	const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`;
	if (segment.endTime <= segment.startTime) {
		fail(
			context,
			'INVALID_INTERVAL',
			'Committed trajectory segments must advance simulation time.',
			{
				path,
				time: segment.startTime,
				bodyId: segment.bodyId
			}
		);
	}
	if (segment.endTime > terminalTime(context.run) + timeTolerance(context)) {
		fail(
			context,
			'PREFIX_AFTER_TERMINAL',
			'A trajectory segment extends beyond the terminal boundary.',
			{
				path: `${path}.endTime`,
				time: segment.endTime,
				bodyId: segment.bodyId
			}
		);
	}
}

function validateJoin(
	context: RunValidationContext,
	previous: MotionSegment,
	current: MotionSegment,
	trajectoryIndex: number,
	segmentIndex: number
): void {
	const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`;
	if (Math.abs(previous.endTime - current.startTime) > timeTolerance(context)) {
		fail(
			context,
			'NON_MONOTONIC_TIME',
			'Adjacent segments must share one simulation-time boundary.',
			{
				path: `${path}.startTime`,
				time: current.startTime,
				bodyId: current.bodyId
			}
		);
	}
	const previousPosition = evaluateMotionSegmentPosition(previous, previous.endTime);
	if (!nearVector(previousPosition, current.startPosition, stateTolerance(context))) {
		fail(context, 'DISCONTINUOUS_POSITION', 'Adjacent segments must meet at one position.', {
			path: `${path}.startPosition`,
			time: current.startTime,
			bodyId: current.bodyId
		});
	}
	const previousVelocity = evaluateMotionSegmentVelocity(previous, previous.endTime);
	if (
		!nearVector(previousVelocity, current.startVelocity, stateTolerance(context)) &&
		!hasContactAt(context, current.bodyId, current.startTime)
	) {
		fail(
			context,
			'UNDECLARED_VELOCITY_CHANGE',
			'A velocity discontinuity requires a contact event at the shared boundary.',
			{ path: `${path}.startVelocity`, time: current.startTime, bodyId: current.bodyId }
		);
	}
}

function validateInitialState(
	context: RunValidationContext,
	segment: MotionSegment,
	position: Vec2,
	velocity: Vec2,
	releaseTime: number,
	trajectoryIndex: number
): void {
	const path = `$.trajectories[${trajectoryIndex}].segments[0]`;
	if (Math.abs(segment.startTime - releaseTime) > timeTolerance(context)) {
		fail(
			context,
			'NON_MONOTONIC_TIME',
			'The first committed segment must begin at the body release time.',
			{
				path: `${path}.startTime`,
				time: segment.startTime,
				bodyId: segment.bodyId
			}
		);
	}
	if (!nearVector(segment.startPosition, position, stateTolerance(context))) {
		fail(
			context,
			'DISCONTINUOUS_POSITION',
			'The first segment must begin at the submitted position.',
			{
				path: `${path}.startPosition`,
				time: segment.startTime,
				bodyId: segment.bodyId
			}
		);
	}
	if (
		!nearVector(segment.startVelocity, velocity, stateTolerance(context)) &&
		!hasContactAt(context, segment.bodyId, releaseTime)
	) {
		fail(
			context,
			'UNDECLARED_VELOCITY_CHANGE',
			'The initial velocity changed without a time-zero contact.',
			{
				path: `${path}.startVelocity`,
				time: releaseTime,
				bodyId: segment.bodyId
			}
		);
	}
}

function validateEventStates(context: RunValidationContext): void {
	for (const [eventIndex, event] of context.run.events.entries()) {
		const trajectory = context.run.trajectories.find(({ bodyId }) => bodyId === event.bodyId);
		const segments = trajectory?.segments.filter(
			(segment) =>
				Math.abs(segment.startTime - event.time) <= timeTolerance(context) ||
				Math.abs(segment.endTime - event.time) <= timeTolerance(context)
		);
		const body = bodyFor(context.submittedInput, event.bodyId);
		const matchesInitialState =
			body !== undefined &&
			Math.abs(event.time - body.releaseTime) <= timeTolerance(context) &&
			nearVector(body.position, event.position, stateTolerance(context));
		if (
			!matchesInitialState &&
			!segments?.some((segment) =>
				nearVector(boundaryPosition(segment, event.time), event.position, stateTolerance(context))
			)
		) {
			fail(
				context,
				'EVENT_STATE_MISMATCH',
				'An event position must agree with a committed trajectory boundary.',
				{
					path: `$.events[${eventIndex}].position`,
					time: event.time,
					bodyId: event.bodyId,
					colliderId: event.colliderId
				}
			);
		}
	}
}

function boundaryPosition(segment: MotionSegment, time: number): Vec2 {
	return evaluateMotionSegmentPosition(
		segment,
		Math.abs(segment.startTime - time) <= Math.abs(segment.endTime - time)
			? segment.startTime
			: segment.endTime
	);
}

function hasContactAt(context: RunValidationContext, bodyId: string, time: number): boolean {
	return (
		context.run.events.some(
			(event) =>
				event.type === 'contact' &&
				event.bodyId === bodyId &&
				Math.abs(event.time - time) <= timeTolerance(context)
		) ||
		context.run.dynamicContacts.some(
			(event) =>
				Math.abs(event.time - time) <= timeTolerance(context) &&
				event.participants.some(
					(participant) => participant.type === 'body' && participant.bodyId === bodyId
				)
		)
	);
}

export function nearVector(left: Vec2, right: Vec2, tolerance: number): boolean {
	return Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance;
}

export function stateTolerance(context: RunValidationContext): number {
	return Math.max(1e-8, context.submittedInput.settings.tolerances.contactDistance * 64);
}

export function timeTolerance(context: RunValidationContext): number {
	return Math.max(1e-12, context.submittedInput.settings.tolerances.eventTime * 8);
}

function fail(
	context: RunValidationContext,
	code: Parameters<typeof reportRunValidationFailure>[2],
	message: string,
	reference: Parameters<typeof reportRunValidationFailure>[4]
): void {
	reportRunValidationFailure(context, 'temporal-continuity', code, message, reference);
}
