<script lang="ts">
	import type { DiagnosticEntry } from '$lib/simulation/contracts';
	import { formatRecordedSeconds } from './model';

	let {
		entries,
		selectedBodyId
	}: { entries: readonly DiagnosticEntry[]; selectedBodyId: string | null } = $props();
</script>

<section class="console" aria-labelledby="diagnostics-heading">
	<header>
		<div>
			<p>Structured output</p>
			<h2 id="diagnostics-heading">Diagnostics console</h2>
		</div>
		<span>{entries.length} entries{selectedBodyId ? ` · ${selectedBodyId}` : ''}</span>
	</header>

	{#if entries.length === 0}
		<p class="empty">No diagnostic entries were recorded.</p>
	{:else}
		<ul>
			{#each entries as entry, index (`${entry.code}-${entry.time}-${index}`)}
				<li class:warning={entry.severity === 'warning'} class:error={entry.severity === 'error'}>
					<div class="metadata">
						<strong>{entry.severity}</strong>
						<code>{entry.code}</code>
						<time>{entry.time === null ? '—' : formatRecordedSeconds(entry.time)}</time>
						<span>{entry.bodyId ?? '—'}</span>
					</div>
					<p>{entry.message}</p>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.console {
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

	ul {
		overflow-y: auto;
		max-height: 24rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	li {
		padding: var(--space-3) var(--space-4);
		border-left: 0.2rem solid var(--color-accent);
	}

	li + li {
		border-top: 1px solid var(--color-border);
	}

	li.warning {
		border-left-color: var(--color-warning);
	}

	li.error {
		border-left-color: var(--color-danger);
	}

	.metadata {
		display: grid;
		grid-template-columns: auto minmax(8rem, 1fr) auto auto;
		gap: var(--space-3);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}

	.metadata strong {
		color: var(--color-accent);
		text-transform: uppercase;
	}

	.warning .metadata strong {
		color: var(--color-warning);
	}

	.error .metadata strong {
		color: var(--color-danger);
	}

	code {
		overflow-wrap: anywhere;
		color: var(--color-text);
	}

	li p,
	.empty {
		margin: var(--space-2) 0 0;
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.empty {
		padding: var(--space-6);
		margin: 0;
	}

	@media (max-width: 719px) {
		ul {
			max-height: 40vh;
		}

		.metadata {
			grid-template-columns: auto 1fr;
		}
	}
</style>
