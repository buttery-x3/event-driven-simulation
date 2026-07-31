<script lang="ts">
	import type { PhysicalEvent } from '$lib/simulation/contracts';
	import { formatRecordedSeconds, formatVector } from './model';

	let {
		events,
		selectedIndex,
		canSeek,
		onSelect
	}: {
		events: readonly PhysicalEvent[];
		selectedIndex: number | null;
		canSeek: boolean;
		onSelect: (index: number, time: number) => void;
	} = $props();
</script>

<section class="panel timeline" aria-labelledby="timeline-heading">
	<header>
		<div>
			<p>Physical history</p>
			<h2 id="timeline-heading">Event timeline</h2>
		</div>
		<span>{events.length} recorded</span>
	</header>

	<div class="column-headings" aria-hidden="true">
		<span>#</span><span>Simulation time</span><span>Type</span><span>Participants</span><span
			>Contact</span
		>
	</div>

	{#if events.length === 0}
		<p class="empty">No physical events were recorded.</p>
	{:else}
		<ol>
			{#each events as event, index (`${event.time}-${event.bodyId}-${event.colliderId}-${index}`)}
				<li>
					<button
						type="button"
						onclick={() => onSelect(index, event.time)}
						disabled={!canSeek}
						aria-current={selectedIndex === index ? 'true' : undefined}
						aria-label={`Event ${index + 1}, ${event.type} at ${formatRecordedSeconds(event.time)}`}
					>
						<span data-label="Sequence">{index + 1}</span>
						<time data-label="Simulation time">{formatRecordedSeconds(event.time)}</time>
						<strong data-label="Type">{event.type}</strong>
						<span data-label="Participants">{event.bodyId} → {event.colliderId}</span>
						<span data-label="Contact">{formatVector(event.position)}</span>
						<small>normal {formatVector(event.normal)}</small>
					</button>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.panel {
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-raised);
	}

	header p,
	h2 {
		margin: 0;
	}

	header p {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	h2 {
		margin-top: var(--space-1);
		font-size: 1rem;
	}

	header > span {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}

	.column-headings,
	button {
		display: grid;
		grid-template-columns:
			2rem minmax(6.5rem, 0.7fr) minmax(5rem, 0.5fr) minmax(10rem, 1.3fr)
			minmax(7rem, 0.8fr);
		gap: var(--space-3);
		align-items: center;
	}

	.column-headings {
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
	}

	ol {
		overflow-y: auto;
		max-height: 24rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	li + li {
		border-top: 1px solid var(--color-border);
	}

	button {
		position: relative;
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 0;
		color: var(--color-text-subtle);
		background: transparent;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		text-align: left;
		cursor: pointer;
	}

	button:hover:not(:disabled),
	button[aria-current='true'] {
		background: var(--color-accent-soft);
	}

	button[aria-current='true']::before {
		position: absolute;
		inset: 0 auto 0 0;
		width: 0.2rem;
		background: var(--color-accent);
		content: '';
	}

	button:disabled {
		cursor: default;
	}

	button strong {
		color: var(--color-accent);
		font-weight: 700;
	}

	button small {
		grid-column: 4 / -1;
		color: var(--color-text-muted);
	}

	.empty {
		margin: 0;
		padding: var(--space-6);
		color: var(--color-text-muted);
	}

	@media (max-width: 719px) {
		.column-headings {
			display: none;
		}

		ol {
			max-height: 40vh;
		}

		button {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			min-height: 44px;
		}

		button span,
		button time,
		button strong {
			display: grid;
			gap: var(--space-1);
		}

		button [data-label]::before {
			color: var(--color-text-muted);
			font-family: var(--font-sans);
			font-size: var(--font-size-xs);
			text-transform: uppercase;
			content: attr(data-label);
		}

		button small {
			grid-column: 1 / -1;
		}
	}
</style>
