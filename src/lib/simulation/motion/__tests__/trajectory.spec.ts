import { describe, expect, it } from 'vitest';
import type { BodyTrajectory, CircularContactMotionSegment, MotionSegment } from '../../contracts';
import { circularContactTravelTime, evaluateCircularContactState } from '../circular-contact';
import {
	evaluateBodyTrajectoryPosition,
	evaluateMotionSegmentPosition,
	evaluateMotionSegmentVelocity
} from '../trajectory';

const firstSegment = {
	type: 'free-flight',
	bodyId: 'test-ball',
	startTime: 0,
	endTime: 1,
	startPosition: [0, 2],
	startVelocity: [1, 0],
	acceleration: [0, -2]
} as const satisfies MotionSegment;

const secondSegment = {
	type: 'free-flight',
	bodyId: 'test-ball',
	startTime: 1,
	endTime: 2,
	startPosition: [1, 1],
	startVelocity: [1, 2],
	acceleration: [0, -2]
} as const satisfies MotionSegment;

const trajectory = {
	bodyId: 'test-ball',
	segments: [firstSegment, secondSegment]
} as const satisfies BodyTrajectory;

describe('recorded trajectory evaluation', () => {
	it('evaluates canonical positions at segment starts, intermediate times and ends', () => {
		expect(evaluateMotionSegmentPosition(firstSegment, 0)).toEqual([0, 2]);
		expect(evaluateMotionSegmentPosition(firstSegment, 0.5)).toEqual([0.5, 1.75]);
		expect(evaluateMotionSegmentPosition(firstSegment, 1)).toEqual([1, 1]);
		expect(evaluateMotionSegmentPosition(secondSegment, 1)).toEqual([1, 1]);
		expect(evaluateMotionSegmentPosition(secondSegment, 1.5)).toEqual([1.5, 1.75]);
		expect(evaluateMotionSegmentPosition(secondSegment, 2)).toEqual([2, 2]);
	});

	it('evaluates canonical velocities from the same recorded segment definition', () => {
		expect(evaluateMotionSegmentVelocity(firstSegment, 0)).toEqual([1, 0]);
		expect(evaluateMotionSegmentVelocity(firstSegment, 0.5)).toEqual([1, -1]);
		expect(evaluateMotionSegmentVelocity(firstSegment, 1)).toEqual([1, -2]);
		expect(evaluateMotionSegmentVelocity(secondSegment, 1)).toEqual([1, 2]);
		expect(evaluateMotionSegmentVelocity(secondSegment, 2)).toEqual([1, 0]);
	});

	it('evaluates a ballistic segment from immutable conditions at a non-zero start time', () => {
		const segment = {
			type: 'free-flight',
			bodyId: 'offset-time-ball',
			startTime: 10,
			endTime: 12,
			startPosition: [3, 7],
			startVelocity: [-2, 4],
			acceleration: [1, -2]
		} as const satisfies MotionSegment;

		expect(evaluateMotionSegmentPosition(segment, 12)).toEqual([1, 11]);
		expect(evaluateMotionSegmentVelocity(segment, 12)).toEqual([0, 0]);
		expect(segment).toEqual({
			type: 'free-flight',
			bodyId: 'offset-time-ball',
			startTime: 10,
			endTime: 12,
			startPosition: [3, 7],
			startVelocity: [-2, 4],
			acceleration: [1, -2]
		});
	});

	it('evaluates a trajectory only across its inclusive recorded time range', () => {
		expect(evaluateBodyTrajectoryPosition(trajectory, -Number.EPSILON)).toBeNull();
		expect(evaluateBodyTrajectoryPosition(trajectory, 0)).toEqual([0, 2]);
		expect(evaluateBodyTrajectoryPosition(trajectory, 1)).toEqual([1, 1]);
		expect(evaluateBodyTrajectoryPosition(trajectory, 2)).toEqual([2, 2]);
		expect(evaluateBodyTrajectoryPosition(trajectory, 2.001)).toBeNull();
	});

	it('preserves continuous positions at adjacent segment boundaries', () => {
		const firstEnd = evaluateMotionSegmentPosition(firstSegment, firstSegment.endTime);
		const secondStart = evaluateMotionSegmentPosition(secondSegment, secondSegment.startTime);

		expect(firstEnd).toEqual(secondStart);
	});

	it('evaluates circular constrained motion from the shared energy trajectory', () => {
		const seed = {
			centre: [0, 0],
			contactRadius: 1,
			startAngle: 2,
			direction: 1,
			startTangentialSpeed: 0.2,
			gravity: [0, -10]
		} as const;
		const endAngle = 2.4;
		const endTime = circularContactTravelTime(seed, endAngle);
		const segment = {
			type: 'circular-contact',
			bodyId: 'circle-ball',
			startTime: 0,
			endTime,
			startPosition: [Math.cos(seed.startAngle), Math.sin(seed.startAngle)],
			startVelocity: [-Math.sin(seed.startAngle) * 0.2, Math.cos(seed.startAngle) * 0.2],
			supportingColliderId: 'peg',
			...seed,
			endAngle
		} satisfies CircularContactMotionSegment;
		const middle = evaluateCircularContactState(segment, endTime / 2);

		expect(Math.hypot(...middle.position)).toBeCloseTo(1, 12);
		expect(middle.angle).toBeGreaterThan(segment.startAngle);
		expect(middle.angle).toBeLessThan(segment.endAngle);
		expect(evaluateMotionSegmentPosition(segment, endTime)).toEqual([
			Math.cos(endAngle),
			Math.sin(endAngle)
		]);
		expect(
			Math.abs(middle.position[0] * middle.velocity[0] + middle.position[1] * middle.velocity[1])
		).toBeLessThan(1e-10);
	});

	it('integrates finite travel time through exact rest at either circular-segment endpoint', () => {
		const uphill = {
			centre: [0, 0],
			contactRadius: 0.6,
			startAngle: 2,
			direction: -1,
			startTangentialSpeed: 0.1,
			gravity: [0, -10]
		} as const;
		const turningAngle = Math.PI - Math.asin(Math.sin(uphill.startAngle) + 0.1 ** 2 / 12);
		const uphillTime = circularContactTravelTime(uphill, turningAngle);
		const downhillTime = circularContactTravelTime(
			{ ...uphill, startAngle: turningAngle, direction: 1, startTangentialSpeed: 0 },
			uphill.startAngle
		);

		expect(uphillTime).toBeGreaterThan(0);
		expect(uphillTime).toBeLessThan(1);
		expect(downhillTime).toBeCloseTo(uphillTime, 8);
	});
});
