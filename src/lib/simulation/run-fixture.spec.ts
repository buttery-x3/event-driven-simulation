import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-synthetic-contact.json?raw';
import {
	assertPlaybackEligible,
	getPlaybackFrame,
	toRendererPlaybackInput
} from '$lib/rendering/playback';
import { toRenderSceneViewModel } from '$lib/rendering/render-scene-data';
import { canonicalPlinkoBoard } from './canonical-board';
import type { SimulationRunRecord } from './contracts';
import { loadSimulationRunFixture, parseSimulationRunFixture } from './run-fixture';
import { defaultCanonicalPlinkoScenario } from './scenario-catalogue';

describe('saved run fixtures', () => {
	it('loads and replays the canonical fixture headlessly through the public contract', () => {
		const run = parseSimulationRunFixture(canonicalFixtureJson);
		const playback = toRendererPlaybackInput(run);

		expect('window' in globalThis).toBe(false);
		expect(run.input.scene.id).toBe('canonical-plinko-board');
		expect(run.input.scene).toEqual(canonicalPlinkoBoard);
		expect(run.input.initialDynamicBodies).toEqual(
			defaultCanonicalPlinkoScenario.input.initialDynamicBodies
		);
		expect(run.input.settings).toEqual(defaultCanonicalPlinkoScenario.input.settings);
		expect(run.status).toEqual({ type: 'complete' });
		expect(run.events).toHaveLength(1);
		expect(run.diagnostics.entries[0]?.code).toBe('SYNTHETIC_CONTACT_GENERATED');
		const contactTime = run.events[0]!.time;
		expect(getPlaybackFrame(playback, contactTime)).toMatchObject({
			time: contactTime,
			bodies: [{ bodyId: 'ball-primary', position: [0, 5.97], segmentIndex: 1 }],
			mostRecentEvent: { type: 'contact', colliderId: 'peg-row-01-column-04' }
		});
		expect(getPlaybackFrame(playback, run.diagnostics.simulatedUntilTime)).toMatchObject({
			time: run.diagnostics.simulatedUntilTime,
			bodies: [{ segmentIndex: 1 }]
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
