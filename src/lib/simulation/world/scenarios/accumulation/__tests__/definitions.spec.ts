import { describe, expect, it } from 'vitest';
import { constructSimulationRun } from '../../../../run';
import { validateSimulationRun } from '../../../../verification';
import { accumulationScenarios } from '../definitions';

const requiredIds = [
	'flame-46-exact-fit-generalised',
	'flame-46-oversized-generalised',
	'three-ball-settlement',
	'dynamic-alternating-supports',
	'multi-body-non-alternating-accumulation',
	'lineality-created-at-accumulation',
	'accumulation-separates-components',
	'incremental-pile-formation',
	'twenty-ball-container-drop',
	'pile-reactivated-after-settlement',
	'dense-nonconverging-cascade',
	'uncertifiable-temporal-tail',
	'uncertifiable-limit-geometry'
] as const;

describe('FLAME-57 production accumulation scenarios', () => {
	it('publishes every required named workbench scenario', () => {
		expect(accumulationScenarios.map(({ id }) => id)).toEqual(requiredIds);
	});

	it.each(accumulationScenarios)(
		'$id produces a valid replayable authoritative run',
		(scenario) => {
			const run = constructSimulationRun(scenario.input);

			expect(scenario.expectedOutcomes, JSON.stringify(run.terminalReason)).toContain(run.outcome);
			expect(validateSimulationRun(scenario.input, run).failures).toEqual([]);
		}
	);

	it('routes both FLAME-46 fixtures through general downstream resolution', () => {
		const exact = constructSimulationRun(accumulationScenarios[0].input);
		const oversized = constructSimulationRun(accumulationScenarios[1].input);

		expect(
			exact.diagnostics.accumulations?.some(
				({ mechanism, finalClassification }) =>
					mechanism === 'general-accumulation' && finalClassification === 'release'
			)
		).toBe(true);
		expect(
			oversized.diagnostics.accumulations?.some(
				({ mechanism, finalClassification }) =>
					mechanism === 'general-accumulation' && finalClassification === 'rest'
			)
		).toBe(true);
	});

	it('completes the three-ball and twenty-ball supported stress cases without event limits', () => {
		for (const id of ['three-ball-settlement', 'twenty-ball-container-drop']) {
			const scenario = accumulationScenarios.find((candidate) => candidate.id === id)!;
			const run = constructSimulationRun(scenario.input);
			expect(run.outcome, `${id}: ${JSON.stringify(run.terminalReason)}`).toBe('settled');
			expect(run.terminalReason.type, id).not.toBe('event-limit');
		}
	});

	it('does not promote the dense elastic non-converging case', () => {
		const scenario = accumulationScenarios.find(({ id }) => id === 'dense-nonconverging-cascade')!;
		const run = constructSimulationRun(scenario.input);
		expect(
			run.diagnostics.accumulations?.some(
				({ status, finalClassification }) =>
					status === 'certified' && finalClassification !== 'pending'
			)
		).toBe(false);
	});

	it('reactivates the recorded resting component when the scheduled striker arrives', () => {
		const scenario = accumulationScenarios.find(
			({ id }) => id === 'pile-reactivated-after-settlement'
		)!;
		const run = constructSimulationRun(scenario.input);
		expect(run.componentEvents.some((event) => event.reactivatedBodyIds?.length)).toBe(true);
	});
});
