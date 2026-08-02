import { describe, expect, it } from 'vitest';
import { constructSingleBallRun } from '../../run';
import { createDiagnosticExport } from '../../serialization/diagnostic-export';
import { parseSimulationRunFixture } from '../../serialization/run-record';
import {
	adversarialScenarios,
	boardStateScenarios,
	canonicalPlinkoScenarios,
	manifoldContactScenarios,
	type VerificationScenario
} from '../../world';
import { runValidationCategories, validateSimulationRun } from '..';

const completeCatalogue: readonly VerificationScenario[] = [
	...canonicalPlinkoScenarios,
	...boardStateScenarios,
	...manifoldContactScenarios,
	...adversarialScenarios
];

describe('named simulation-run validation', () => {
	it('passes every named scenario through every Tier 1 category', () => {
		for (const scenario of completeCatalogue) {
			const run = constructSingleBallRun(scenario.input);
			const result = validateSimulationRun(scenario.input, run);

			expect(result.checkedCategories, scenario.id).toEqual(runValidationCategories);
			expect(result.failures, scenario.id).toEqual([]);
			expect(result.valid, scenario.id).toBe(true);
		}
	});

	it('returns the same result after complete and partial run serialization', () => {
		for (const scenario of completeCatalogue) {
			const run = constructSingleBallRun(scenario.input);
			const restored = parseSimulationRunFixture(JSON.stringify(run));

			expect(validateSimulationRun(restored.input, restored), scenario.id).toEqual(
				validateSimulationRun(scenario.input, run)
			);
		}
	});

	it('does not let diagnostic export formatting alter authoritative validation values', () => {
		const scenario = canonicalPlinkoScenarios.find(({ id }) => id === 'offset-drop')!;
		const run = constructSingleBallRun(scenario.input);
		const before = validateSimulationRun(scenario.input, run);
		const bundle = createDiagnosticExport(run, {
			exportedAt: '2026-08-03T00:00:00.000Z',
			scenarioId: scenario.id
		});

		expect(bundle.submittedInput).toBe(run.input);
		expect(bundle.authoritativeRun.trajectories).toBe(run.trajectories);
		expect(bundle.authoritativeRun.events).toBe(run.events);
		expect(bundle.summary.playableUntilTime).toBe(run.diagnostics.simulatedUntilTime);
		expect(validateSimulationRun(scenario.input, run)).toEqual(before);
	});
});
