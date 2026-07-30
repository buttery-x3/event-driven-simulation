<script lang="ts">
	import { onMount } from 'svelte';
	import { mountScene, type MountedPlaybackScene } from '$lib/rendering/mount-scene';
	import {
		getPlaybackFrame,
		PlaybackClock,
		toRendererPlaybackInput
	} from '$lib/rendering/playback';
	import { prototypeSimulationInput } from '$lib/simulation/prototype-input';
	import { generateSyntheticRun } from '$lib/simulation/synthetic-run';

	const playback = toRendererPlaybackInput(generateSyntheticRun(prototypeSimulationInput));
	const clock = new PlaybackClock(playback.playableUntilTime);
	let sceneHost = $state<HTMLDivElement>();
	let sceneController: MountedPlaybackScene | undefined;
	let frame = $state(getPlaybackFrame(playback, 0));
	let playing = $state(false);
	let body = $derived(frame.bodies[0]);

	function syncPlayback(): void {
		frame = sceneController?.setTime(clock.time) ?? getPlaybackFrame(playback, clock.time);
		playing = clock.playing;
	}

	function togglePlayback(): void {
		if (clock.playing) {
			clock.pause();
		} else {
			clock.play();
		}

		syncPlayback();
	}

	function restartPlayback(): void {
		clock.restart();
		syncPlayback();
	}

	function seekPlayback(event: Event): void {
		clock.seek(Number((event.currentTarget as HTMLInputElement).value));
		syncPlayback();
	}

	onMount(() => {
		if (!sceneHost) return;

		sceneController = mountScene(sceneHost, playback);
		clock.play();
		syncPlayback();
		let previousTimestamp: number | null = null;
		let animationFrame = 0;

		const animate = (timestamp: number) => {
			const elapsedSeconds =
				previousTimestamp === null ? 0 : (timestamp - previousTimestamp) / 1_000;
			previousTimestamp = timestamp;
			clock.advance(elapsedSeconds);
			syncPlayback();
			animationFrame = requestAnimationFrame(animate);
		};

		animationFrame = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(animationFrame);
			sceneController?.destroy();
		};
	});
</script>

<svelte:head>
	<title>Trajectory Replay | Event-Driven Simulation</title>
	<meta
		name="description"
		content="A Three.js replay of a completed event-driven simulation trajectory."
	/>
</svelte:head>

<main>
	<section class="intro">
		<p class="eyebrow">Completed run replay</p>
		<h1>Motion, one recorded segment at a time.</h1>
		<p class="summary">
			Three.js presents a precomputed trajectory. Playback changes presentation time only; physical
			motion and events remain exactly as recorded by the headless simulation.
		</p>

		<div class="contract" aria-label="Data flow">
			<span>simulation</span>
			<span class="arrow" aria-hidden="true">→</span>
			<span>completed run</span>
			<span class="arrow" aria-hidden="true">→</span>
			<span>renderer</span>
		</div>
	</section>

	<section class="replay" aria-label="Trajectory playback">
		<div class="viewport">
			<div
				class="scene"
				bind:this={sceneHost}
				role="img"
				aria-label="A ball replaying a completed trajectory past fixed pegs"
			></div>
			<div class="status">
				<span class:playing class="pulse"></span>
				{playing ? 'Playing' : frame.time >= playback.playableUntilTime ? 'Complete' : 'Paused'}
			</div>
		</div>

		<div class="playback-panel">
			<div class="controls">
				<button type="button" onclick={togglePlayback}>{playing ? 'Pause' : 'Play'}</button>
				<button class="secondary" type="button" onclick={restartPlayback}>Restart</button>
				<label>
					<span class="sr-only">Seek through completed trajectory</span>
					<input
						type="range"
						min="0"
						max={playback.playableUntilTime}
						step="0.001"
						value={frame.time}
						oninput={seekPlayback}
					/>
				</label>
				<output>{frame.time.toFixed(3)}s / {playback.playableUntilTime.toFixed(3)}s</output>
			</div>

			<dl class="debug" aria-label="Playback diagnostics">
				<div>
					<dt>Run</dt>
					<dd>{playback.status.type}</dd>
				</div>
				<div>
					<dt>Body</dt>
					<dd>{body?.bodyId ?? 'none'}</dd>
				</div>
				<div>
					<dt>Segment</dt>
					<dd>{body?.segmentIndex === null ? 'none' : (body?.segmentIndex ?? -1) + 1}</dd>
				</div>
				<div>
					<dt>Latest event</dt>
					<dd>
						{frame.mostRecentEvent
							? `${frame.mostRecentEvent.type} @ ${frame.mostRecentEvent.time.toFixed(3)}s`
							: 'none yet'}
					</dd>
				</div>
			</dl>
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
		max-width: 10ch;
		margin: 0;
		font-size: clamp(3rem, 7vw, 6rem);
		font-weight: 650;
		letter-spacing: -0.065em;
		line-height: 0.91;
	}

	.summary {
		max-width: 35rem;
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

	.replay {
		display: grid;
		gap: 0.9rem;
	}

	.viewport {
		position: relative;
		overflow: hidden;
		min-height: min(62vh, 620px);
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
		background: #778399;
		box-shadow: 0 0 0.8rem #778399;
	}

	.pulse.playing {
		background: #61e294;
		box-shadow: 0 0 0.8rem #61e294;
	}

	.playback-panel {
		padding: 1rem;
		border: 1px solid #26334a;
		border-radius: 1rem;
		background: #0d1524;
	}

	.controls {
		display: grid;
		grid-template-columns: auto auto minmax(110px, 1fr) auto;
		gap: 0.7rem;
		align-items: center;
	}

	button {
		min-width: 5.2rem;
		padding: 0.62rem 0.85rem;
		border: 1px solid #70d6ff;
		border-radius: 0.55rem;
		color: #08111f;
		background: #70d6ff;
		font-weight: 700;
		cursor: pointer;
	}

	button.secondary {
		color: #d9e5f7;
		background: transparent;
	}

	label,
	input {
		width: 100%;
	}

	output,
	.debug {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.72rem;
	}

	output {
		color: #a9b8cf;
		white-space: nowrap;
	}

	.debug {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.7rem;
		margin: 1rem 0 0;
		padding-top: 0.9rem;
		border-top: 1px solid #26334a;
	}

	.debug div {
		min-width: 0;
	}

	dt {
		margin-bottom: 0.3rem;
		color: #718096;
		text-transform: uppercase;
	}

	dd {
		overflow: hidden;
		margin: 0;
		color: #d9e5f7;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
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
			min-height: 500px;
		}
	}

	@media (max-width: 560px) {
		.controls {
			grid-template-columns: 1fr 1fr;
		}

		.controls label {
			grid-column: 1 / -1;
		}

		.debug {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
