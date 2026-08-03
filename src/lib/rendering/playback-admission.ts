import type { RendererPlaybackInput, SimulationRunRecord } from '$lib/simulation/contracts';

export function toRendererPlaybackInput(run: SimulationRunRecord): RendererPlaybackInput {
	return {
		contractVersion: run.contractVersion,
		scene: run.input.scene,
		initialDynamicBodies: run.input.initialDynamicBodies,
		validity: run.validity,
		outcome: run.outcome,
		terminalReason: run.terminalReason,
		playableUntilTime: run.diagnostics.simulatedUntilTime,
		bodyStates: run.bodyStates,
		trajectories: run.trajectories,
		events: run.events,
		releases: run.releases,
		dynamicContacts: run.dynamicContacts,
		contactComponents: run.contactComponents,
		componentEvents: run.componentEvents,
		diagnostics: run.diagnostics
	};
}

export function assertPlaybackEligible(
	input: RendererPlaybackInput
): asserts input is RendererPlaybackInput & { validity: 'valid' } {
	if (input.validity !== 'valid' || (input.outcome !== 'exited' && input.outcome !== 'settled')) {
		throw new Error(
			`Ordinary playback requires a valid exited or settled run; received ${input.validity} ${input.outcome}.`
		);
	}

	assertPlayableDuration(input.playableUntilTime, 'Ordinary playback');
}

export function assertRecordedInspectionEligible(
	input: RendererPlaybackInput
): asserts input is RendererPlaybackInput {
	assertPlayableDuration(input.playableUntilTime, 'Recorded inspection');
}

function assertPlayableDuration(duration: number, operation: string): void {
	if (!Number.isFinite(duration) || duration < 0) {
		throw new Error(`${operation} requires a finite, non-negative playable duration.`);
	}
}
