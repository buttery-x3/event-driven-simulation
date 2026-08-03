<script lang="ts">
	import type { PlaybackFrame } from '$lib/rendering/playback';
	import type { DiagnosticEntry, SimulationRunRecord } from '$lib/simulation/contracts';
	import DiagnosticsConsole from '../DiagnosticsConsole.svelte';
	import MetricsPanel from '../MetricsPanel.svelte';
	import { BodyInspector, PhysicalHistory } from '../inspection';

	let {
		run,
		frame,
		entries,
		selectedBodyId,
		selectedItemId,
		onSelectBody,
		onSelectHistory
	}: {
		run: SimulationRunRecord;
		frame: PlaybackFrame;
		entries: readonly DiagnosticEntry[];
		selectedBodyId: string | null;
		selectedItemId: string | null;
		onSelectBody: (bodyId: string | null) => void;
		onSelectHistory: (id: string, time: number) => void;
	} = $props();
</script>

<BodyInspector {run} {frame} {selectedBodyId} onSelect={onSelectBody} />

<div class="evidence-grid">
	<PhysicalHistory {run} {selectedBodyId} {selectedItemId} onSelect={onSelectHistory} />
	<DiagnosticsConsole {entries} {selectedBodyId} />
	<div class="metrics-slot"><MetricsPanel {run} /></div>
</div>
