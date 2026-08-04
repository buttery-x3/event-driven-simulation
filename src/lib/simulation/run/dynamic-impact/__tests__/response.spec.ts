import { describe, expect, it } from 'vitest';
import { resolveIsolatedBodyImpact } from '..';

describe('isolated dynamic-body impact response', () => {
	it('exchanges equal-mass head-on velocities at unit restitution', () => {
		expect(response(1, 1, [2, 0], [-1, 0], [1, 0], 1)).toMatchObject({
			impulseMagnitude: 3,
			firstVelocity: [-1, 0],
			secondVelocity: [2, 0],
			preImpactNormalVelocity: -3,
			postImpactNormalVelocity: 3
		});
	});

	it('uses both masses in the closed-form transfer', () => {
		const result = response(1, 3, [4, 0], [0, 0], [1, 0], 0.5);
		expect(result.impulseMagnitude).toBeCloseTo(4.5, 12);
		expect(result.firstVelocity).toEqual([-0.5, 0]);
		expect(result.secondVelocity).toEqual([1.5, 0]);
	});

	it('preserves each tangential component in a glancing impact', () => {
		const result = response(2, 1, [3, 7], [-2, -5], [1, 0], 0.25);
		expect(result.firstVelocity[1]).toBe(7);
		expect(result.secondVelocity[1]).toBe(-5);
	});

	it('is physically invariant when participants and the oriented normal are swapped', () => {
		const baseline = response(2, 5, [3, 1], [-2, 4], [1, 0], 0.75);
		const swapped = response(5, 2, [-2, 4], [3, 1], [-1, 0], 0.75);
		expect(swapped.firstVelocity).toEqual(baseline.secondVelocity);
		expect(swapped.secondVelocity).toEqual(baseline.firstVelocity);
		expect(swapped.impulseMagnitude).toBe(baseline.impulseMagnitude);
	});

	it('fails closed for invalid or non-incoming inputs', () => {
		expect(resolveIsolatedBodyImpact(base({ firstMass: Number.NaN })).type).toBe('rejected');
		expect(resolveIsolatedBodyImpact(base({ firstMass: 0 })).type).toBe('rejected');
		expect(resolveIsolatedBodyImpact(base({ restitution: 1.01 })).type).toBe('rejected');
		expect(
			resolveIsolatedBodyImpact(base({ firstVelocity: [-1, 0], secondVelocity: [1, 0] })).type
		).toBe('rejected');
	});
});

function response(
	firstMass: number,
	secondMass: number,
	firstVelocity: readonly [number, number],
	secondVelocity: readonly [number, number],
	normalFromFirstToSecond: readonly [number, number],
	restitution: number
) {
	const result = resolveIsolatedBodyImpact({
		firstMass,
		secondMass,
		firstVelocity,
		secondVelocity,
		normalFromFirstToSecond,
		restitution,
		tolerance: 1e-12
	});
	if (result.type !== 'response') throw new Error(result.reason);
	return result.response;
}

function base(overrides: Partial<Parameters<typeof resolveIsolatedBodyImpact>[0]>) {
	return {
		firstMass: 1,
		secondMass: 1,
		firstVelocity: [1, 0] as const,
		secondVelocity: [-1, 0] as const,
		normalFromFirstToSecond: [1, 0] as const,
		restitution: 1,
		tolerance: 1e-12,
		...overrides
	};
}
