import { describe, expect, it } from 'vitest';
import { constructSimulationRun } from '../../run';
import { validateSimulationRun } from '../../verification';
import { parseSimulationRunFixture } from '../../serialization/run-record';
import { dynamicSupportScenarios } from '../scenarios/dynamic-supports';

describe('FLAME-56 certified dynamic support scenarios', () => {
	it('provides every required production-generated scenario', () => {
		expect(dynamicSupportScenarios.map(({ id }) => id)).toEqual([
			'ball-slides-on-wedged-ball',
			'transmitted-load-remains-supported',
			'transmitted-load-releases-support',
			'third-ball-hits-dynamic-support',
			'slider-launched-from-support',
			'unsupported-free-moving-pair'
		]);
		for (const scenario of dynamicSupportScenarios) {
			const run = constructSimulationRun(scenario.input);
			expect(scenario.expectedOutcomes, scenario.id).toContain(run.outcome);
			expect(
				run.trajectories.some((trajectory) =>
					trajectory.segments.some(
						(segment) =>
							segment.type === 'circular-contact' && segment.supportingBodyId === 'support'
					)
				),
				scenario.id
			).toBe(true);
		}
	});

	it('records equal-and-opposite load and non-negative anchored reactions', () => {
		for (const id of [
			'ball-slides-on-wedged-ball',
			'transmitted-load-remains-supported'
		] as const) {
			const run = namedRun(id);
			const evidence = run.diagnostics.dynamicSupports ?? [];
			expect(evidence.length, id).toBeGreaterThan(0);
			for (const interval of evidence) {
				expect(interval.startBodyBodyReaction).toBeGreaterThanOrEqual(0);
				expect(interval.endBodyBodyReaction).toBeGreaterThanOrEqual(0);
				expect(interval.fixedSupportReactionsAtStart.every(({ reaction }) => reaction >= 0)).toBe(
					true
				);
				expect(Math.hypot(...interval.startLoadOnSupport)).toBeCloseTo(
					interval.startBodyBodyReaction,
					8
				);
			}
		}
	});

	it('ends or interrupts the old path at the certified physical boundary', () => {
		expect(
			(namedRun('transmitted-load-releases-support').diagnostics.dynamicSupports ?? []).some(
				({ outcome }) => outcome === 'support-contact-released'
			)
		).toBe(true);
		expect(
			(namedRun('third-ball-hits-dynamic-support').diagnostics.dynamicSupports ?? []).some(
				({ outcome }) => outcome === 'interrupted'
			)
		).toBe(true);
		expect(
			namedRun('third-ball-hits-dynamic-support').dynamicContacts.some(
				({ releaseReason }) => releaseReason === 'interrupted'
			)
		).toBe(true);
		expect(
			(namedRun('slider-launched-from-support').diagnostics.dynamicSupports ?? []).some(
				({ outcome }) => outcome === 'detached'
			)
		).toBe(true);
		expect(namedRun('unsupported-free-moving-pair').terminalReason.type).toBe(
			'unsupported-body-body-response'
		);
	});

	it('passes independent validation for every generated run', () => {
		for (const scenario of dynamicSupportScenarios) {
			const run = constructSimulationRun(scenario.input);
			expect(validateSimulationRun(scenario.input, run).failures, scenario.id).toEqual([]);
		}
	});

	it('round-trips the additive dynamic-support contract evidence', () => {
		const run = namedRun('transmitted-load-releases-support');
		const restored = parseSimulationRunFixture(JSON.stringify(run));
		expect(JSON.stringify(restored)).toBe(JSON.stringify(run));
	});
});

function namedRun(id: (typeof dynamicSupportScenarios)[number]['id']) {
	const scenario = dynamicSupportScenarios.find((candidate) => candidate.id === id)!;
	return constructSimulationRun(scenario.input);
}
