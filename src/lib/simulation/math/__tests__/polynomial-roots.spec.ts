import { describe, expect, it } from 'vitest';
import { isolatePolynomialRoots } from '../polynomial-roots';

describe('polynomial root neighbourhood evidence', () => {
	it('exposes separated samples around each isolated crossing without contact semantics', () => {
		const result = isolatePolynomialRoots([3, -4, 1], 0, 4, 1e-10, 1e-12, 128);

		expect(result.type).toBe('roots');
		if (result.type !== 'roots') return;
		expect(result.roots).toHaveLength(2);
		expect(result.roots[0]!.normalizedTime).toBeCloseTo(1, 9);
		expect(result.roots[0]!.neighbourhood.before!.value).toBeGreaterThan(0);
		expect(result.roots[0]!.neighbourhood.after!.value).toBeLessThan(0);
		expect(result.roots[1]!.normalizedTime).toBeCloseTo(3, 9);
		expect(result.roots[1]!.neighbourhood.before!.value).toBeLessThan(0);
		expect(result.roots[1]!.neighbourhood.after!.value).toBeGreaterThan(0);
	});

	it('reports one-sided evidence for an initial higher-order root', () => {
		const result = isolatePolynomialRoots([0, 0, 1], 0, 1, 1e-10, 1e-12, 128);

		expect(result.type).toBe('roots');
		if (result.type !== 'roots') return;
		expect(result.roots[0]).toMatchObject({
			normalizedTime: 0,
			isolatingInterval: [0, 0],
			neighbourhood: { before: null }
		});
		expect(result.roots[0]!.neighbourhood.after!.value).toBeGreaterThan(0);
	});
});
