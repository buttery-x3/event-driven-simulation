import { describe, expect, it } from 'vitest';
import highSpeedRegressionJson from '../../../fixtures/regressions/flame-28-high-speed-wall-contact.json?raw';
import { findEarliestBoundaryContact, type BoundaryContactQuery } from './boundary-contact';
import type { MotionSegment, StaticLineSegmentCollider, Vec2 } from './contracts';
import { parseSimulationRunFixture } from './run-fixture';

const verticalBoundary = boundary('wall-test', [0, -5], [0, 5]);

function boundary(id: string, start: Vec2, end: Vec2): StaticLineSegmentCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start, end }
	};
}

function segment(
	startPosition: Vec2,
	startVelocity: Vec2,
	acceleration: Vec2 = [0, 0],
	startTime = 0,
	endTime = 10
): MotionSegment {
	return {
		bodyId: 'ball-test',
		startTime,
		endTime,
		startPosition,
		startVelocity,
		acceleration
	};
}

function query(
	motionSegment: MotionSegment,
	targetBoundary = verticalBoundary,
	searchUntilTime = motionSegment.endTime
): BoundaryContactQuery {
	return {
		segment: motionSegment,
		ballRadius: 0.5,
		boundary: targetBoundary,
		searchUntilTime
	};
}

describe('continuous ballistic boundary contact solving', () => {
	it('finds a vertical wall face using the ball radius', () => {
		const result = findEarliestBoundaryContact(query(segment([-2, 0], [1, 0])));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event).toMatchObject({
			time: 1.5,
			bodyId: 'ball-test',
			colliderId: 'wall-test',
			position: [-0.5, 0],
			normal: [-1, 0]
		});
		expect(result.state.contactPoint).toEqual([0, 0]);
		expect(result.state.feature).toBe('segment-face-positive');
	});

	it('finds contact against an angled boundary', () => {
		const angledBoundary = boundary('angled-wall', [-2, -2], [2, 2]);
		const result = findEarliestBoundaryContact(query(segment([0, 2], [0, -1]), angledBoundary));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(2 - Math.SQRT1_2, 9);
		expect(result.event.normal[0]).toBeCloseTo(-Math.SQRT1_2, 9);
		expect(result.event.normal[1]).toBeCloseTo(Math.SQRT1_2, 9);
		expect(result.state.contactPoint[0]).toBeCloseTo(Math.SQRT1_2 / 2, 9);
		expect(result.state.contactPoint[1]).toBeCloseTo(Math.SQRT1_2 / 2, 9);
	});

	it('rejects an infinite-line hit outside the finite segment extent', () => {
		const shortBoundary = boundary('short-wall', [0, -1], [0, 1]);
		const result = findEarliestBoundaryContact(query(segment([-2, 2], [1, 0]), shortBoundary));

		expect(result.type).toBe('no-contact');
		expect(
			result.diagnostics.candidates.some(
				(candidate) => candidate.classification === 'rejected-outside-extent'
			)
		).toBe(true);
	});

	it('uses endpoint geometry immediately beyond the face extent', () => {
		const shortBoundary = boundary('short-wall', [0, -1], [0, 1]);
		const result = findEarliestBoundaryContact(query(segment([-2, 1.4], [1, 0]), shortBoundary));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1.7, 9);
		expect(result.state.feature).toBe('end-endpoint');
		expect(result.state.contactPoint).toEqual([0, 1]);
		expect(result.event.normal[0]).toBeCloseTo(-0.6, 9);
		expect(result.event.normal[1]).toBeCloseTo(0.8, 9);
	});

	it('finds a saved high-speed wall regression without temporal sampling', () => {
		const run = parseSimulationRunFixture(highSpeedRegressionJson);
		const body = run.input.initialDynamicBodies[0]!;
		const motionSegment = run.trajectories[0]!.segments[0]!;
		const targetBoundary = run.input.scene.staticColliders[0] as StaticLineSegmentCollider;
		const expectedEvent = run.events[0]!;
		const result = findEarliestBoundaryContact({
			segment: motionSegment,
			ballRadius: body.physicalShape.radius,
			boundary: targetBoundary,
			searchUntilTime: motionSegment.endTime
		});

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(expectedEvent.time, 12);
		expect(result.event.position).toEqual(expectedEvent.position);
		expect(result.event.normal).toEqual(expectedEvent.normal);
	});

	it('rejects a segment that starts with the ball penetrating the boundary', () => {
		const result = findEarliestBoundaryContact(query(segment([-0.25, 0], [1, 0])));

		expect(result).toMatchObject({
			type: 'invalid-input',
			reason: 'The motion segment starts with the ball penetrating the boundary.'
		});
	});

	it('returns unresolved when finite input overflows an endpoint polynomial', () => {
		const result = findEarliestBoundaryContact(
			query(segment([1e308, 1e308], [1e308, 0], [0, 0], 0, 1), verticalBoundary, 1)
		);

		expect(result.type).toBe('unresolved');
	});
});
