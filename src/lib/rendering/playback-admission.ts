import type { RendererPlaybackInput, SimulationRunRecord } from '$lib/simulation/contracts';

export function toRendererPlaybackInput(run: SimulationRunRecord): RendererPlaybackInput {
	return {
		contractVersion: run.contractVersion,
		scene: run.input.scene,
		initialDynamicBodies: run.input.initialDynamicBodies,
		validity: run.validity,
		terminalReason: run.terminalReason,
		playableUntilTime: run.diagnostics.simulatedUntilTime,
		trajectories: run.trajectories,
		events: run.events,
		diagnostics: run.diagnostics
	};
}

export function assertPlaybackEligible(
	input: RendererPlaybackInput
): asserts input is RendererPlaybackInput & {
	terminalReason: Extract<RendererPlaybackInput['terminalReason'], { type: 'completion-region' }>;
} {
	if (input.validity !== 'valid' || input.terminalReason.type !== 'completion-region') {
		throw new Error(
			`Ordinary playback requires a valid completion-region run; received ${input.validity} ${input.terminalReason.type}.`
		);
	}

	assertPlayableDuration(input.playableUntilTime, 'Ordinary playback');
}

export function assertRecordedInspectionEligible(
	input: RendererPlaybackInput
): asserts input is RendererPlaybackInput & {
	validity: 'valid';
} {
	if (input.validity === 'invalid') {
		throw new Error(
			`Recorded inspection is unavailable for an invalid run: ${input.terminalReason.type}.`
		);
	}

	assertPlayableDuration(input.playableUntilTime, 'Recorded inspection');
}

function assertPlayableDuration(duration: number, operation: string): void {
	if (!Number.isFinite(duration) || duration < 0) {
		throw new Error(`${operation} requires a finite, non-negative playable duration.`);
	}
}
