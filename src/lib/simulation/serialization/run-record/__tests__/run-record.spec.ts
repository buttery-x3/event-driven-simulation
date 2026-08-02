import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../../../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
import {
	assertPlaybackEligible,
	getPlaybackFrame,
	toRendererPlaybackInput
} from '$lib/rendering/playback';
import { toRenderSceneViewModel } from '$lib/rendering/render-scene-data';
import { canonicalPlinkoBoard } from '../../../world';
import type { SimulationRunRecord } from '../../../contracts';
import { loadSimulationRunFixture, parseSimulationRunFixture } from '..';
import { canonicalPlinkoScenarios } from '../../../world';

describe('saved run fixtures', () => {
	it('loads and replays the canonical fixture headlessly through the public contract', () => {
		const run = parseSimulationRunFixture(canonicalFixtureJson);
		const playback = toRendererPlaybackInput(run);

		expect('window' in globalThis).toBe(false);
		expect(run.input.scene.id).toBe('canonical-plinko-board');
		expect(run.input.scene).toEqual(canonicalPlinkoBoard);
		const offsetScenario = canonicalPlinkoScenarios.find(({ id }) => id === 'offset-drop')!;
		expect(run.input.initialDynamicBodies).toEqual(offsetScenario.input.initialDynamicBodies);
		expect(run.input.settings).toEqual(offsetScenario.input.settings);
		expect(run.validity).toBe('valid');
		expect(run.terminalReason.type).toBe('completion-region');
		expect(run.events.length).toBeGreaterThan(1);
		expect(run.diagnostics.entries[0]?.code).toBe('CONTACT_COMMITTED');
		const contact = run.events[0]!;
		const contactTime = contact.time;
		expect(getPlaybackFrame(playback, contactTime)).toMatchObject({
			time: contactTime,
			bodies: [{ bodyId: 'ball-primary', position: contact!.position, segmentIndex: 1 }],
			mostRecentEvent: { type: 'contact', colliderId: contact!.colliderId }
		});
		expect(getPlaybackFrame(playback, run.diagnostics.simulatedUntilTime)).toMatchObject({
			time: run.diagnostics.simulatedUntilTime,
			bodies: [{ segmentIndex: run.trajectories[0]!.segments.length - 1 }]
		});
	});

	it('keeps canonical contact geometry and playback poses in one coordinate system', () => {
		const run = parseSimulationRunFixture(canonicalFixtureJson);
		const playback = toRendererPlaybackInput(run);
		const contact = run.events[0];
		const body = run.input.initialDynamicBodies[0];
		const collider = run.input.scene.staticColliders.find(({ id }) => id === contact!.colliderId);
		const frameBody = getPlaybackFrame(playback, contact!.time).bodies[0];
		const renderedObjects = toRenderSceneViewModel(playback).objects;
		const renderedBody = renderedObjects.find(({ id }) => id === body!.id);
		const renderedCollider = renderedObjects.find(({ id }) => id === collider!.id);
		expect(collider?.physicalShape.type).toBe('circle');
		if (!collider || collider.physicalShape.type !== 'circle' || !('centre' in collider)) return;
		const contactSeparation = Math.hypot(
			contact!.position[0] - collider.centre[0],
			contact!.position[1] - collider.centre[1]
		);

		expect(frameBody?.position).toEqual(contact!.position);
		expect(renderedBody).toMatchObject({
			representation: 'sphere',
			centre: body!.position,
			radius: body!.physicalShape.radius
		});
		expect(renderedCollider).toMatchObject({
			representation: 'cylinder',
			centre: collider.centre,
			radius: collider.physicalShape.radius
		});
		expect(contactSeparation).toBeCloseTo(
			body!.physicalShape.radius + collider.physicalShape.radius
		);
	});

	it('retains terminal-reason playback admission after fixture loading', () => {
		const source = JSON.parse(canonicalFixtureJson) as SimulationRunRecord;
		const terminalTime = source.diagnostics.simulatedUntilTime;
		const incomplete = {
			...source,
			outcome: 'unresolved',
			terminalReason: {
				type: 'unresolved-collision-search',
				time: terminalTime,
				detail: 'The saved fixture contains only a validated trajectory prefix.'
			},
			diagnostics: {
				...source.diagnostics,
				entries: [
					...source.diagnostics.entries.slice(0, -1),
					{
						severity: 'error',
						code: 'RUN_UNRESOLVED',
						message: 'The saved fixture contains only a validated trajectory prefix.',
						time: terminalTime,
						bodyId: 'ball-primary'
					}
				]
			}
		};
		const playback = toRendererPlaybackInput(loadSimulationRunFixture(incomplete));

		expect(() => assertPlaybackEligible(playback)).toThrow(
			'Ordinary playback requires a valid exited or settled run; received valid unresolved.'
		);
	});
});
