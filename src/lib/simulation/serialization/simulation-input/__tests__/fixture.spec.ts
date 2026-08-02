import { describe, expect, it } from 'vitest';
import { canonicalPlinkoScenarios } from '../../../world';
import { RunFixtureError } from '../../run-record/error';
import {
	parseSimulationInputFixture,
	serializeSimulationInputFixture
} from '..';

describe('simulation input fixture boundary', () => {
	it('round-trips a canonical scenario as versioned serialisable input', () => {
		const input = canonicalPlinkoScenarios[1].input;

		expect(parseSimulationInputFixture(serializeSimulationInputFixture(input))).toEqual(input);
	});

	it('rejects structurally invalid and semantically unsupported inputs with typed paths', () => {
		const structurallyInvalid = JSON.parse(
			serializeSimulationInputFixture(canonicalPlinkoScenarios[0].input)
		) as { input: { initialDynamicBodies: Array<{ position: unknown }> } };
		structurallyInvalid.input.initialDynamicBodies[0]!.position = ['left', 1];

		expect(() => parseSimulationInputFixture(JSON.stringify(structurallyInvalid))).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_SIMULATION_INPUT',
				path: '$.input.initialDynamicBodies[0].position[0]'
			})
		);

		const outsideBounds = JSON.parse(
			serializeSimulationInputFixture(canonicalPlinkoScenarios[0].input)
		) as { input: { initialDynamicBodies: Array<{ position: [number, number] }> } };
		outsideBounds.input.initialDynamicBodies[0]!.position = [100, 100];

		expect(() => parseSimulationInputFixture(JSON.stringify(outsideBounds))).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_SIMULATION_INPUT',
				path: '$.initialDynamicBodies[0].position'
			})
		);
	});
});
