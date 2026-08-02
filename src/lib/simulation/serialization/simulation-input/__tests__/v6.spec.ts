import { describe, expect, it } from 'vitest';
import { canonicalPlinkoScenarios } from '../../../world';
import { RunFixtureError } from '../../run-record';
import { validateSimulationInputV6 } from '../v6';

describe('version 6 simulation-input structural validation', () => {
	it('owns standalone input shape validation and typed failures', () => {
		const malformed = structuredClone(canonicalPlinkoScenarios[0].input) as unknown as {
			initialDynamicBodies: Array<{ physicalShape: { radius?: number } }>;
		};
		delete malformed.initialDynamicBodies[0]!.physicalShape.radius;

		expect(() => validateSimulationInputV6(malformed)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_SIMULATION_INPUT',
				path: '$.initialDynamicBodies[0].physicalShape.radius'
			})
		);
	});
});
