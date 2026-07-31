import type { RendererPlaybackInput, SimulationRunRecord } from '$lib/simulation/contracts';

export function toRendererPlaybackInput(run: SimulationRunRecord): RendererPlaybackInput {
	return {
		contractVersion: run.contractVersion,
		scene: run.input.scene,
		initialDynamicBodies: run.input.initialDynamicBodies,
		status: run.status,
		playableUntilTime: run.diagnostics.simulatedUntilTime,
		trajectories: run.trajectories,
		events: run.events,
		diagnostics: run.diagnostics
	};
}

export function assertPlaybackEligible(
	input: RendererPlaybackInput
): asserts input is RendererPlaybackInput & { status: { readonly type: 'complete' } } {
	if (input.status.type !== 'complete') {
		throw new Error(
			`Ordinary playback requires a complete run; received ${input.status.type}: ${input.status.reason}`
		);
	}

	if (!Number.isFinite(input.playableUntilTime) || input.playableUntilTime < 0) {
		throw new Error('Ordinary playback requires a finite, non-negative playable duration.');
	}
}
