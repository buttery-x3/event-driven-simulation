import { describe, expect, it } from 'vitest';
import { constructSimulationRun } from '../../run';
import { validateSimulationRun } from '../../verification';
import { dynamicPairScenarios } from '../scenarios';

describe('production dynamic-pair scenarios', () => {
	it('provides every required selectable scenario through the authoritative scheduler', () => {
		expect(dynamicPairScenarios.map(({ id }) => id)).toEqual([
			'predicted-head-on-contact',
			'predicted-glancing-contact',
			'dynamic-near-miss',
			'pair-search-clipped-by-peg-event',
			'linear-contact-pair-prediction',
			'swapped-pair-equivalence'
		]);
		for (const scenario of dynamicPairScenarios) {
			const result = constructSimulationRun(scenario.input);
			expect(scenario.expectedOutcomes, scenario.id).toContain(result.outcome);
			expect(validateSimulationRun(scenario.input, result).failures, scenario.id).toEqual([]);
		}
	});

	it('records touching incoming head-on and non-axis-aligned glancing contacts', () => {
		const headOn = run('predicted-head-on-contact');
		const glancing = run('predicted-glancing-contact');
		expect(headOn.terminalReason.type).toBe('unsupported-body-body-response');
		expect(headOn.dynamicContacts[0]?.preImpactNormalVelocity).toBeLessThan(0);
		expect(glancing.dynamicContacts[0]?.normalFromFirstToSecond[0]).not.toBe(0);
		expect(glancing.dynamicContacts[0]?.normalFromFirstToSecond[1]).not.toBe(0);
	});

	it('keeps the near miss empty and clips a pair search at the peg horizon', () => {
		const nearMiss = run('dynamic-near-miss');
		const clipped = run('pair-search-clipped-by-peg-event');
		expect(nearMiss.dynamicContacts).toEqual([]);
		expect(
			nearMiss.diagnostics.pairPredictions.every(({ predictedTime }) => predictedTime === null)
		).toBe(true);
		const firstPair = clipped.diagnostics.pairPredictions[0]!;
		const firstPeg = clipped.events.find(
			(event) => event.type === 'contact' && event.colliderId === 'clipping-peg'
		)!;
		expect(firstPair.validInterval[1]).toBeCloseTo(firstPeg.time, 12);
		expect(firstPair.predictedTime).toBeNull();
	});

	it('discovers a free-versus-linear-contact path pair', () => {
		const result = run('linear-contact-pair-prediction');
		const selected = result.diagnostics.pairPredictions.find(
			({ decision }) => decision === 'selected'
		)!;
		expect(selected.pathTypes).toContain('linear-contact');
		expect(result.terminalReason.type).toBe('unsupported-body-body-response');
	});

	it('preserves the physical result when serialized body order is reversed', () => {
		const baseline = run('predicted-head-on-contact');
		const swapped = run('swapped-pair-equivalence');
		expect(swapped.dynamicContacts[0]?.time).toBeCloseTo(baseline.dynamicContacts[0]!.time, 12);
		expect(swapped.dynamicContacts[0]?.preImpactNormalVelocity).toBe(
			baseline.dynamicContacts[0]!.preImpactNormalVelocity
		);
		expect(swapped.diagnostics.pairPredictions[0]?.polynomialCoefficients).toEqual(
			baseline.diagnostics.pairPredictions[0]!.polynomialCoefficients
		);
	});
});

function run(id: (typeof dynamicPairScenarios)[number]['id']) {
	const scenario = dynamicPairScenarios.find((candidate) => candidate.id === id)!;
	return constructSimulationRun(scenario.input);
}
