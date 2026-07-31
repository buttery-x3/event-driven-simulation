import { describe, expect, it } from 'vitest';
import type { RendererPlaybackInput, SimulationInput } from '$lib/simulation/contracts';
import { generateSyntheticRun } from '$lib/simulation/synthetic-run';
import {
	assertPlaybackEligible,
	assertRecordedInspectionEligible,
	toRendererPlaybackInput
} from './playback-admission';
import { PlaybackClock } from './playback-clock';
import { getPlaybackFrame } from './recorded-frame';

const input = {
	scene: {
		id: 'playback-test-scene',
		coordinateSystem: {
			origin: 'centre-bottom',
			horizontalAxis: 'right',
			verticalAxis: 'up',
			lengthUnit: 'metre'
		},
		bounds: { width: 3, height: 3 },
		staticColliders: [
			{
				id: 'test-peg',
				motionAuthority: 'static',
				physicalShape: { type: 'circle', radius: 0.25 },
				centre: [1, 0.55]
			}
		],
		terminationRegions: [
			{
				id: 'test-exit',
				type: 'axis-aligned-box',
				purpose: 'complete',
				minimum: [1.9, 0.9],
				maximum: [2.1, 1.2]
			}
		]
	},
	initialDynamicBodies: [
		{
			id: 'test-ball',
			motionAuthority: 'dynamic',
			physicalShape: { type: 'circle', radius: 0.2 },
			position: [0, 2],
			velocity: [1, 0]
		}
	],
	settings: {
		gravity: [0, -2],
		restitution: 0.5,
		maximumEvents: 10,
		maximumSimulationTime: 2,
		tolerances: {
			contactDistance: 1e-9,
			eventTime: 1e-9
		}
	}
} as const satisfies SimulationInput;

describe('recorded playback frame evaluation', () => {
	it('clamps requested time and selects recorded segments at their boundaries', () => {
		const playback = completedPlayback();

		expect(getPlaybackFrame(playback, -10)).toMatchObject({
			time: 0,
			bodies: [{ position: [0, 2], segmentIndex: 0 }],
			mostRecentEvent: null
		});
		expect(getPlaybackFrame(playback, 1)).toMatchObject({
			time: 1,
			bodies: [{ position: [1, 1], segmentIndex: 1 }],
			mostRecentEvent: { type: 'contact', time: 1 }
		});
		expect(getPlaybackFrame(playback, 10)).toMatchObject({
			time: 1.9,
			bodies: [{ position: [1.9, 1.09], segmentIndex: 1 }]
		});
	});

	it('does not mutate the supplied completed run while evaluating it', () => {
		const run = generateSyntheticRun(input);
		const before = JSON.stringify(run);
		const playback = toRendererPlaybackInput(run);

		getPlaybackFrame(playback, 0.75);
		getPlaybackFrame(playback, 1.5);

		expect(JSON.stringify(run)).toBe(before);
	});
});

describe('playback admission and adaptation', () => {
	it.each([
		{ type: 'event-limit', time: 1, limit: 1 },
		{ type: 'escape-region', regionId: 'escape', time: 1 },
		{ type: 'numerical-failure', time: 1, detail: 'test failure detail' }
	] as const)('rejects a $type run from ordinary playback', (terminalReason) => {
		const playback = {
			...completedPlayback(),
			terminalReason
		} satisfies RendererPlaybackInput;

		expect(() => assertPlaybackEligible(playback)).toThrow(
			`Ordinary playback requires a valid completion-region run; received valid ${terminalReason.type}.`
		);
	});

	it.each([
		{ type: 'unresolved-collision-search', time: 1, detail: 'test retained prefix' },
		{ type: 'event-limit', time: 1, limit: 1 }
	] as const)(
		'allows explicit recorded-prefix inspection for a $type run without admitting ordinary playback',
		(terminalReason) => {
			const playback = {
				...completedPlayback(),
				terminalReason
			} satisfies RendererPlaybackInput;

			expect(() => assertRecordedInspectionEligible(playback)).not.toThrow();
			expect(getPlaybackFrame(playback, 1)).toMatchObject({
				time: 1,
				bodies: [{ position: [1, 1] }]
			});
			expect(() => assertPlaybackEligible(playback)).toThrow();
		}
	);

	it('rejects an invalid run from both playback and recorded inspection', () => {
		const playback = {
			...completedPlayback(),
			validity: 'invalid',
			terminalReason: {
				type: 'invalid-state',
				time: null,
				detail: 'test invalid record'
			}
		} satisfies RendererPlaybackInput;

		expect(() => assertRecordedInspectionEligible(playback)).toThrow(
			'Recorded inspection is unavailable for an invalid run: invalid-state.'
		);
	});
});

describe('playback clock', () => {
	it('supports play, pause, restart, seek, clamping and stopping at the end', () => {
		const clock = new PlaybackClock(2);

		clock.play();
		clock.advance(0.75);
		expect({ time: clock.time, playing: clock.playing }).toEqual({ time: 0.75, playing: true });

		clock.pause();
		clock.advance(0.5);
		expect(clock.time).toBe(0.75);

		clock.seek(-1);
		expect(clock.time).toBe(0);
		clock.seek(1.25);
		expect(clock.time).toBe(1.25);

		clock.play();
		clock.advance(10);
		expect({ time: clock.time, playing: clock.playing }).toEqual({ time: 2, playing: false });

		clock.restart();
		expect({ time: clock.time, playing: clock.playing }).toEqual({ time: 0, playing: true });
	});
});

function completedPlayback(): RendererPlaybackInput {
	return toRendererPlaybackInput(generateSyntheticRun(input));
}
