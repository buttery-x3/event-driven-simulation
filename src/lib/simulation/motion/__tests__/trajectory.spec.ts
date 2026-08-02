import { describe, expect, it } from 'vitest';
import type { BodyTrajectory, MotionSegment } from '../../contracts';
import {
	evaluateBodyTrajectoryPosition,
	evaluateMotionSegmentPosition,
	evaluateMotionSegmentVelocity
} from '../trajectory';

const firstSegment = {
	bodyId: 'test-ball',
	startTime: 0,
	endTime: 1,
	startPosition: [0, 2],
	startVelocity: [1, 0],
	acceleration: [0, -2]
} as const satisfies MotionSegment;

const secondSegment = {
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
});
