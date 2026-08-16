import { describe, expect, it } from 'vitest';
import { canonicalPlinkoScenarios } from '../../../world';
import { RunFixtureError } from '../../run-record';
import { parseSimulationInputFixture, serializeSimulationInputFixture } from '..';

describe('simulation input fixture boundary', () => {
	it('round-trips a canonical scenario as versioned serialisable input', () => {
		const input = canonicalPlinkoScenarios[1].input;
		const fixture = serializeSimulationInputFixture(input);

		expect(JSON.parse(fixture).input.settings.contactCaptureDistance).toBe(1e-9);
		expect(parseSimulationInputFixture(fixture)).toEqual(input);
	});

	it('normalises missing version 7 capture distance from the historical contact tolerance', () => {
		const fixture = JSON.parse(
			serializeSimulationInputFixture(canonicalPlinkoScenarios[0].input)
		) as {
			input: {
				settings: {
					contactCaptureDistance?: number;
					tolerances: { contactDistance: number };
				};
			};
		};
		fixture.input.settings.tolerances.contactDistance = 2e-8;
		delete fixture.input.settings.contactCaptureDistance;

		const restored = parseSimulationInputFixture(JSON.stringify(fixture));

		expect(restored.settings.contactCaptureDistance).toBe(2e-8);
		expect(restored).toHaveProperty('settings.contactCaptureDistance');
	});

	it('migrates version 6 single-body scenarios with explicit physical defaults', () => {
		const legacy = JSON.parse(
			serializeSimulationInputFixture(canonicalPlinkoScenarios[0].input)
		) as {
			contractVersion: number;
			input: {
				initialDynamicBodies: Array<{ mass?: number; releaseTime?: number }>;
			};
		};
		legacy.contractVersion = 6;
		delete legacy.input.initialDynamicBodies[0]!.mass;
		delete legacy.input.initialDynamicBodies[0]!.releaseTime;

		expect(
			parseSimulationInputFixture(JSON.stringify(legacy)).initialDynamicBodies[0]
		).toMatchObject({ mass: 1, releaseTime: 0 });
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
				path: '$.input.initialDynamicBodies[0].position'
			})
		);
	});
});
