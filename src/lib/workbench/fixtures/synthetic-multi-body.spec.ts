import { describe, expect, it } from 'vitest';
import { getPlaybackFrame, toRendererPlaybackInput } from '$lib/rendering/playback';
import type { SimulationRunRecord } from '$lib/simulation/contracts';
import { parseSimulationRunFixture } from '$lib/simulation/serialization/run-record';
import { createDiagnosticExport } from '$lib/simulation/serialization/diagnostic-export';
import { validateSimulationRun } from '$lib/simulation/verification';
import { buildWorkbenchHistory, filterHistoryByBody } from '../inspection';
import { syntheticMultiBodyFixtures } from './synthetic-multi-body';

describe('synthetic multi-body workbench fixtures', () => {
	it('provides every required labelled fixture through the public saved-run validator', () => {
		expect(syntheticMultiBodyFixtures.map(({ id }) => id)).toEqual([
			'synthetic-staggered-releases',
			'synthetic-two-body-contact',
			'synthetic-resting-and-active',
			'synthetic-component-split',
			'synthetic-partial-multi-body-run'
		]);

		for (const fixture of syntheticMultiBodyFixtures) {
			const parsed = parseSimulationRunFixture(JSON.stringify(fixture.run));
			expect(parsed).toEqual(fixture.run);
			const validation = validateSimulationRun(parsed.input, parsed);
			expect(validation, `${fixture.id}: ${JSON.stringify(validation.failures)}`).toMatchObject({
				valid: true
			});
		}
	});

	it('keeps all twenty staggered bodies absent until their own exact release times', () => {
		const run = fixture('synthetic-staggered-releases');
		const playback = toRendererPlaybackInput(run);
		const initialFrame = getPlaybackFrame(playback, 0);
		const midFrame = getPlaybackFrame(playback, 1);
		const finalFrame = getPlaybackFrame(playback, playback.playableUntilTime);

		expect(run.input.initialDynamicBodies).toHaveLength(20);
		expect(initialFrame.bodies.filter(({ position }) => position !== null)).toHaveLength(1);
		expect(midFrame.bodies.filter(({ position }) => position !== null)).toHaveLength(6);
		expect(finalFrame.bodies.filter(({ position }) => position !== null)).toHaveLength(20);
		expect(initialFrame.bodies[1]).toMatchObject({ lifecycle: 'scheduled', position: null });
	});

	it('selects the later authoritative segment at an exact body-contact transition', () => {
		const playback = toRendererPlaybackInput(fixture('synthetic-two-body-contact'));
		const frame = getPlaybackFrame(playback, 2.5);

		expect(frame.bodies).toMatchObject([
			{ bodyId: 'contact-a', position: [-0.5, 5], velocity: [-1, 0], segmentIndex: 1 },
			{ bodyId: 'contact-b', position: [0.5, 5], velocity: [1, 0], segmentIndex: 1 }
		]);
		expect(frame.bodies[0]!.contactComponentIds).toContain('impact-a-b');
	});

	it('holds a declared terminal pose while another body continues without extending history', () => {
		const source = fixture('synthetic-two-body-contact');
		const run = JSON.parse(JSON.stringify(source)) as SimulationRunRecord;
		(run.bodyStates as SimulationRunRecord['bodyStates'][number][])[0] = {
			...run.bodyStates[0]!,
			lifecycle: 'completed',
			recordedUntilTime: 2.5,
			terminalOutcome: 'completed'
		};
		(run.trajectories as SimulationRunRecord['trajectories'][number][])[0] = {
			bodyId: 'contact-a',
			segments: [run.trajectories[0]!.segments[0]!]
		};
		const frame = getPlaybackFrame(toRendererPlaybackInput(run), 5);

		expect(frame.bodies[0]).toMatchObject({
			bodyId: 'contact-a',
			position: [-0.5, 5],
			velocity: [0, 0],
			lifecycle: 'completed'
		});
		expect(frame.bodies[1]).toMatchObject({ bodyId: 'contact-b', lifecycle: 'active' });
	});

	it('keeps resting bodies stationary and clamps partial runs to their certified boundary', () => {
		const resting = getPlaybackFrame(
			toRendererPlaybackInput(fixture('synthetic-resting-and-active')),
			5
		);
		expect(resting.bodies[0]).toMatchObject({
			position: [-3, 0.25],
			velocity: [0, 0],
			motionMode: 'stationary',
			lifecycle: 'resting',
			contactComponentIds: ['resting-floor']
		});

		const partial = fixture('synthetic-partial-multi-body-run');
		const boundary = getPlaybackFrame(toRendererPlaybackInput(partial), 100);
		expect(boundary.time).toBe(3.5);
		expect(boundary.bodies.every(({ position }) => position !== null)).toBe(true);
	});

	it('merges same-time releases, contacts, components and predictions into filterable history', () => {
		const contactHistory = buildWorkbenchHistory(fixture('synthetic-two-body-contact'));
		const selected = filterHistoryByBody(contactHistory, 'contact-a');
		expect(selected.map(({ kind }) => kind)).toEqual(
			expect.arrayContaining(['release', 'dynamic-contact', 'component-transition', 'prediction'])
		);
		expect(selected.filter(({ time }) => time === 2.5).length).toBeGreaterThan(1);

		const splitHistory = buildWorkbenchHistory(fixture('synthetic-component-split'));
		expect(splitHistory).toContainEqual(
			expect.objectContaining({ kind: 'component-transition', title: 'Component split' })
		);
	});

	it('preserves the complete multi-body record in diagnostic export evidence', () => {
		const run = fixture('synthetic-two-body-contact');
		const validation = validateSimulationRun(run.input, run);
		const bundle = createDiagnosticExport(
			run,
			{
				exportedAt: '2026-08-03T00:00:00.000Z',
				runId: 'synthetic-two-body-contact',
				descriptiveName: 'synthetic-two-body-contact.json'
			},
			validation
		);

		expect(bundle.submittedInput.initialDynamicBodies).toEqual(run.input.initialDynamicBodies);
		expect(bundle.authoritativeRun).toMatchObject({
			bodyStates: run.bodyStates,
			trajectories: run.trajectories,
			dynamicContacts: run.dynamicContacts,
			contactComponents: run.contactComponents,
			componentEvents: run.componentEvents
		});
		expect(bundle.summary.counts).toMatchObject({
			bodies: 2,
			dynamicContacts: 1,
			contactComponents: 1
		});
	});
});

function fixture(id: (typeof syntheticMultiBodyFixtures)[number]['id']): SimulationRunRecord {
	const match = syntheticMultiBodyFixtures.find((candidate) => candidate.id === id);
	if (!match) throw new Error(`Missing synthetic fixture ${id}.`);
	return match.run;
}
