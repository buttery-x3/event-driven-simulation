import { describe, expect, it } from 'vitest';
import { constructSimulationRun } from '../../run';
import { validateSimulationRun } from '../../verification';
import { dormantComponentScenarios } from '../scenarios/dormant-components';

describe('FLAME-54 dormant contact component scenarios', () => {
	it('provides every named scenario through the production scheduler', () => {
		expect(dormantComponentScenarios.map(({ id }) => id)).toEqual([
			'wedged-ball-remains-anchored',
			'wedged-ball-dislodged',
			'resting-stack-reactivated',
			'component-splits-after-impact',
			'resting-body-while-world-continues',
			'unsupported-floating-cluster'
		]);
		for (const scenario of dormantComponentScenarios) {
			const run = constructSimulationRun(scenario.input);
			expect(scenario.expectedOutcomes, scenario.id).toContain(run.outcome);
			expect(validateSimulationRun(scenario.input, run).failures, scenario.id).toEqual([]);
		}
	});

	it('keeps the wedged member stationary when its supports carry the incoming load', () => {
		const run = namedRun('wedged-ball-remains-anchored');
		const dormant = run.contactComponents.find(
			(component) =>
				component.type === 'resting-anchored' &&
				component.dissolvedAtTime === null &&
				component.bodyIds.includes('wedged')
		);
		expect(run.outcome).toBe('settled');
		expect(run.componentEvents.some(({ change }) => change === 'merged')).toBe(true);
		expect(
			dormant?.retainedSupportReactions.every(({ impulsePerTime }) => impulsePerTime >= 0)
		).toBe(true);
		expect(
			run.trajectories
				.find(({ bodyId }) => bodyId === 'wedged')
				?.segments.every((segment) =>
					segment.type === 'stationary' ? segment.startPosition[0] === 0 : true
				)
		).toBe(true);
	});

	it('reactivates and splits dormant membership at the exact impact time', () => {
		for (const id of ['resting-stack-reactivated', 'component-splits-after-impact'] as const) {
			const run = namedRun(id);
			const split = run.componentEvents.find(({ change }) => change === 'split');
			expect(split, id).toBeDefined();
			expect(
				run.contactComponents.some(
					(component) => component.type === 'resting-anchored' && component.dissolvedAtTime !== null
				)
			).toBe(true);
			expect(split?.reactivatedBodyIds?.length).toBeGreaterThan(0);
		}
	});

	it('does not classify an unsupported touching cluster as resting', () => {
		const run = namedRun('unsupported-floating-cluster');
		expect(run.contactComponents.filter(({ type }) => type === 'resting-anchored')).toEqual([]);
		expect(run.bodyStates.every(({ lifecycle }) => lifecycle !== 'resting')).toBe(true);
	});

	it('is independent of body and fixed-support declaration order', () => {
		const scenario = dormantComponentScenarios.find(
			({ id }) => id === 'wedged-ball-remains-anchored'
		)!;
		const baseline = constructSimulationRun(scenario.input);
		const reversed = constructSimulationRun({
			...scenario.input,
			initialDynamicBodies: [...scenario.input.initialDynamicBodies].reverse(),
			scene: {
				...scenario.input.scene,
				staticColliders: [...scenario.input.scene.staticColliders].reverse()
			}
		});
		expect(componentSummary(reversed)).toEqual(componentSummary(baseline));
	});
});

function namedRun(id: (typeof dormantComponentScenarios)[number]['id']) {
	const scenario = dormantComponentScenarios.find((candidate) => candidate.id === id)!;
	return constructSimulationRun(scenario.input);
}

function componentSummary(run: ReturnType<typeof constructSimulationRun>) {
	return run.contactComponents.map((component) => ({
		type: component.type,
		createdAtTime: component.createdAtTime,
		dissolvedAtTime: component.dissolvedAtTime,
		bodyIds: component.bodyIds,
		fixedColliderIds: component.fixedColliderIds,
		reactions: component.retainedSupportReactions
			.map(({ contactId, impulsePerTime }) => ({ contactId, impulsePerTime }))
			.sort((left, right) => left.contactId.localeCompare(right.contactId))
	}));
}
