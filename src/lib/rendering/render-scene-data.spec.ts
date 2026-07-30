import { describe, expect, it } from 'vitest';
import type { RendererPlaybackInput, SimulationInput } from '$lib/simulation/contracts';
import { prototypeSimulationInput } from '$lib/simulation/prototype-input';
import { getRenderableCircles } from './render-scene-data';

function withBodyRadius(radius: number): SimulationInput {
	return {
		...prototypeSimulationInput,
		initialBodies: prototypeSimulationInput.initialBodies.map((body) => ({ ...body, radius }))
	};
}

describe('render scene data', () => {
	it.each([0.18, 0.62])(
		'uses a configured body radius of %s through the same rendering path',
		(radius) => {
			const input = withBodyRadius(radius);

			const renderedBody = getRenderableCircles(input).find(({ id }) => id === 'ball');

			expect(renderedBody).toEqual({
				id: 'ball',
				role: 'dynamic-body',
				centre: input.initialBodies[0]?.position,
				radius
			});
		}
	);

	it('keeps playback dimensions consistent with the simulation input', () => {
		const input = withBodyRadius(0.47);
		const playback = {
			contractVersion: 1,
			scene: input.scene,
			initialBodies: input.initialBodies,
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

		const renderedBody = getRenderableCircles(playback).find(({ id }) => id === 'ball');

		expect(renderedBody?.radius).toBe(input.initialBodies[0]?.radius);
	});
});
