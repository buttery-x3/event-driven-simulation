import { describe, expect, it } from 'vitest';
import { prototypeSimulationInput } from '../../world';
import { constructSingleBallRun } from '..';
import { generateSyntheticRun } from '..';

describe('legacy synthetic-run entry point', () => {
	it('delegates to the authoritative event-driven constructor', () => {
		const legacy = generateSyntheticRun(prototypeSimulationInput);
		const authoritative = constructSingleBallRun(prototypeSimulationInput);

		expect({
			...legacy,
			diagnostics: { ...legacy.diagnostics, simulationWallTimeMilliseconds: 0 }
		}).toEqual({
			...authoritative,
			diagnostics: { ...authoritative.diagnostics, simulationWallTimeMilliseconds: 0 }
		});
	});

	it('runs without browser globals', () => {
		expect('window' in globalThis).toBe(false);
		expect('document' in globalThis).toBe(false);
		expect(generateSyntheticRun(prototypeSimulationInput).contractVersion).toBe(7);
	});
});
