<script lang="ts">
	import type { SimulationRunRecord } from '$lib/simulation/contracts';
	import { formatRecordedSeconds } from '../model';
	import { buildWorkbenchHistory, filterHistoryByBody } from './history-items';

	let {
		run,
		selectedBodyId,
		selectedItemId,
		onSelect
	}: {
		run: SimulationRunRecord;
		selectedBodyId: string | null;
		selectedItemId: string | null;
		onSelect: (id: string, time: number) => void;
	} = $props();

	let allItems = $derived(buildWorkbenchHistory(run));
	let items = $derived(filterHistoryByBody(allItems, selectedBodyId));
</script>

<section class="panel timeline" aria-labelledby="history-heading">
	<header>
		<div>
			<p>Authoritative evidence</p>
			<h2 id="history-heading">Physical history</h2>
		</div>
		<span>{items.length} shown{selectedBodyId ? ` · ${selectedBodyId}` : ''}</span>
	</header>

	{#if items.length === 0}
		<p class="empty">No recorded history matches the selected body.</p>
	{:else}
		<ol>
			{#each items as item, index (item.id)}
				<li>
					<button
						type="button"
						onclick={() => onSelect(item.id, item.time)}
						aria-current={selectedItemId === item.id ? 'true' : undefined}
						aria-label={`History ${index + 1}, ${item.title.replace(' → ', ' to ')} at ${formatRecordedSeconds(item.time)}`}
					>
						<span class="sequence">{index + 1}</span>
						<time>{formatRecordedSeconds(item.time)}</time>
						<strong>{item.title}</strong>
						<span>{item.participants}</span>
						<small>{item.detail}</small>
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
	ol {
		overflow-y: auto;
		max-height: 28rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}
	li + li {
		border-top: 1px solid var(--color-border);
	}
	button {
		position: relative;
		display: grid;
		grid-template-columns: 2rem 7rem minmax(9rem, 0.8fr) minmax(10rem, 1fr);
		gap: var(--space-2) var(--space-3);
		align-items: center;
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
	button:hover,
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
	button strong {
		color: var(--color-accent);
	}
	button small {
		grid-column: 3 / -1;
		color: var(--color-text-muted);
		line-height: 1.45;
	}
	.empty {
		margin: 0;
		padding: var(--space-6);
		color: var(--color-text-muted);
	}
	@media (max-width: 719px) {
		ol {
			max-height: 40vh;
		}
		button {
			grid-template-columns: auto 1fr;
			min-height: 44px;
		}
		button strong,
		button span:not(.sequence),
		button small {
			grid-column: 2;
		}
	}
</style>
