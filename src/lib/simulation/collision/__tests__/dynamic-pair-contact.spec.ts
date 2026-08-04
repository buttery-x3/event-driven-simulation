import { describe, expect, it } from 'vitest';
import type { MotionSegment, Vec2 } from '../../contracts';
import {
	buildDynamicPairContactPolynomial,
	findEarliestDynamicPairContact,
	type DynamicCirclePathParticipant,
	type DynamicPairContactQuery
} from '../dynamic-pair';

describe('continuous dynamic circle-path contact solving', () => {
	it('finds the earliest head-on contact from relative path roots', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [-2, 0], [1, 0]), path('b', [2, 0], [-1, 0]))
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(1.5, 10);
		expect(result.state.normalFromFirstToSecond).toEqual([1, 0]);
		expect(result.state.relativeVelocity).toEqual([-2, 0]);
		expect(result.state.relativeNormalMotion).toBe(-2);
		expect(result.diagnostics.polynomialDegree).toBe(2);
		expect(result.diagnostics.candidates[0]).toMatchObject({
			topology: 'entering',
			classification: 'accepted-impact'
		});
	});

	it('preserves roots, time and classification when participant order is swapped', () => {
		const forward = findEarliestDynamicPairContact(
			query(path('a', [-2, -0.2], [1, 0]), path('b', [2, 0.2], [-1, 0]))
		);
		const swapped = findEarliestDynamicPairContact(
			query(path('b', [2, 0.2], [-1, 0]), path('a', [-2, -0.2], [1, 0]))
		);

		expect(forward.type).toBe('contact');
		expect(swapped.type).toBe('contact');
		if (forward.type !== 'contact' || swapped.type !== 'contact') return;
		expect(swapped.state.time).toBeCloseTo(forward.state.time, 12);
		expect(swapped.state.response).toBe(forward.state.response);
		expect(swapped.diagnostics.isolatedRoots).toEqual(forward.diagnostics.isolatedRoots);
		expect(swapped.diagnostics.polynomialCoefficients).toEqual(
			forward.diagnostics.polynomialCoefficients
		);
		expect(swapped.state.normalFromFirstToSecond[0]).toBeCloseTo(
			-forward.state.normalFromFirstToSecond[0],
			12
		);
		expect(swapped.state.normalFromFirstToSecond[1]).toBeCloseTo(
			-forward.state.normalFromFirstToSecond[1],
			12
		);
	});

	it('constructs swap-invariant relative polynomial coefficients directly', () => {
		const first = participant(path('a', [-1, 2], [3, -1], [0, -9.81]));
		const second = participant(path('b', [4, 3], [-2, 2], [1, -4]));
		const forward = buildDynamicPairContactPolynomial(first, second, 0.25, 2.5);
		const swapped = buildDynamicPairContactPolynomial(second, first, 0.25, 2.5);

		expect(swapped.polynomialCoefficients).toEqual(forward.polynomialCoefficients);
		expect(swapped.relativeCoefficients).toEqual(
			forward.relativeCoefficients.map(([x, y]) => [-x, -y])
		);
	});

	it('reduces equal-gravity free-flight paths to a quadratic equation', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [-2, 3], [1, 0], [0, -9.81]), path('b', [2, 3], [-1, 0], [0, -9.81]))
		);

		expect(result.diagnostics.polynomialDegree).toBe(2);
		expect(result.diagnostics.normalizedPolynomialCoefficients).toHaveLength(3);
		expect(result.type).toBe('contact');
	});

	it('finds a mixed free-flight and linear-contact path root', () => {
		const result = findEarliestDynamicPairContact(
			query(
				path('free', [-2, 1], [1.5, -0.5], [0, -1]),
				path('supported', [1, 0], [-0.25, 0], [0, 0], 'linear-contact')
			)
		);

		expect(result.type).toBe('contact');
		expect(result.diagnostics.pathTypes).toEqual(['free-flight', 'linear-contact']);
		expect(result.diagnostics.polynomialDegree).toBe(4);
	});

	it('reports no contact for a close dynamic near miss', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [-2, -0.51], [1, 0]), path('b', [2, 0.51], [-1, 0]))
		);

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.candidates).toEqual([]);
	});

	it('rejects an external grazing root instead of promoting it to impact', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [-2, 1], [1, 0]), path('b', [0, 0], [0, 0]))
		);

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.candidates[0]).toMatchObject({
			topology: 'grazing',
			classification: 'rejected-grazing'
		});
	});

	it('supports a moving path against a stationary recorded path', () => {
		const stationary = {
			type: 'stationary',
			bodyId: 'resting',
			startTime: 0,
			endTime: 5,
			startPosition: [0, 0],
			startVelocity: [0, 0],
			reason: 'resting-contact',
			componentId: null
		} as const;
		const result = findEarliestDynamicPairContact(
			query(path('moving', [-2, 0], [1, 0], [0, 0], 'free-flight', 0, 5), stationary)
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(1, 12);
		expect(result.diagnostics.pathTypes).toEqual(['free-flight', 'stationary']);
	});

	it('clips the search to the earlier local path horizon', () => {
		const first = path('a', [-2, 0], [1, 0], [0, 0], 'free-flight', 0, 1);
		const second = path('b', [2, 0], [-1, 0], [0, 0], 'free-flight', 0, 4);
		const result = findEarliestDynamicPairContact(query(first, second));

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.searchInterval).toEqual([0, 1]);
		expect(result.diagnostics.localEventHorizons).toEqual([1, 4]);
	});

	it('handles exact zero-duration boundary contact without normalization', () => {
		const result = findEarliestDynamicPairContact({
			...query(
				path('a', [-1.5, 0], [0.5, 0], [0, 0], 'free-flight', 0, 2),
				path('b', [1.5, 0], [-0.5, 0], [0, 0], 'free-flight', 0, 2)
			),
			currentTime: 2
		});

		expect(result.type).toBe('contact');
		expect(result.diagnostics.normalizedIntervalScale).toBe(0);
		expect(result.diagnostics.polynomialCoefficients).toEqual([]);
	});

	it('rejects initial separating contact and accepts a later re-entry root', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [0, 0], [0, 0]), path('b', [1, 0], [1, 0], [-2, 0], 'free-flight', 0, 2))
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(1, 10);
		expect(result.diagnostics.candidates.map(({ classification }) => classification)).toEqual([
			'rejected-exiting',
			'accepted-impact'
		]);
	});

	it('rejects penetrating, reversed and unsupported circular input explicitly', () => {
		const overlap = findEarliestDynamicPairContact(
			query(path('a', [0, 0], [0, 0]), path('b', [0.5, 0], [0, 0]))
		);
		expect(overlap).toMatchObject({ type: 'invalid-input' });

		const reversed = findEarliestDynamicPairContact({
			...query(path('a', [-2, 0], [1, 0]), path('b', [2, 0], [-1, 0])),
			currentTime: 11
		});
		expect(reversed).toMatchObject({ type: 'invalid-input' });
	});
});

