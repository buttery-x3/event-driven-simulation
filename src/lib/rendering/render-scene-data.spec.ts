import { describe, expect, it } from 'vitest';
import type { RendererPlaybackInput, SimulationInput } from '$lib/simulation/contracts';
import { canonicalPlinkoBoard } from '$lib/simulation/world';
import { prototypeSimulationInput } from '$lib/simulation/world';
import { defaultCanonicalPlinkoScenario } from '$lib/simulation/world';
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
			z: 0,
			orientation: [0, 0, 0],
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
			z: 0,
			radius: collider.physicalShape.radius,
			depth: 0.32,
			orientation: [Math.PI / 2, 0, 0]
		});
		expect(JSON.stringify(collider)).toBe(before);
		expect('depth' in collider).toBe(false);
		expect('orientation' in collider).toBe(false);
	});

	it('derives the board, boundaries and completion region from physical coordinates', () => {
		const viewModel = toRenderSceneViewModel(defaultCanonicalPlinkoScenario.input);
		const leftWall = viewModel.objects.find(({ id }) => id === 'boundary-left-wall');
		const exit = viewModel.objects.find(({ id }) => id === 'termination-centre-exit');

		expect(viewModel.board).toEqual({
			centre: [0, canonicalPlinkoBoard.bounds.height / 2],
			size: [canonicalPlinkoBoard.bounds.width, canonicalPlinkoBoard.bounds.height, 0.3]
		});
		expect(leftWall).toEqual({
			id: 'boundary-left-wall',
			motionAuthority: 'static',
			representation: 'box',
			material: 'fixed-boundary',
			centre: [-2.55, 3.35],
			z: 0,
			size: [5.8, 0.08, 0.24],
			orientation: [0, 0, Math.PI / 2]
		});
		expect(exit).toEqual({
			id: 'termination-centre-exit',
			motionAuthority: 'static',
			representation: 'plane',
			material: 'termination-region',
			centre: [0, -0.09],
			z: -0.08,
			size: [1, 0.42],
			orientation: [0, 0, 0]
		});
	});

	it('keeps playback dimensions consistent with the simulation input', () => {
		const input = withBodyRadius(0.47);
		const playback = {
			contractVersion: 7,
			scene: input.scene,
			initialDynamicBodies: input.initialDynamicBodies,
			validity: 'valid',
			outcome: 'exited',
			terminalReason: {
				type: 'completion-region',
				regionId: 'termination-centre-exit',
				time: input.settings.maximumSimulationTime
			},
			playableUntilTime: input.settings.maximumSimulationTime,
			bodyStates: [],
			trajectories: [],
			events: [],
			releases: [],
			dynamicContacts: [],
			contactComponents: [],
			componentEvents: [],
			diagnostics: {
				iterations: 0,
				simulatedUntilTime: 0,
				eventCount: 0,
				candidateCount: 0,
				segmentCount: 0,
				simulationWallTimeMilliseconds: 0,
				contactSearches: [],
				bodyEventHorizons: [],
				pairPredictions: [],
				entries: []
			}
		} as const satisfies RendererPlaybackInput;

		const renderedBody = toRenderSceneViewModel(playback).objects.find(({ id }) => id === 'ball');

		expect(renderedBody?.representation).toBe('sphere');
		if (renderedBody?.representation !== 'sphere') return;
		expect(renderedBody.radius).toBe(input.initialDynamicBodies[0]?.physicalShape.radius);
	});
});
