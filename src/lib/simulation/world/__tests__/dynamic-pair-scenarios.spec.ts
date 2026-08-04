import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../contracts';
import { constructSimulationRun } from '../../run';
import { validateSimulationRun } from '../../verification';
import { dynamicPairScenarios } from '../scenarios';

describe('production dynamic-pair scenarios', () => {
	it('provides and independently validates every FLAME-52 workbench scenario', () => {
		expect(dynamicPairScenarios.map(({ id }) => id)).toEqual([
			'equal-mass-head-on',
			'unequal-mass-head-on',
			'glancing-impulse-transfer',
			'peg-event-interrupted-by-ball',
			'unrelated-prediction-survives',
			'repeated-isolated-collisions'
		]);
		for (const scenario of dynamicPairScenarios) {
			const result = constructSimulationRun(scenario.input);
			expect(scenario.expectedOutcomes, scenario.id).toContain(result.outcome);
			expect(validateSimulationRun(scenario.input, result).failures, scenario.id).toEqual([]);
		}
	});

	it('matches equal- and unequal-mass closed-form head-on outcomes', () => {
		const equal = run('equal-mass-head-on').dynamicContacts[0]!;
		const unequal = run('unequal-mass-head-on').dynamicContacts[0]!;
		expect(equal.postImpactVelocities).toEqual([
			[-1, 0],
			[1, 0]
		]);
		expect(unequal.postImpactVelocities).toEqual([
			[1, 0],
			[-1, 0]
		]);
		expect(unequal.impulse).toBe(3);
	});

	it('preserves tangential motion through the glancing impulse', () => {
		const contact = run('glancing-impulse-transfer').dynamicContacts[0]!;
		const tangent: Vec2 = [-contact.normalFromFirstToSecond[1], contact.normalFromFirstToSecond[0]];
		for (const index of [0, 1] as const) {
			expect(dot(contact.postImpactVelocities![index], tangent)).toBeCloseTo(
				dot(contact.preImpactVelocities![index], tangent),
				12
			);
		}
	});

	it('invalidates an interrupted peg future and commits only its rebuilt replacement', () => {
		const result = run('peg-event-interrupted-by-ball');
		const pairTime = result.dynamicContacts[0]!.time;
		const interrupted = result.diagnostics.bodyEventHorizons.find(
			({ bodyId, revision, decision, eventType }) =>
				bodyId === 'peg-runner' &&
				revision.revision === 0 &&
				decision === 'invalidated' &&
				eventType === 'fixed-contact'
		)!;
		const rebuiltPeg = result.events.find(
			(event) => event.type === 'contact' && event.colliderId === 'target-peg'
		)!;
		expect(interrupted.interval[1]).toBeGreaterThan(pairTime);
		expect(rebuiltPeg.time).toBeLessThan(interrupted.interval[1]);
		expect(
			result.trajectories
				.find(({ bodyId }) => bodyId === 'peg-runner')!
				.segments.some((segment) => segment.startTime < pairTime && segment.endTime > pairTime)
		).toBe(false);
	});

	it('retains an unrelated pair prediction through an A/B impact', () => {
		const result = run('unrelated-prediction-survives');
		const firstImpactTime = result.dynamicContacts[0]!.time;
		const unrelated = result.diagnostics.pairPredictions.find(
			({ bodyIds }) => bodyIds[0] === 'c' && bodyIds[1] === 'd'
		)!;
		expect(unrelated.retainedThroughWorldTimes).toContain(firstImpactTime);
		expect(unrelated.revisions.map(({ revision }) => revision)).toEqual([0, 0]);
	});

	it('continues through repeated isolated contacts separated by positive intervals', () => {
		const contacts = run('repeated-isolated-collisions').dynamicContacts;
		expect(contacts.length).toBeGreaterThanOrEqual(3);
		for (let index = 1; index < contacts.length; index += 1)
			expect(contacts[index]!.time).toBeGreaterThan(contacts[index - 1]!.time);
		expect(contacts.every(({ state }) => state === 'released')).toBe(true);
	});

	it('preserves the physical result under participant order and ID renaming', () => {
		const scenario = dynamicPairScenarios.find(({ id }) => id === 'equal-mass-head-on')!;
		const baseline = constructSimulationRun(scenario.input);
		const transformedInput = {
			...scenario.input,
			initialDynamicBodies: [...scenario.input.initialDynamicBodies]
				.reverse()
				.map((body, index) => ({ ...body, id: index === 0 ? 'renamed-z' : 'renamed-a' }))
		};
		const transformed = constructSimulationRun(transformedInput);
		expect(physicalContactSummary(transformed)).toEqual(physicalContactSummary(baseline));
	});

	it('independently rejects corrupted response and stale-authority evidence', () => {
		const result = run('equal-mass-head-on');
		const corruptedResponse = {
			...result,
			dynamicContacts: [
				{ ...result.dynamicContacts[0]!, postImpactNormalVelocity: -1 },
				...result.dynamicContacts.slice(1)
			]
		};
		expect(
			validateSimulationRun(result.input, corruptedResponse).failures.map(({ code }) => code)
		).toContain('IMPACT_EVIDENCE_MISMATCH');

		const staleIndex = result.diagnostics.pairPredictions.findIndex(
			({ decision }) => decision === 'invalidated'
		);
		const stale = result.diagnostics.pairPredictions[staleIndex]!;
		const corruptedAuthority = {
			...result,
			diagnostics: {
				...result.diagnostics,
				pairPredictions: result.diagnostics.pairPredictions.map((prediction, index) =>
					index === staleIndex
						? {
								...stale,
								decision: 'selected' as const,
								decisionWorldTime: result.diagnostics.simulatedUntilTime
							}
						: prediction
				)
			}
		};
		expect(
			validateSimulationRun(result.input, corruptedAuthority).failures.map(({ code }) => code)
		).toContain('INVALID_INTERVAL');
	});
});

function run(id: (typeof dynamicPairScenarios)[number]['id']) {
	const scenario = dynamicPairScenarios.find((candidate) => candidate.id === id)!;
	return constructSimulationRun(scenario.input);
}

function dot(left: Vec2, right: Vec2): number {
	return left[0] * right[0] + left[1] * right[1];
}

function physicalContactSummary(runResult: ReturnType<typeof constructSimulationRun>) {
	const contact = runResult.dynamicContacts[0]!;
	return {
		time: contact.time,
		position: contact.contactPoint,
		pre: [...contact.preImpactVelocities!].sort(vectorOrder),
		post: [...contact.postImpactVelocities!].sort(vectorOrder),
		impulse: contact.impulse
	};
}

function vectorOrder(left: Vec2, right: Vec2): number {
	return left[0] - right[0] || left[1] - right[1];
}