function query(firstPath: MotionSegment, secondPath: MotionSegment): DynamicPairContactQuery {
	if (firstPath.type === 'circular-contact' || secondPath.type === 'circular-contact') {
		throw new Error('Test helper only accepts polynomial paths.');
	}
	return {
		first: participant(firstPath),
		second: participant(secondPath),
		currentTime: Math.max(firstPath.startTime, secondPath.startTime)
	};
}

function participant(pathValue: Exclude<MotionSegment, { type: 'circular-contact' }>) {
	return {
		bodyId: pathValue.bodyId,
		revision: 0,
		radius: 0.5,
		path: pathValue
	} as const satisfies DynamicCirclePathParticipant;
}

function path(
	bodyId: string,
	startPosition: Vec2,
	startVelocity: Vec2,
	acceleration: Vec2 = [0, 0],
	type: 'free-flight' | 'linear-contact' = 'free-flight',
	startTime = 0,
	endTime = 10
): Exclude<MotionSegment, { type: 'circular-contact' | 'stationary' }> {
	const base = {
		bodyId,
		startTime,
		endTime,
		startPosition,
		startVelocity,
		acceleration
	};
	return type === 'free-flight'
		? { ...base, type }
		: {
				...base,
				type,
				supportingColliderId: 'support',
				contactNormal: [0, 1]
			};
}
