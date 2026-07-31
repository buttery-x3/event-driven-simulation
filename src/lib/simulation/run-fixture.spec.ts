import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-synthetic-contact.json?raw';
import {
	assertPlaybackEligible,
	getPlaybackFrame,
	toRendererPlaybackInput
} from '$lib/rendering/playback';
import { toRenderSceneViewModel } from '$lib/rendering/render-scene-data';
import type { SimulationRunRecord } from './contracts';
import { loadSimulationRunFixture, parseSimulationRunFixture } from './run-fixture';

describe('saved run fixtures', () => {
	it('loads and replays the canonical fixture headlessly through the public contract', () => {
		const run = parseSimulationRunFixture(canonicalFixtureJson);
		const playback = toRendererPlaybackInput(run);

		expect('window' in globalThis).toBe(false);
		expect(run.input.scene.id).toBe('canonical-synthetic-scene');
		expect(run.status).toEqual({ type: 'complete' });
		expect(run.events).toHaveLength(1);
		expect(run.diagnostics.entries[0]?.code).toBe('SYNTHETIC_CONTACT_GENERATED');
		expect(getPlaybackFrame(playback, 1)).toMatchObject({
			time: 1,
			bodies: [{ bodyId: 'canonical-ball', position: [1, 1], segmentIndex: 1 }],
			mostRecentEvent: { type: 'contact', colliderId: 'canonical-peg' }
		});
		expect(getPlaybackFrame(playback, 2)).toMatchObject({
			time: 2,
			bodies: [{ position: [2, 1], segmentIndex: 1 }]
		});
	});

	it('keeps canonical contact geometry and playback poses in one coordinate system', () => {
		const run = parseSimulationRunFixture(canonicalFixtureJson);
		const playback = toRendererPlaybackInput(run);
		const contact = run.events[0];
		const body = run.input.initialDynamicBodies[0];
		const collider = run.input.scene.staticColliders[0];
		const frameBody = getPlaybackFrame(playback, contact!.time).bodies[0];
		const renderedObjects = toRenderSceneViewModel(playback).objects;
		const renderedBody = renderedObjects.find(({ id }) => id === body!.id);
		const renderedCollider = renderedObjects.find(({ id }) => id === collider!.id);
		const contactSeparation = Math.hypot(
			contact!.position[0] - collider!.centre[0],
			contact!.position[1] - collider!.centre[1]
		);

		expect(frameBody?.position).toEqual(contact!.position);
		expect(renderedBody).toMatchObject({
			representation: 'sphere',
			centre: body!.position,
			radius: body!.physicalShape.radius
		});
		expect(renderedCollider).toMatchObject({
			representation: 'cylinder',
			centre: collider!.centre,
			radius: collider!.physicalShape.radius
		});
		expect(contactSeparation).toBeCloseTo(
			body!.physicalShape.radius + collider!.physicalShape.radius
		);
	});

	it('retains normal run-status validation after fixture loading', () => {
		const incomplete = {
			...(JSON.parse(canonicalFixtureJson) as SimulationRunRecord),
			status: {
				type: 'unresolved',
				reason: 'The saved fixture contains only a validated trajectory prefix.'
			}
		};
		const playback = toRendererPlaybackInput(loadSimulationRunFixture(incomplete));

		expect(() => assertPlaybackEligible(playback)).toThrow(
			'Ordinary playback requires a complete run; received unresolved: The saved fixture contains only a validated trajectory prefix.'
		);
	});
});
