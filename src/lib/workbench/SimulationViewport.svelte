<script lang="ts">
	import { mountScene, type MountedPlaybackScene } from '$lib/rendering/mount-scene';
	import type { RendererPlaybackInput } from '$lib/simulation/contracts';
	import { getInspectionModeLabel, getRunStatusLabel, type InspectionMode } from './model';

	let {
		input,
		time,
		mode,
		transportState
	}: {
		input: RendererPlaybackInput;
		time: number;
		mode: InspectionMode;
		transportState: 'playing' | 'paused' | 'ended';
	} = $props();

	let sceneHost = $state<HTMLDivElement>();
	let sceneController = $state.raw<MountedPlaybackScene>();

	$effect(() => {
		const host = sceneHost;
		const playbackInput = input;
		if (!host) return;

		const controller = mountScene(host, playbackInput);
		sceneController = controller;

		return () => {
			if (sceneController === controller) sceneController = undefined;
			controller.destroy();
		};
	});

	$effect(() => {
		sceneController?.setTime(time);
	});
</script>

<section class="viewport-panel" aria-labelledby="viewport-heading">
	<header>
		<div>
			<p class="eyebrow">Recorded data</p>
			<h2 id="viewport-heading">{getInspectionModeLabel(mode)}</h2>
		</div>
		<div class="badges" aria-label="Run and transport status">
			<span class:danger={input.validity === 'invalid'} class:warning={mode === 'recorded-prefix'}>
				{getRunStatusLabel(input.terminalReason)}
			</span>
			<span class:playing={transportState === 'playing'}>{transportState}</span>
		</div>
	</header>

	<div class="viewport">
		<div
			class="scene"
			bind:this={sceneHost}
			role="img"
			aria-label={`Scene ${input.scene.id} replaying recorded ball trajectory data`}
		></div>
		{#if mode !== 'completed-replay'}
			<div class:invalid={mode === 'invalid-prefix'} class="restriction" role="status">
				<strong
					>{mode === 'invalid-prefix' ? 'Invalid committed prefix' : 'Recorded prefix only'}</strong
				>
				<span>Playback freezes at the last committed state. Candidate motion is not rendered.</span>
			</div>
		{/if}
	</div>
</section>

<style>
	.viewport-panel {
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow: var(--shadow-viewport);
	}

	header {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		justify-content: space-between;
		min-height: 4rem;
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-raised);
	}

	.eyebrow,
	h2 {
		margin: 0;
	}

	.eyebrow {
		color: var(--color-accent);
		font-size: var(--font-size-xs);
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h2 {
		margin-top: var(--space-1);
		font-size: 1rem;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		justify-content: end;
	}

	.badges span {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: 999px;
		color: var(--color-text-subtle);
		background: var(--color-background-soft);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
	}

	.badges span:first-child {
		color: var(--color-success);
		border-color: color-mix(in srgb, var(--color-success) 45%, var(--color-border));
	}

	.badges span.warning {
		color: var(--color-warning);
		border-color: color-mix(in srgb, var(--color-warning) 45%, var(--color-border));
	}

	.badges span.danger {
		color: var(--color-danger);
		border-color: color-mix(in srgb, var(--color-danger) 45%, var(--color-border));
	}

	.badges span.playing {
		color: var(--color-accent);
	}

	.viewport {
		position: relative;
		min-height: clamp(28rem, 61vh, 44rem);
		background: linear-gradient(rgb(4 8 16 / 20%), rgb(4 8 16 / 65%)), var(--color-background-soft);
	}

	.scene {
		position: absolute;
		inset: 0;
	}

	.scene :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.restriction {
		position: absolute;
		z-index: var(--layer-overlay);
		right: var(--space-4);
		bottom: var(--space-4);
		display: grid;
		gap: var(--space-1);
		max-width: 24rem;
		padding: var(--space-3) var(--space-4);
		border: 1px solid color-mix(in srgb, var(--color-warning) 50%, transparent);
		border-radius: var(--radius-md);
		color: var(--color-text);
		background: rgb(8 13 23 / 88%);
		backdrop-filter: blur(12px);
	}

	.restriction strong {
		color: var(--color-warning);
	}

	.restriction.invalid {
		border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
	}

	.restriction.invalid strong {
		color: var(--color-danger);
	}

	.restriction span {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
	}

	@media (max-width: 1099px) {
		.viewport {
			min-height: max(50vh, 28rem);
		}
	}

	@media (max-width: 719px) {
		header {
			align-items: start;
			padding: var(--space-3) var(--space-4);
		}

		.badges {
			display: grid;
			justify-items: end;
		}

		.viewport {
			min-height: 20rem;
		}

		.restriction {
			right: var(--space-3);
			bottom: var(--space-3);
			left: var(--space-3);
		}
	}
</style>
