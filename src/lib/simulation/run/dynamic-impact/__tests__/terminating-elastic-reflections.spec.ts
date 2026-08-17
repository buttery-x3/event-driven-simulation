import { describe, expect, it } from 'vitest';
import { solveTerminatingElasticReflections } from '../terminating-elastic-reflections';

describe('terminating elastic reflection kernel', () => {
	it('solves a preconstructed generalized problem without physical contact semantics', () => {
		const result = solveTerminatingElasticReflections({
			velocity: [-3],
			masses: [2],
			inverseMasses: [0.5],
			gradients: [[1]],
			tolerances: {
				numerical: 1e-12,
				absoluteNormalVelocityFloor: 1e-14,
				relativeViolationEpsilon: 1e-12,
				maximumReflections: 8
			}
		});

		expect(typeof result).not.toBe('string');
		if (typeof result === 'string') throw new Error(result);
		expect(result.velocity).toEqual([3]);
		expect(result.reflections).toHaveLength(1);
		expect(result.reflections[0]?.violatingGradientIndices).toEqual([0]);
		expect(result.reflections[0]).not.toHaveProperty('violatingContactIds');
	});
});
