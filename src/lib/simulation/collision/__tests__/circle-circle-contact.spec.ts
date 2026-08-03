import { describe, expect, it } from 'vitest';
import highSpeedRegressionJson from '../../../../../fixtures/regressions/flame-27-high-speed-peg-contact.json?raw';
import type {
	ConstantAccelerationMotionSegment,
	StaticCircleCollider,
	Vec2
} from '../../contracts';
import type { IsolatedPolynomialRoot } from '../../math';
import {
	classifyCircleCircleRootTopology,
	defaultCircleCircleContactTolerances,
	findEarliestCircleCircleContact,
	type CircleCircleContactQuery
} from '../circle-circle';
import { findToleranceContainedGrazingExit } from '../circle-circle/root-topology';
import { parseSimulationRunFixture } from '../../serialization/run-record';

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
): ConstantAccelerationMotionSegment {
	return {
		type: 'free-flight',
		bodyId: 'ball-test',
		startTime,
		endTime,
		startPosition,
		startVelocity,
		acceleration
	};
}

function query(
	motionSegment: ConstantAccelerationMotionSegment,
	searchUntilTime = motionSegment.endTime
): CircleCircleContactQuery {
	return {
		segment: motionSegment,
		ballRadius: 0.5,
		circle: peg,
		searchUntilTime
	};
}

