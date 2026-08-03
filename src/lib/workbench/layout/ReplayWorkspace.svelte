<script lang="ts">
	import type { RendererPlaybackInput, SimulationRunRecord } from '$lib/simulation/contracts';
	import type { RunValidationResult } from '$lib/simulation/verification';
	import PlaybackControls from '../PlaybackControls.svelte';
	import RunInspector from '../RunInspector.svelte';
	import SimulationViewport from '../SimulationViewport.svelte';
	import type { InspectionMode, RunSource } from '../model';

	let {
		playback,
		run,
		validation,
		source,
		replayTime,
		playing,
		mode,
		transportState,
		selectedBodyId,
		onToggle,
		onRestart,
		onSeek
	}: {
		playback: RendererPlaybackInput;
		run: SimulationRunRecord;
		validation: RunValidationResult;
		source: RunSource;
		replayTime: number;
		playing: boolean;
		mode: InspectionMode;
		transportState: 'playing' | 'paused' | 'ended';
		selectedBodyId: string | null;
		onToggle: () => void;
		onRestart: () => void;
		onSeek: (time: number) => void;
	} = $props();
</script>

<div class="primary-workspace">
	<div class="replay-workspace">
		<SimulationViewport
			input={playback}
			time={replayTime}
			{mode}
			independentValidationPassed={validation.valid}
			{transportState}
			{selectedBodyId}
		/>
		<PlaybackControls
			time={replayTime}
			duration={playback.playableUntilTime}
			{playing}
			{mode}
			{onToggle}
			{onRestart}
			{onSeek}
		/>
	</div>

	<RunInspector {run} {validation} {source} playableUntilTime={playback.playableUntilTime} />
</div>
