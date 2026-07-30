<script lang="ts">
	import { onMount } from 'svelte';
	import { mountScene } from '$lib/rendering/mount-scene';
	import { prototypeSimulationInput } from '$lib/simulation/prototype-input';

	let sceneHost = $state<HTMLDivElement>();

	onMount(() => {
		if (!sceneHost) return;

		return mountScene(sceneHost, prototypeSimulationInput);
	});
</script>

<svelte:head>
	<title>Event-Driven Simulation</title>
	<meta
		name="description"
		content="A browser prototype for exploring event-driven mechanical simulation."
	/>
</svelte:head>

<main>
	<section class="intro">
		<p class="eyebrow">Browser prototype</p>
		<h1>Motion, one physical event at a time.</h1>
		<p class="summary">
			A minimal Three.js view over a serialisable simulation snapshot. The renderer visualises
			state; it never owns it.
		</p>

		<div class="contract">
			<span>simulation</span>
			<span class="arrow" aria-hidden="true">→</span>
			<span>snapshot</span>
			<span class="arrow" aria-hidden="true">→</span>
			<span>renderer</span>
		</div>
	</section>

	<section class="viewport" aria-label="Three-dimensional simulation preview">
		<div class="scene" bind:this={sceneHost} role="img" aria-label="A ball above three pegs"></div>
		<div class="status">
			<span class="pulse"></span>
			Prototype ready
		</div>
	</section>
</main>

<style>
	main {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(360px, 1.2fr);
		gap: clamp(2rem, 5vw, 6rem);
		align-items: center;
		width: min(1180px, calc(100% - 2rem));
		min-height: 100vh;
		margin: 0 auto;
		padding: 3rem 0;
	}

	.intro {
		position: relative;
		z-index: 1;
	}

	.eyebrow {
		margin: 0 0 1.15rem;
		color: #70d6ff;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	h1 {
		max-width: 9ch;
		margin: 0;
		font-size: clamp(3rem, 7vw, 6rem);
		font-weight: 650;
		letter-spacing: -0.065em;
		line-height: 0.91;
	}

	.summary {
		max-width: 33rem;
		margin: 1.8rem 0 2rem;
		color: #a9b8cf;
		font-size: clamp(1rem, 1.8vw, 1.18rem);
		line-height: 1.7;
	}

	.contract {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		align-items: center;
		color: #e7edf7;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.76rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.contract span:not(.arrow) {
		padding: 0.55rem 0.72rem;
		border: 1px solid #27344a;
		border-radius: 0.5rem;
		background: #0d1524;
	}

	.arrow {
		color: #53657e;
	}

	.viewport {
		position: relative;
		overflow: hidden;
		min-height: min(72vh, 720px);
		border: 1px solid #26334a;
		border-radius: 1.5rem;
		background: #0b1220;
		box-shadow: 0 2.5rem 8rem rgb(0 0 0 / 42%);
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

	.status {
		position: absolute;
		right: 1.2rem;
		bottom: 1.2rem;
		display: flex;
		gap: 0.55rem;
		align-items: center;
		padding: 0.6rem 0.8rem;
		border: 1px solid rgb(255 255 255 / 10%);
		border-radius: 999px;
		color: #c9d4e5;
		background: rgb(7 11 20 / 72%);
		font-size: 0.74rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		backdrop-filter: blur(10px);
	}

	.pulse {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: #61e294;
		box-shadow: 0 0 0.8rem #61e294;
	}

	@media (max-width: 820px) {
		main {
			grid-template-columns: 1fr;
			align-content: center;
			padding: 4rem 0 2rem;
		}

		h1 {
			max-width: 11ch;
		}

		.viewport {
			min-height: 520px;
		}
	}
</style>
