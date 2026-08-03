<script lang="ts">
	import type { PlaybackFrame } from '$lib/rendering/playback';
	import type { SimulationRunRecord } from '$lib/simulation/contracts';
	import { formatRecordedSeconds, formatVector } from '../model';

	let {
		run,
		frame,
		selectedBodyId,
		onSelect
	}: {
		run: SimulationRunRecord;
		frame: PlaybackFrame;
		selectedBodyId: string | null;
		onSelect: (bodyId: string | null) => void;
	} = $props();

	let selectedInput = $derived(
		run.input.initialDynamicBodies.find(({ id }) => id === selectedBodyId) ?? null
	);
	let selectedPose = $derived(frame.bodies.find(({ bodyId }) => bodyId === selectedBodyId) ?? null);
	let selectedState = $derived(
		run.bodyStates.find(({ bodyId }) => bodyId === selectedBodyId) ?? null
	);
	let selectedTrajectory = $derived(
		run.trajectories.find(({ bodyId }) => bodyId === selectedBodyId) ?? null
	);
</script>

<section class="body-inspector" aria-labelledby="body-inspector-heading">
	<header>
		<div>
			<p>Per-body evidence</p>
			<h2 id="body-inspector-heading">Body inspector</h2>
		</div>
		<label>
			<span>Selected body</span>
			<select
				aria-label="Selected body"
				value={selectedBodyId ?? ''}
				onchange={(event) => onSelect(event.currentTarget.value || null)}
			>
				<option value="">All bodies</option>
				{#each run.input.initialDynamicBodies as body (body.id)}
					<option value={body.id}>{body.id}</option>
				{/each}
			</select>
		</label>
	</header>

	{#if selectedInput && selectedPose && selectedState}
		<div class="summary" aria-live="polite">
			<dl>
				<div>
					<dt>ID</dt>
					<dd>{selectedInput.id}</dd>
				</div>
				<div>
					<dt>Mass</dt>
					<dd>{selectedInput.mass} kg</dd>
				</div>
				<div>
					<dt>Radius</dt>
					<dd>{selectedInput.physicalShape.radius} m</dd>
				</div>
				<div>
					<dt>Release</dt>
					<dd>{formatRecordedSeconds(selectedInput.releaseTime)}</dd>
				</div>
				<div>
					<dt>Initial position</dt>
					<dd>{formatVector(selectedInput.position)}</dd>
				</div>
				<div>
					<dt>Initial velocity</dt>
					<dd>{formatVector(selectedInput.velocity)}</dd>
				</div>
				<div>
					<dt>Current position</dt>
					<dd>{selectedPose.position ? formatVector(selectedPose.position) : 'Not present'}</dd>
				</div>
				<div>
					<dt>Current velocity</dt>
					<dd>{selectedPose.velocity ? formatVector(selectedPose.velocity) : '—'}</dd>
				</div>
				<div>
					<dt>Motion mode</dt>
					<dd>{selectedPose.motionMode ?? 'none'}</dd>
				</div>
				<div>
					<dt>Lifecycle</dt>
					<dd>{selectedPose.lifecycle}</dd>
				</div>
				<div>
					<dt>Terminal outcome</dt>
					<dd>{selectedState.terminalOutcome ?? '—'}</dd>
				</div>
				<div class="wide">
					<dt>Contact components</dt>
					<dd>{selectedPose.contactComponentIds.join(', ') || 'None at this time'}</dd>
				</div>
			</dl>
			<details>
				<summary
					>{selectedTrajectory?.segments.length ?? 0} authoritative trajectory segments</summary
				>
				{#if selectedTrajectory && selectedTrajectory.segments.length > 0}
					<ol>
						{#each selectedTrajectory.segments as segment, index (`${segment.startTime}-${index}`)}
							<li class:current={selectedPose.segmentIndex === index}>
								<strong>{segment.type}</strong>
								<span
									>{formatRecordedSeconds(segment.startTime)} → {formatRecordedSeconds(
										segment.endTime
									)}</span
								>
							</li>
						{/each}
					</ol>
				{:else}
					<p>No trajectory was recorded for this body.</p>
				{/if}
			</details>
		</div>
	{:else}
		<p class="empty">
			Select one of {run.input.initialDynamicBodies.length} bodies to inspect its recorded state and filter
			the evidence panels.
		</p>
	{/if}
</section>

<style>
	.body-inspector {
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}
	header {
		display: flex;
		gap: var(--space-4);
		align-items: end;
		justify-content: space-between;
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-raised);
	}
	header p,
	h2,
	.empty,
	details p {
		margin: 0;
	}
	header p,
	dt,
	label span {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	h2 {
		margin-top: var(--space-1);
		font-size: 1rem;
	}
	label {
		display: grid;
		gap: var(--space-1);
	}
	select {
		min-width: 12rem;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		background: var(--color-surface);
		font-family: var(--font-mono);
	}
	.summary {
		padding: var(--space-4) var(--space-5);
	}
	dl {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0;
	}
	.wide {
		grid-column: span 2;
	}
	dd {
		overflow-wrap: anywhere;
		margin: var(--space-1) 0 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}
	details {
		margin-top: var(--space-4);
	}
	summary {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		font-weight: 800;
		cursor: pointer;
	}
	ol {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: var(--space-2);
		padding: 0;
		margin: var(--space-3) 0 0;
		list-style: none;
	}
	li {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}
	li.current {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	li span,
	.empty,
	details p {
		color: var(--color-text-muted);
	}
	.empty {
		padding: var(--space-5);
		line-height: 1.5;
	}
	@media (max-width: 719px) {
		header {
			display: grid;
			align-items: stretch;
			padding: var(--space-4);
		}
		select {
			width: 100%;
			min-height: 2.75rem;
		}
		.summary {
			padding: var(--space-4);
		}
		dl {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
