<script lang="ts">
	import { formatReplaySeconds, type InspectionMode } from './model';

	let {
		time,
		duration,
		playing,
		mode,
		onToggle,
		onRestart,
		onSeek
	}: {
		time: number;
		duration: number;
		playing: boolean;
		mode: InspectionMode;
		onToggle: () => void;
		onRestart: () => void;
		onSeek: (time: number) => void;
	} = $props();

	let canPlay = $derived(mode === 'completed-replay' && duration > 0);
	let canSeek = $derived(mode !== 'diagnostics-only' && duration > 0);

	function seek(event: Event): void {
		onSeek(Number((event.currentTarget as HTMLInputElement).value));
	}
</script>

<section class="controls-panel" aria-label="Replay controls">
	<div class="buttons">
		<button type="button" onclick={onToggle} disabled={!canPlay}
			>{playing ? 'Pause' : 'Play'}</button
		>
		<button class="secondary" type="button" onclick={onRestart} disabled={!canPlay}>Restart</button>
	</div>

	<label class="seek">
		<span>Seek recorded simulation time</span>
		<input
			type="range"
			min="0"
			max={duration}
			step="0.001"
			value={time}
			oninput={seek}
			disabled={!canSeek}
		/>
	</label>

	<output aria-live="off">{formatReplaySeconds(time)} / {formatReplaySeconds(duration)}</output>

	<p class="provenance">
		<span aria-hidden="true">◇</span>
		{mode === 'completed-replay'
			? 'Replaying already calculated trajectory data'
			: mode === 'recorded-prefix'
				? 'Explicit inspection of the recorded prefix'
				: 'No replayable trajectory is available'}
	</p>
</section>

<style>
	.controls-panel {
		display: grid;
		grid-template-columns: auto minmax(10rem, 1fr) auto;
		gap: var(--space-3) var(--space-4);
		align-items: center;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}

	.buttons {
		display: flex;
		gap: var(--space-2);
	}

	button {
		min-width: 5.5rem;
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		color: var(--color-background);
		background: var(--color-accent);
		font-weight: 800;
		cursor: pointer;
	}

	button.secondary {
		color: var(--color-text);
		background: transparent;
	}

	button:disabled {
		border-color: var(--color-border-strong);
		color: var(--color-text-muted);
		background: var(--color-background-soft);
		cursor: not-allowed;
		opacity: 0.75;
	}

	.seek {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}

	.seek span {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	input {
		width: 100%;
		accent-color: var(--color-accent);
	}

	output {
		color: var(--color-text-subtle);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}

	.provenance {
		grid-column: 1 / -1;
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin: 0;
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
	}

	.provenance span {
		color: var(--color-accent);
	}

	@media (max-width: 719px) {
		.controls-panel {
			grid-template-columns: 1fr auto;
		}

		.buttons {
			grid-column: 1 / -1;
		}

		.buttons button {
			flex: 1;
		}

		.seek {
			grid-column: 1 / -1;
		}
	}
</style>
