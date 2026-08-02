import { describe, expect, it } from 'vitest';
import type {
	ConstantAccelerationMotionSegment,
	StaticCircleCollider,
	StaticCollider,
	StaticLineSegmentCollider,
	Vec2
} from '../../contracts';
import { findEarliestFixedWorldContact } from '../fixed-world';

function peg(id: string, centre: Vec2, radius = 0.5): StaticCircleCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'circle', radius },
		centre
	};
}

function wall(id: string, x: number, startY = -5, endY = 5): StaticLineSegmentCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [x, startY], end: [x, endY] }
	};
}

function segment(
	startPosition: Vec2 = [-2, 0],
	startVelocity: Vec2 = [1, 0],
	acceleration: Vec2 = [0, 0],
	endTime = 10
): ConstantAccelerationMotionSegment {
	return {
		type: 'free-flight',
		bodyId: 'ball-test',
		startTime: 0,
		endTime,
		startPosition,
		startVelocity,
		acceleration
	};
}

function query(colliders: readonly StaticCollider[], motionSegment = segment()) {
	return {
		segment: motionSegment,
		ballRadius: 0.5,
		colliders,
		searchUntilTime: motionSegment.endTime
	};
}

describe('earliest fixed-world contact selection', () => {
	it('selects a peg when its contact is earlier than the wall contact', () => {
		const result = findEarliestFixedWorldContact(
			query([wall('wall-later', 0), peg('peg-earlier', [0, 0])])
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.candidate.colliderId).toBe('peg-earlier');
		expect(result.event.time).toBeCloseTo(1, 9);
	});

	it('selects a wall when its contact is earlier than the peg contact', () => {
		const result = findEarliestFixedWorldContact(
			query([peg('peg-later', [0, 0]), wall('wall-earlier', -1)])
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.candidate.colliderId).toBe('wall-earlier');
		expect(result.event.time).toBeCloseTo(0.5, 9);
	});

	it('fails closed when eventTime cannot certify ordering versus simultaneity', () => {
		const nearSimultaneousWallX = -0.5 + 0.5e-9;
		const result = findEarliestFixedWorldContact(
			query([wall('wall-near', nearSimultaneousWallX), peg('peg-earliest', [0, 0])])
		);

		expect(result.type).toBe('unresolved');
		if (result.type !== 'unresolved') return;
		expect(result.reason).toContain('not certified at the same time');
		expect(
			result.diagnostics.nearSimultaneousCandidates.map(({ colliderId }) => colliderId)
		).toEqual(['peg-earliest', 'wall-near']);
		expect(
			result.diagnostics.nearSimultaneousCandidates[1]!.time -
				result.diagnostics.nearSimultaneousCandidates[0]!.time
		).toBeGreaterThan(0);
	});

	it('uses collider ID as the deterministic final key for equal event times', () => {
		const result = findEarliestFixedWorldContact(
			query([wall('z-wall', -0.5), peg('a-peg', [0, 0])])
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.event.time).toBeCloseTo(1, 9);
		expect(result.candidate.colliderId).toBe('a-peg');
	});

	it('returns unresolved when one collider calculation is uncertain despite a valid wall event', () => {
		const result = findEarliestFixedWorldContact(
			query([wall('wall-valid', -1), peg('peg-overflow', [1e308, 0])])
		);

		expect(result.type).toBe('unresolved');
		if (result.type !== 'unresolved') return;
		expect(result.reason).toContain('peg-overflow');
		expect(result.diagnostics.orderedCandidates[0]?.colliderId).toBe('wall-valid');
		expect(
			result.diagnostics.colliderEvaluations.find(
				(evaluation) => evaluation.colliderId === 'peg-overflow'
			)?.outcome
		).toBe('unresolved');
	});

	it('returns no event only after every collider reports no contact', () => {
		const result = findEarliestFixedWorldContact(
			query([wall('wall-missed', 0, 2, 3), peg('peg-missed', [0, 2])])
		);

		expect(result.type).toBe('no-event');
		expect(result.diagnostics.orderedCandidates).toEqual([]);
	});

	it('validates the interval even when the world has no colliders', () => {
		const result = findEarliestFixedWorldContact({
			...query([]),
			searchUntilTime: 11
		});

		expect(result).toMatchObject({
			type: 'invalid-input',
			reason: 'The search horizon must be after the segment start and no later than its end.'
		});
	});
});
