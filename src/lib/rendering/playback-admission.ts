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

	assertPlayableDuration(input.playableUntilTime, 'Ordinary playback');
}

export function assertRecordedInspectionEligible(
	input: RendererPlaybackInput
): asserts input is RendererPlaybackInput & {
	status: { readonly type: 'complete' | 'unresolved' | 'iteration-limited' };
} {
	if (input.status.type === 'invalid') {
		throw new Error(
			`Recorded inspection is unavailable for an invalid run: ${input.status.reason}`
		);
	}

	assertPlayableDuration(input.playableUntilTime, 'Recorded inspection');
}

function assertPlayableDuration(duration: number, operation: string): void {
	if (!Number.isFinite(duration) || duration < 0) {
		throw new Error(`${operation} requires a finite, non-negative playable duration.`);
	}
}
