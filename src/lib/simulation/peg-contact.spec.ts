import { describe, expect, it } from 'vitest';
import highSpeedRegressionJson from '../../../fixtures/regressions/flame-27-high-speed-peg-contact.json?raw';
import type { MotionSegment, StaticCircleCollider, Vec2 } from './contracts';
import {
	defaultPegContactTolerances,
	findEarliestPegContact,
	type PegContactQuery
} from './peg-contact';
import { parseSimulationRunFixture } from './run-fixture';

const peg = {
	id: 'peg-test',
	motionAuthority: 'static',
	physicalShape: { type: 'circle', radius: 0.5 },
	centre: [0, 0]
} as const satisfies StaticCircleCollider;

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
	searchUntilTime = motionSegment.endTime
): PegContactQuery {
	return {
		segment: motionSegment,
		ballRadius: 0.5,
		peg,
		searchUntilTime
	};
}

describe('continuous ballistic peg contact solving', () => {
	it('finds a known gravity-driven direct hit and returns its event state', () => {
		const result = findEarliestPegContact(query(segment([0, 5], [0, 0], [0, -2], 2, 5)));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event).toMatchObject({
			type: 'contact',
			bodyId: 'ball-test',
			colliderId: 'peg-test',
			normal: [0, 1]
		});
		expect(result.event.time).toBeCloseTo(4, 8);
		expect(result.event.position[0]).toBe(0);
		expect(result.event.position[1]).toBeCloseTo(1, 8);
		expect(result.state.velocity[0]).toBe(0);
		expect(result.state.velocity[1]).toBeCloseTo(-4, 8);
		expect(result.state.normalVelocity).toBeCloseTo(-4, 8);
	});

	it('finds a saved high-speed regression contact without temporal sampling', () => {
		const run = parseSimulationRunFixture(highSpeedRegressionJson);
		const body = run.input.initialDynamicBodies[0]!;
		const motionSegment = run.trajectories[0]!.segments[0]!;
		const collider = run.input.scene.staticColliders[0] as StaticCircleCollider;
		const expectedEvent = run.events[0]!;
		const result = findEarliestPegContact({
			segment: motionSegment,
			ballRadius: body.physicalShape.radius,
			peg: collider,
			searchUntilTime: motionSegment.endTime
		});

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(expectedEvent.time, 10);
		expect(result.event.position[0]).toBeCloseTo(expectedEvent.position[0], 10);
		expect(result.event.position[1]).toBeCloseTo(expectedEvent.position[1], 10);
		expect(result.event.normal).toEqual(expectedEvent.normal);
	});

	it.each([1, 1_000_000])('finds the same supported contact at %s m/s', (speed) => {
		const result = findEarliestPegContact(
			query(segment([-2, 0], [speed, 0], [0, 0], 0, 4 / speed), 4 / speed)
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1 / speed, 12);
	});

	it('reports no contact when the only mathematical contact is in the past', () => {
		const result = findEarliestPegContact(query(segment([2, 0], [1, 0])));

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.candidates).toEqual([]);
	});

	it('reports no contact for a path that misses the peg', () => {
		const result = findEarliestPegContact(query(segment([-2, 1.1], [1, 0])));

		expect(result.type).toBe('no-contact');
	});

	it('accepts an exact tangent root isolated at a polynomial critical point', () => {
		const result = findEarliestPegContact(query(segment([-2, 1], [1, 0]), 4));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(2, 8);
		expect(result.event.position).toEqual([0, 1]);
		expect(result.state.normalVelocity).toBe(0);
		expect(result.diagnostics.candidates[0]?.source).toBe('critical-point');
	});

	it('finds a near-tangent contact with a shallow approaching normal velocity', () => {
		const result = findEarliestPegContact(query(segment([-2, 0.999999], [1, 0]), 4));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeLessThan(2);
		expect(result.state.normalVelocity).toBeLessThan(0);
		expect(Math.abs(result.state.normalVelocity)).toBeLessThan(0.002);
	});

	it('accepts exact initial contact when not separating', () => {
		const result = findEarliestPegContact(query(segment([-1, 0], [1, 0])));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBe(0);
		expect(result.diagnostics.candidates[0]?.source).toBe('boundary');
	});

	it('accepts stationary initial contact despite a degenerate contact polynomial', () => {
		const result = findEarliestPegContact(query(segment([-1, 0], [0, 0])));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBe(0);
		expect(result.state.normalVelocity).toBe(0);
	});

	it('rejects a separating initial root and returns the later approaching root', () => {
		const result = findEarliestPegContact(query(segment([1, 0], [1, 0], [-2, 0], 0, 1.5), 1.5));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1, 8);
		expect(result.diagnostics.candidates.map(({ classification }) => classification)).toEqual([
			'rejected-separating',
			'accepted'
		]);
	});

	it('returns the entry root when the contact polynomial also contains an exit root', () => {
		const result = findEarliestPegContact(query(segment([-2, 0], [1, 0]), 4));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1, 8);
		expect(result.state.normalVelocity).toBeLessThan(0);
	});

	it('does not return contact beyond the declared search horizon', () => {
		const result = findEarliestPegContact(query(segment([-2, 0], [1, 0]), 0.5));

		expect(result.type).toBe('no-contact');
	});

	it('returns unresolved when finite input overflows the contact polynomial', () => {
		const result = findEarliestPegContact(query(segment([1e308, 0], [1e308, 0], [0, 0], 0, 1), 1));

		expect(result).toMatchObject({
			type: 'unresolved',
			reason: 'The contact polynomial could not be represented with finite coefficients.'
		});
	});

	it('returns invalid input for an invalid physical radius', () => {
		const result = findEarliestPegContact({
			...query(segment([-2, 0], [1, 0])),
			ballRadius: -1
		});

		expect(result).toMatchObject({
			type: 'invalid-input',
			reason: 'The ball radius must be a positive finite number.'
		});
	});

	it('returns unresolved instead of no contact when refinement cannot converge', () => {
		const result = findEarliestPegContact({
			...query(segment([-2, 0], [1, 0])),
			tolerances: {
				...defaultPegContactTolerances,
				eventTime: Number.MIN_VALUE
			},
			maximumRefinementIterations: 1
		});

		expect(result.type).toBe('unresolved');
	});
});
