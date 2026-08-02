import { describe, expect, it } from 'vitest';
import type { RendererPlaybackInput, RunTerminalReason, SimulationRunRecord } from '..';
import { prototypeSimulationInput } from '../../world';

const diagnostics = {
	iterations: 0,
	simulatedUntilTime: 0.5,
	eventCount: 0,
	candidateCount: 0,
	segmentCount: 1,
	simulationWallTimeMilliseconds: 1,
	contactSearches: [],
	entries: [
		{
			severity: 'info',
			code: 'COMPLETION_REGION',
			message: 'Run reached prototype-exit.',
			time: 0.5,
			bodyId: 'ball'
		}
	]
} as const;

const trajectories = [
	{
		bodyId: 'ball',
		segments: [
			{
				bodyId: 'ball',
				startTime: 0,
				endTime: 0.5,
				startPosition: prototypeSimulationInput.initialDynamicBodies[0].position,
				startVelocity: prototypeSimulationInput.initialDynamicBodies[0].velocity,
				acceleration: prototypeSimulationInput.settings.gravity
			}
		]
	}
] as const;

describe('simulation and replay contracts', () => {
	it('round-trips a representative run record as plain JSON data', () => {
		const run = {
			contractVersion: 5,
			input: prototypeSimulationInput,
			validity: 'valid',
			outcome: 'exited',
			terminalReason: { type: 'completion-region', regionId: 'prototype-exit', time: 0.5 },
			trajectories,
			events: [],
			diagnostics
		} as const satisfies SimulationRunRecord;

		const restored = JSON.parse(JSON.stringify(run)) as SimulationRunRecord;

		expect(restored).toEqual(run);
		expect(restored.validity).toBe('valid');
		expect(restored.outcome).toBe('exited');
		expect(restored.terminalReason.type).toBe('completion-region');
	});

	it('preserves distinct terminal reasons independently of prefix validity', () => {
		const reasons = [
			{ type: 'completion-region', regionId: 'exit', time: 1 },
			{ type: 'escape-region', regionId: 'escape', time: 1 },
			{ type: 'bounds-escape', boundary: 'right', time: 1 },
			{
				type: 'settled-supporting-surface',
				time: 1,
				colliderId: 'floor',
				position: [0, 0.1],
				normalSeparationSpeed: 0,
				tangentialSpeed: 0
			},
			{ type: 'event-limit', time: 1, limit: 10 },
			{ type: 'time-limit', time: 1, limit: 1 },
			{ type: 'unresolved-collision-search', time: 1, detail: 'uncertain root' },
			{ type: 'invalid-state', time: null, detail: 'invalid body' },
			{ type: 'numerical-failure', time: 1, detail: 'overflow' }
		] as const satisfies readonly RunTerminalReason[];

		expect(JSON.parse(JSON.stringify(reasons))).toEqual(reasons);
	});

	it('keeps renderer playback input serialisable and explicit about incomplete runs', () => {
		const playback = {
			contractVersion: 5,
			scene: prototypeSimulationInput.scene,
			initialDynamicBodies: prototypeSimulationInput.initialDynamicBodies,
			validity: 'valid',
			outcome: 'unresolved',
			terminalReason: {
				type: 'unresolved-collision-search',
				time: 0.5,
				detail: 'Playback contains only the validated trajectory prefix.'
			},
			playableUntilTime: diagnostics.simulatedUntilTime,
			trajectories,
			events: [],
			diagnostics
		} as const satisfies RendererPlaybackInput;

		expect(JSON.parse(JSON.stringify(playback))).toEqual(playback);
	});
});