describe('continuous ballistic circle-circle contact solving', () => {
	it('finds a known gravity-driven direct hit and returns its event state', () => {
		const result = findEarliestCircleCircleContact(query(segment([0, 5], [0, 0], [0, -2], 2, 5)));

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
		expect(motionSegment.type).toBe('free-flight');
		if (motionSegment.type !== 'free-flight') return;
		const collider = run.input.scene.staticColliders[0] as StaticCircleCollider;
		const expectedEvent = run.events[0]!;
		const result = findEarliestCircleCircleContact({
			segment: motionSegment,
			ballRadius: body.physicalShape.radius,
			circle: collider,
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
		const result = findEarliestCircleCircleContact(
			query(segment([-2, 0], [speed, 0], [0, 0], 0, 4 / speed), 4 / speed)
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1 / speed, 12);
	});

	it('reports no contact when the only mathematical contact is in the past', () => {
		const result = findEarliestCircleCircleContact(query(segment([2, 0], [1, 0])));

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.candidates).toEqual([]);
	});

	it('reports no contact for a path that misses the peg', () => {
		const result = findEarliestCircleCircleContact(query(segment([-2, 1.1], [1, 0])));

		expect(result.type).toBe('no-contact');
	});

	it('accepts an exact tangent root isolated at a polynomial critical point', () => {
		const result = findEarliestCircleCircleContact(query(segment([-2, 1], [1, 0]), 4));

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.candidates[0]?.source).toBe('critical-point');
		expect(result.diagnostics.candidates[0]).toMatchObject({
			topology: 'grazing',
			classification: 'rejected-grazing'
		});
	});

	it.each([-1e-8, 1e-8])(
		'classifies separated tangent neighbourhoods as grazing despite %s normal velocity noise',
		(normalVelocity) => {
			const evidence = classifyCircleCircleRootTopology(
				{
					normalizedTime: 0.5,
					source: 'critical-point',
					refinementIterations: 1,
					isolatingInterval: [0.49, 0.51],
					neighbourhood: {
						before: { normalizedTime: 0.49, value: 1 },
						after: { normalizedTime: 0.51, value: 1 }
					}
				},
				normalVelocity,
				defaultCircleCircleContactTolerances.normalVelocity,
				defaultCircleCircleContactTolerances.contactDistance,
				() => 1e-6
			);

			expect(evidence).toEqual({
				topology: 'grazing',
				before: 'separated',
				after: 'separated'
			});
		}
	);

	it.each([
		{ before: 1e-6, after: -1e-6, normalVelocity: 1e-8, topology: 'entering' },
		{ before: -1e-6, after: 1e-6, normalVelocity: -1e-8, topology: 'exiting' }
	] as const)(
		'uses $topology neighbourhood topology before a contradictory derivative sign',
		({ before, after, normalVelocity, topology }) => {
			const evidence = classifyCircleCircleRootTopology(
				{
					normalizedTime: 0.5,
					source: 'bracketed-root',
					refinementIterations: 1,
					isolatingInterval: [0.49, 0.51],
					neighbourhood: {
						before: { normalizedTime: 0.4, value: before },
						after: { normalizedTime: 0.6, value: after }
					}
				},
				normalVelocity,
				defaultCircleCircleContactTolerances.normalVelocity,
				defaultCircleCircleContactTolerances.contactDistance,
				(normalizedTime) => (normalizedTime < 0.5 ? before : after)
			);

			expect(evidence.topology).toBe(topology);
		}
	);

	it.each([
		{ depth: 5e-4, expectedExit: true },
		{ depth: 2e-3, expectedExit: false }
	])(
		'certifies a nondecisive root cluster only when penetration $depth stays within tolerance',
		({ depth, expectedExit }) => {
			const offset = Math.sqrt(depth);
			const rootTimes = [0.5 - offset, 0.5 + offset];
			const separationAt = (normalizedTime: number): number => (normalizedTime - 0.5) ** 2 - depth;
			const roots = rootTimes.map((normalizedTime) => isolatedRoot(normalizedTime, separationAt));

			const exit = findToleranceContainedGrazingExit(
				roots,
				0,
				[0.25 - depth, -1, 1],
				1e-12,
				1e-12,
				100,
				1e-3,
				separationAt
			);

			expect(exit === rootTimes[1]).toBe(expectedExit);
		}
	);

	it('certifies one isolated tangent root from wider separated evidence', () => {
		const separationAt = (normalizedTime: number): number => (normalizedTime - 0.5) ** 2;
		const root = isolatedRoot(0.5, separationAt);

		expect(
			findToleranceContainedGrazingExit(
				[root],
				0,
				[0.25, -1, 1],
				1e-12,
				1e-12,
				100,
				1e-3,
				separationAt
			)
		).toBe(0.5);
	});

	it('preserves classification for mirror-equivalent circle paths', () => {
		const leftToRight = findEarliestCircleCircleContact(query(segment([-2, 0.4], [1, 0]), 4));
		const rightToLeft = findEarliestCircleCircleContact(query(segment([2, 0.4], [-1, 0]), 4));

		expect(leftToRight.type).toBe('contact');
		expect(rightToLeft.type).toBe('contact');
		if (leftToRight.type !== 'contact' || rightToLeft.type !== 'contact') return;
		expect(rightToLeft.state.response).toBe(leftToRight.state.response);
		expect(rightToLeft.event.time).toBeCloseTo(leftToRight.event.time, 12);
		expect(rightToLeft.event.position[0]).toBeCloseTo(-leftToRight.event.position[0], 12);
		expect(rightToLeft.event.position[1]).toBeCloseTo(leftToRight.event.position[1], 12);
		expect(rightToLeft.event.normal[0]).toBeCloseTo(-leftToRight.event.normal[0], 12);
		expect(rightToLeft.event.normal[1]).toBeCloseTo(leftToRight.event.normal[1], 12);
	});

	it('finds a near-tangent contact with a shallow approaching normal velocity', () => {
		const result = findEarliestCircleCircleContact(query(segment([-2, 0.999999], [1, 0]), 4));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeLessThan(2);
		expect(result.state.normalVelocity).toBeLessThan(0);
		expect(Math.abs(result.state.normalVelocity)).toBeLessThan(0.002);
	});

	it('classifies zero-speed inward onset as non-impulsive entry', () => {
		const result = findEarliestCircleCircleContact(
			query(segment([-1, 0], [0, 0], [1, 0], 0, 1), 1)
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state).toMatchObject({
			normalVelocity: 0,
			response: 'non-impulsive-contact'
		});
		expect(result.diagnostics.candidates[0]).toMatchObject({
			topology: 'initial-contact',
			afterRegion: 'overlapping',
			classification: 'accepted-non-impulsive'
		});
	});

	it('rejects release-owned roots until separation, then accepts genuine recollision', () => {
		const result = findEarliestCircleCircleContact({
			...query(segment([1, 0], [1, 0], [-2, 0], 0, 2), 2),
			releasedInitialContact: true
		});

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1, 8);
		expect(result.state.response).toBe('impact');
		expect(result.diagnostics.candidates.map(({ classification }) => classification)).toEqual([
			'rejected-release-owned',
			'accepted-impact'
		]);
	});

	it('fails closed when a released circle re-enters before tolerance-sized separation', () => {
		const result = findEarliestCircleCircleContact({
			...query(segment([1, 0], [0.0001, 0], [-10, 0], 0, 0.01), 0.01),
			releasedInitialContact: true
		});

		expect(result).toMatchObject({
			type: 'unresolved',
			reason: 'Released circle contact re-entered before positive separation was certified.'
		});
		expect(result.diagnostics.candidates.map(({ classification }) => classification)).toEqual([
			'rejected-release-owned',
			'rejected-release-owned'
		]);
	});

	it('certifies an explicitly allowed release passage whose penetration stays within tolerance', () => {
		const result = findEarliestCircleCircleContact({
			...query(segment([0.9999999995, 0.00004], [0, -1], [0, 0], 0, 0.00008), 0.00008),
			releasedInitialContact: true,
			allowToleranceContainedReleasePassage: true
		});

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.candidates.map(({ classification }) => classification)).toEqual([
			'rejected-release-owned',
			'rejected-release-owned'
		]);
	});

	it('rejects an allowed release passage whose penetration exceeds tolerance', () => {
		const result = findEarliestCircleCircleContact({
			...query(segment([0.999999998, 0.00007], [0, -1], [0, 0], 0, 0.00014), 0.00014),
			releasedInitialContact: true,
			allowToleranceContainedReleasePassage: true
		});

		expect(result).toMatchObject({
			type: 'unresolved',
			reason: 'Released circle contact re-entered before positive separation was certified.'
		});
	});

	it('fails closed when released contact remains indeterminate', () => {
		const result = findEarliestCircleCircleContact({
			...query(segment([-1, 0], [0, 0])),
			releasedInitialContact: true
		});

		expect(result).toMatchObject({
			type: 'unresolved',
			reason: 'Released circle contact remained indeterminate across the search interval.'
		});
	});

	it('accepts exact initial contact when not separating', () => {
		const result = findEarliestCircleCircleContact(query(segment([-1, 0], [1, 0])));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBe(0);
		expect(result.diagnostics.candidates[0]?.source).toBe('boundary');
	});

	it('accepts stationary initial contact despite a degenerate contact polynomial', () => {
		const result = findEarliestCircleCircleContact(query(segment([-1, 0], [0, 0])));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBe(0);
		expect(result.state.normalVelocity).toBe(0);
	});

	it('rejects a separating initial root and returns the later approaching root', () => {
		const result = findEarliestCircleCircleContact(
			query(segment([1, 0], [1, 0], [-2, 0], 0, 1.5), 1.5)
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1, 8);
		expect(result.diagnostics.candidates.map(({ classification }) => classification)).toEqual([
			'rejected-exiting',
			'accepted-impact'
		]);
	});

	it('returns the entry root when the contact polynomial also contains an exit root', () => {
		const result = findEarliestCircleCircleContact(query(segment([-2, 0], [1, 0]), 4));

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1, 8);
		expect(result.state.normalVelocity).toBeLessThan(0);
	});

	it('does not return contact beyond the declared search horizon', () => {
		const result = findEarliestCircleCircleContact(query(segment([-2, 0], [1, 0]), 0.5));

		expect(result.type).toBe('no-contact');
	});

	it('returns unresolved when finite input overflows the contact polynomial', () => {
		const result = findEarliestCircleCircleContact(
			query(segment([1e308, 0], [1e308, 0], [0, 0], 0, 1), 1)
		);

		expect(result).toMatchObject({
			type: 'unresolved',
			reason: 'The contact polynomial could not be represented with finite coefficients.'
		});
	});

	it('returns invalid input for an invalid physical radius', () => {
		const result = findEarliestCircleCircleContact({
			...query(segment([-2, 0], [1, 0])),
			ballRadius: -1
		});

		expect(result).toMatchObject({
			type: 'invalid-input',
			reason: 'The ball radius must be a positive finite number.'
		});
	});

	it('returns unresolved instead of no contact when refinement cannot converge', () => {
		const result = findEarliestCircleCircleContact({
			...query(segment([-2, 0], [1, 0])),
			tolerances: {
				...defaultCircleCircleContactTolerances,
				eventTime: Number.MIN_VALUE
			},
			maximumRefinementIterations: 1
		});

		expect(result.type).toBe('unresolved');
	});
});

function isolatedRoot(
	normalizedTime: number,
	separationAt: (normalizedTime: number) => number
): IsolatedPolynomialRoot {
	const beforeTime = normalizedTime - 1e-3;
	const afterTime = normalizedTime + 1e-3;
	return {
		normalizedTime,
		source: 'bracketed-root',
		refinementIterations: 1,
		isolatingInterval: [beforeTime, afterTime],
		neighbourhood: {
			before: { normalizedTime: beforeTime, value: separationAt(beforeTime) },
			after: { normalizedTime: afterTime, value: separationAt(afterTime) }
		}
	};
}
