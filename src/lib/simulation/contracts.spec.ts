import { describe, expect, it } from 'vitest';
import type { RendererPlaybackInput, RunStatus, SimulationRunRecord } from './contracts';
import { prototypeSimulationInput } from './prototype-input';

const diagnostics = {
	iterations: 1,
	simulatedUntilTime: 0.5,
	entries: [
		{
			severity: 'info',
			code: 'CONTACT_COMMITTED',
			message: 'Committed the earliest supported contact.',
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
				startPosition: [0, 2.7],
				startVelocity: [0, 0],
				acceleration: [0, -9.81]
			}
		]
	}
] as const;

const events = [
	{
		type: 'contact',
		time: 0.5,
		bodyId: 'ball',
		colliderId: 'peg-centre',
		position: [0, 1.5],
		normal: [0, 1]
	}
] as const;

describe('simulation and replay contracts', () => {
	it('round-trips a representative run record as plain JSON data', () => {
		const run = {
			contractVersion: 1,
			input: prototypeSimulationInput,
			status: { type: 'complete' },
			trajectories,
			events,
			diagnostics
		} as const satisfies SimulationRunRecord;

		const restored = JSON.parse(JSON.stringify(run)) as SimulationRunRecord;

		expect(restored).toEqual(run);
		expect(restored.status.type).toBe('complete');
		expect(restored.trajectories).toEqual(trajectories);
		expect(restored.events).toEqual(events);
		expect(restored.diagnostics).toEqual(diagnostics);
	});

	it('preserves each terminal run status and its failure context', () => {
		const statuses = [
			{ type: 'complete' },
			{ type: 'unresolved', reason: 'No reliable collision root was found.' },
			{ type: 'iteration-limited', reason: 'The configured event limit was reached.' },
			{ type: 'invalid', reason: 'A body radius was not positive.' }
		] as const satisfies readonly RunStatus[];

		const restored = JSON.parse(JSON.stringify(statuses)) as RunStatus[];

		expect(restored).toEqual(statuses);
	});

	it('keeps renderer playback input serialisable and explicit about incomplete runs', () => {
		const playback = {
			contractVersion: 1,
			scene: prototypeSimulationInput.scene,
			status: {
				type: 'unresolved',
				reason: 'Playback contains only the validated trajectory prefix.'
			},
			playableUntilTime: diagnostics.simulatedUntilTime,
			trajectories,
			events,
			diagnostics
		} as const satisfies RendererPlaybackInput;

		const restored = JSON.parse(JSON.stringify(playback)) as RendererPlaybackInput;

		expect(restored).toEqual(playback);
		expect(restored.status.type).toBe('unresolved');
		expect(restored.playableUntilTime).toBe(0.5);
	});
});
