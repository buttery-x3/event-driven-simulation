import { describe, expect, it } from 'vitest';
import type { RendererPlaybackInput, SimulationInput } from '$lib/simulation/contracts';
import { prototypeSimulationInput } from '$lib/simulation/prototype-input';
import { toRenderSceneViewModel } from './render-scene-data';

function withBodyRadius(radius: number): SimulationInput {
	return {
		...prototypeSimulationInput,
		initialDynamicBodies: prototypeSimulationInput.initialDynamicBodies.map((body) => ({
			...body,
			physicalShape: { ...body.physicalShape, radius }
		}))
	};
}

describe('render scene view-model adaptation', () => {
	it.each([0.18, 0.62])('renders a dynamic physical circle of radius %s as a sphere', (radius) => {
		const input = withBodyRadius(radius);

		const renderedBody = toRenderSceneViewModel(input).objects.find(({ id }) => id === 'ball');

		expect(renderedBody).toEqual({
			id: 'ball',
			motionAuthority: 'dynamic',
			representation: 'sphere',
			material: 'dynamic-body',
			centre: input.initialDynamicBodies[0]?.position,
			radius
		});
	});

	it('renders a static physical circle as a presentation-only cylinder', () => {
		const collider = prototypeSimulationInput.scene.staticColliders[0]!;
		const before = JSON.stringify(collider);

		const renderedCollider = toRenderSceneViewModel(prototypeSimulationInput).objects.find(
			({ id }) => id === collider.id
		);

		expect(renderedCollider).toEqual({
			id: collider.id,
			motionAuthority: 'static',
			representation: 'cylinder',
			material: 'fixed-peg',
			centre: collider.centre,
			radius: collider.physicalShape.radius,
			depth: 0.32,
			orientation: [Math.PI / 2, 0, 0]
		});
		expect(JSON.stringify(collider)).toBe(before);
		expect('depth' in collider).toBe(false);
		expect('orientation' in collider).toBe(false);
	});

	it('keeps playback dimensions consistent with the simulation input', () => {
		const input = withBodyRadius(0.47);
		const playback = {
			contractVersion: 2,
			scene: input.scene,
			initialDynamicBodies: input.initialDynamicBodies,
			status: { type: 'complete' },
			playableUntilTime: input.settings.maximumSimulationTime,
			trajectories: [],
			events: [],
			diagnostics: {
				iterations: 0,
				simulatedUntilTime: 0,
				entries: []
			}
		} as const satisfies RendererPlaybackInput;

		const renderedBody = toRenderSceneViewModel(playback).objects.find(({ id }) => id === 'ball');

		expect(renderedBody?.radius).toBe(input.initialDynamicBodies[0]?.physicalShape.radius);
	});
});
