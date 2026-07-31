<script lang="ts">
	import type { LoadFeedback, RepositoryRunFixture, RunSource } from './model';
	import { formatSource } from './model';

	let {
		fixtures,
		source,
		feedback,
		onSelectFixture,
		onLoadFile
	}: {
		fixtures: readonly RepositoryRunFixture[];
		source: RunSource;
		feedback: LoadFeedback | null;
		onSelectFixture: (fixtureId: string) => void;
		onLoadFile: (file: File) => Promise<void>;
	} = $props();

	let fileInput = $state<HTMLInputElement>();

	function selectFixture(event: Event): void {
		const fixtureId = (event.currentTarget as HTMLSelectElement).value;
		if (fixtureId) onSelectFixture(fixtureId);
	}

	async function loadFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];

		if (file) await onLoadFile(file);
		input.value = '';
	}
</script>

<header class="application-bar" aria-label="Workbench application bar">
	<div class="identity">
		<p class="eyebrow">Diagnostics workbench</p>
		<h1>Event-Driven Simulation</h1>
	</div>

	<div class="source" aria-label="Current run source">
		<span class="source-label">Current source</span>
		<strong>{formatSource(source)}</strong>
	</div>

	<div class="actions">
		<label>
			<span>Repository fixture</span>
			<select
				aria-label="Repository fixture"
				value={source.kind === 'repository' ? source.id : ''}
				onchange={selectFixture}
				disabled={feedback?.kind === 'reading'}
			>
				{#if source.kind !== 'repository'}
					<option value=""
						>{source.kind === 'local' ? 'Local file selected' : 'Calculated scenario'}</option
					>
				{/if}
				{#each fixtures as fixture (fixture.id)}
					<option value={fixture.id}>{fixture.name}</option>
				{/each}
			</select>
		</label>

		<button
			type="button"
			class="load-button"
			onclick={() => fileInput?.click()}
			disabled={feedback?.kind === 'reading'}
		>
			Load saved run
		</button>
		<input
			bind:this={fileInput}
			class="file-input"
			type="file"
			accept=".json,application/json"
			aria-label="Choose local saved-run JSON"
			onchange={loadFile}
		/>
	</div>

	{#if feedback}
		<p
			class:error={feedback.kind === 'error'}
			class="feedback"
			role={feedback.kind === 'error' ? 'alert' : 'status'}
		>
			{feedback.message}
		</p>
	{/if}
</header>

<style>
	.application-bar {
		display: grid;
		grid-template-columns: auto minmax(14rem, 1fr) auto;
		gap: var(--space-4) var(--space-6);
		align-items: center;
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		box-shadow: var(--shadow-panel);
	}

	.identity {
		min-width: max-content;
	}

	.eyebrow,
	h1,
	.source-label,
	.source strong,
	.feedback {
		margin: 0;
	}

	.eyebrow,
	.source-label,
	label span {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	h1 {
		margin-top: var(--space-1);
		font-size: 1rem;
		letter-spacing: -0.01em;
	}

	.source {
		min-width: 0;
		padding-left: var(--space-5);
		border-left: 1px solid var(--color-border);
	}

	.source strong {
		display: block;
		overflow: hidden;
		margin-top: var(--space-1);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.actions {
		display: flex;
		gap: var(--space-3);
		align-items: end;
	}

	label {
		display: grid;
		gap: var(--space-1);
	}

	select,
	.load-button {
		min-height: 2.75rem;
		border-radius: var(--radius-sm);
	}

	select {
		max-width: 16rem;
		padding: 0 var(--space-8) 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		color: var(--color-text);
		background: var(--color-surface-raised);
	}

	.load-button {
		padding: 0 var(--space-4);
		border: 1px solid var(--color-accent);
		color: var(--color-background);
		background: var(--color-accent);
		font-weight: 750;
		cursor: pointer;
	}

	.load-button:disabled,
	select:disabled {
		cursor: wait;
		opacity: 0.6;
	}

	.file-input {
		display: none;
	}

	.feedback {
		grid-column: 1 / -1;
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
		color: var(--color-success);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.feedback.error {
		color: var(--color-danger);
	}

	@media (max-width: 1099px) {
		.application-bar {
			grid-template-columns: auto 1fr;
		}

		.actions {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 719px) {
		.application-bar {
			grid-template-columns: 1fr;
			padding: var(--space-4);
		}

		.source,
		.actions,
		.feedback {
			grid-column: 1;
		}

		.source {
			padding: var(--space-3) 0 0;
			border-top: 1px solid var(--color-border);
			border-left: 0;
		}

		.source strong {
			white-space: normal;
		}

		.actions {
			display: grid;
			grid-template-columns: 1fr;
			align-items: stretch;
		}

		select {
			width: 100%;
			max-width: none;
		}

		.load-button {
			min-height: 2.75rem;
		}
	}
</style>
