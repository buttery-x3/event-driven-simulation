import { describe, expect, it } from 'vitest';
import { constructSimulationRun } from '../../run';
import { validateSimulationRun } from '../../verification';
import { independentBodySchedulerScenarios } from '../scenarios';

describe('production independent-body scheduler scenarios', () => {
	it('provides every required named scenario through the authoritative scheduler', () => {
		expect(independentBodySchedulerScenarios.map(({ id }) => id)).toEqual([
			'staggered-independent-drops',
			'mixed-independent-outcomes',
			'resting-while-another-continues',
			'simultaneous-independent-events',
			'single-body-scheduler-equivalence'
		]);
		for (const scenario of independentBodySchedulerScenarios) {
			const run = constructSimulationRun(scenario.input);
			expect(scenario.expectedOutcomes, scenario.id).toContain(run.outcome);
			expect(validateSimulationRun(scenario.input, run).failures, scenario.id).toEqual([]);
			expect(run.diagnostics.schedulerSteps?.length, scenario.id).toBeGreaterThan(0);
		}
	});

	it('records exact simultaneous contacts and a retained dormant interval', () => {
		const simultaneous = run('simultaneous-independent-events');
		const contacts = simultaneous.events.filter(({ type }) => type === 'contact');
		expect(contacts).toHaveLength(2);
		expect(new Set(contacts.map(({ time }) => time)).size).toBe(1);

		const continuation = run('resting-while-another-continues');
		const earlyRest = continuation.trajectories.find(({ bodyId }) => bodyId === 'early-rest')!;
		expect(earlyRest.segments.filter(({ type }) => type === 'stationary')).toHaveLength(1);
		expect(
			continuation.events.filter(
				(event) => event.type === 'contact' && event.bodyId === 'multi-event-body'
			).length
		).toBeGreaterThanOrEqual(3);
	});
});

function run(id: (typeof independentBodySchedulerScenarios)[number]['id']) {
	const scenario = independentBodySchedulerScenarios.find((candidate) => candidate.id === id)!;
	return constructSimulationRun(scenario.input);
}
