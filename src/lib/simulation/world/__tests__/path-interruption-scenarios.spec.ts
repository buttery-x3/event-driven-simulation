import { describe, expect, it } from 'vitest';
import { constructSimulationRun } from '../../run';
import { validateSimulationRun } from '../../verification';
import { pathInterruptionScenarios } from '../scenarios/path-interruptions';

describe('FLAME-55 sustained-path interruption scenarios', () => {
	it('provides every required named scenario through the production scheduler', () => {
		expect(pathInterruptionScenarios.map(({ id }) => id)).toEqual([
			'free-ball-hits-peg-slider',
			'slider-interrupted-before-detachment',
			'linear-slider-hit-sideways',
			'resting-component-hit-by-slider',
			'two-circular-paths-approach',
			'unsupported-dynamic-support-after-impact'
		]);
		for (const scenario of pathInterruptionScenarios) {
			const run = constructSimulationRun(scenario.input);
			expect(scenario.expectedOutcomes, scenario.id).toContain(run.outcome);
			expect(validateSimulationRun(scenario.input, run).failures, scenario.id).toEqual([]);
		}
	});

	it('commits circular history exactly through the winning free-body impact', () => {
		const run = namedRun('free-ball-hits-peg-slider');
		const impact = bodyContact(run)!;
		const circular = run.trajectories
			.find(({ bodyId }) => bodyId === 'peg-slider')!
			.segments.find(({ type }) => type === 'circular-contact');
		const pair = run.diagnostics.pairPredictions.find(
			({ decision, pathTypes }) =>
				decision === 'selected' && pathTypes?.includes('circular-contact')
		);

		expect(circular?.endTime).toBe(impact.time);
		expect(pair?.validInterval[1]).toBeLessThanOrEqual(
			Math.min(...(pair?.localEventHorizons ?? [Number.POSITIVE_INFINITY]))
		);
		expect(pair?.candidates?.[0]?.geometryResidual).toBeLessThanOrEqual(
			run.input.settings.tolerances.contactDistance
		);
	});

	it('invalidates the predicted circular transition instead of committing it later', () => {
		const run = namedRun('slider-interrupted-before-detachment');
		const impact = bodyContact(run)!;
		const interrupted = run.diagnostics.bodyEventHorizons.find(
			({ bodyId, eventType, decision }) =>
				bodyId === 'detaching-slider' &&
				eventType === 'motion-transition' &&
				decision === 'invalidated'
		)!;

		expect(interrupted.decisionWorldTime).toBe(impact.time);
		expect(interrupted.interval[1]).toBeGreaterThan(impact.time);
		expect(
			run.events.some(
				(event) =>
					event.time === interrupted.interval[1] &&
					event.type === 'contact-mode-transition' &&
					event.reason === 'support-lost'
			)
		).toBe(false);
	});

	it('includes and retains fixed support in a sideways linear-slider impact', () => {
		const run = namedRun('linear-slider-hit-sideways');
		const impact = bodyContact(run)!;
		const support = run.dynamicContacts.find(
			(contact) =>
				contact.time === impact.time &&
				contact.participants.some(
					(participant) =>
						participant.type === 'fixed-collider' && participant.colliderId === 'floor'
				)
		);

		expect(support?.state).toBe('retained');
		expect(run.trajectories.find(({ bodyId }) => bodyId === 'line-slider')?.segments).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'linear-contact' })])
		);
	});

	it('reactivates an anchored component when struck by a supported slider', () => {
		const run = namedRun('resting-component-hit-by-slider');
		const impact = bodyContact(run)!;
		const lifecycle = run.componentEvents.find(
			({ time, reactivatedBodyIds }) =>
				time === impact.time && reactivatedBodyIds?.includes('anchored-body')
		);
		const stationary = run.trajectories
			.find(({ bodyId }) => bodyId === 'anchored-body')!
			.segments.find(({ type }) => type === 'stationary');

		expect(lifecycle).toBeDefined();
		expect(stationary?.endTime).toBe(impact.time);
	});

	it('uses a bounded circular/circular pair query before either local transition', () => {
		const run = namedRun('two-circular-paths-approach');
		const firstImpact = bodyContact(run)!;
		const selected = run.diagnostics.pairPredictions.find(
			({ decision, pathTypes, predictedTime }) =>
				decision === 'selected' &&
				predictedTime === firstImpact.time &&
				pathTypes?.every((type) => type === 'circular-contact')
		);

		expect(selected).toBeDefined();
		expect(selected?.validInterval[1]).toBeLessThanOrEqual(
			Math.min(...(selected?.localEventHorizons ?? [Number.POSITIVE_INFINITY]))
		);
	});

	it('releases capture-ineligible contacts instead of inventing persistent dynamic support', () => {
		const run = namedRun('unsupported-dynamic-support-after-impact');
		const falsePositiveTime = 0.38237867892976357;
		const impactContacts = run.dynamicContacts.filter(
			({ time }) => Math.abs(time - falsePositiveTime) < 1e-9
		);
		const capture = run.diagnostics.impactSolves?.find(
			({ contactCapture, bodyIds }) =>
				contactCapture &&
				bodyIds.includes('captured-striker') &&
				bodyIds.includes('supported-slider')
		)?.contactCapture;

		expect(run.terminalReason.type).not.toBe('unsupported-body-body-response');
		expect(run.terminalReason.time).not.toBe(falsePositiveTime);
		expect(impactContacts.length).toBeGreaterThan(0);
		expect(impactContacts.every(({ state }) => state === 'released')).toBe(true);
		expect(capture?.retainedContactIds).toEqual([]);
		expect(capture?.releasedContactIds.length).toBeGreaterThan(0);
		expect(run.outcome).toBe('time-limit');
		for (const trajectory of run.trajectories) {
			expect(Math.max(...trajectory.segments.map(({ endTime }) => endTime))).toBeGreaterThan(
				falsePositiveTime
			);
		}
	});
});

function namedRun(id: (typeof pathInterruptionScenarios)[number]['id']) {
	const scenario = pathInterruptionScenarios.find((candidate) => candidate.id === id)!;
	return constructSimulationRun(scenario.input);
}

function bodyContact(run: ReturnType<typeof constructSimulationRun>) {
	return run.dynamicContacts.find(({ participants }) =>
		participants.every((participant) => participant.type === 'body')
	);
}
