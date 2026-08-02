<script lang="ts">
	import type { SimulationInput } from '$lib/simulation/contracts';
	import BallControls from './BallControls.svelte';
	import SimulationSettingsControls from './SimulationSettingsControls.svelte';
	import type {
		SimulationInputDraft,
		SimulationInputValidationError
	} from './simulation-input-draft';

	let {
		draft,
		errors,
		feedback,
		lastSubmittedInput,
		onResetDefault,
		onChangeDraft,
		onRun,
		onLoadScenario,
		onSaveScenario,
		canExportDiagnostics,
		exportFeedback,
		onExportDiagnostics
	}: {
		draft: SimulationInputDraft;
		errors: readonly SimulationInputValidationError[];
		feedback: string | null;
		lastSubmittedInput: SimulationInput | null;
		onResetDefault: () => void;
		onChangeDraft: (draft: SimulationInputDraft) => void;
		onRun: () => void;
		onLoadScenario: (file: File) => Promise<void>;
		onSaveScenario: () => void;
		canExportDiagnostics: boolean;
		exportFeedback: { readonly kind: 'success' | 'error'; readonly message: string } | null;
		onExportDiagnostics: () => void;
	} = $props();

	let scenarioInput = $state<HTMLInputElement>();
	let lastSubmittedBody = $derived(lastSubmittedInput?.initialDynamicBodies[0] ?? null);
	let scenarioError = $derived(errors.find((error) => error.field === 'scenario'));

	async function loadFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) await onLoadScenario(file);
		input.value = '';
	}
</script>

<section class="input-panel" aria-labelledby="input-heading">
	<header>
		<div>
			<p>Authoritative simulator input</p>
			<h2 id="input-heading">Simulation controls</h2>
		</div>
		<div class="scenario-actions">
			<button type="button" class="secondary" onclick={onResetDefault}
				>Reset canonical default</button
			>
			<button type="button" class="secondary" onclick={() => scenarioInput?.click()}
				>Load scenario</button
			>
			<button type="button" class="secondary" onclick={onSaveScenario}>Save scenario</button>
			<button
				type="button"
				class="diagnostic-export"
				onclick={onExportDiagnostics}
				disabled={!canExportDiagnostics}
				title={canExportDiagnostics
					? 'Export the accepted run and diagnostic evidence'
					: 'Run or load a simulation before exporting diagnostics'}
			>
				Export diagnostics
			</button>
			<input
				bind:this={scenarioInput}
				class="file-input"
				type="file"
				accept=".json,application/json"
				aria-label="Choose local scenario-input JSON"
				onchange={loadFile}
			/>
		</div>
	</header>

	<div class="input-body">
		<BallControls {draft} {errors} {onChangeDraft} />
		<SimulationSettingsControls {draft} {errors} {onChangeDraft} />

		<div class="run-column">
			<p>Edits remain drafts until Run snapshots and validates this input.</p>
			{#if lastSubmittedBody && lastSubmittedInput}
				<p class="submitted">
					Last submitted · radius {lastSubmittedBody.physicalShape.radius} m · p=({lastSubmittedBody
						.position[0]}, {lastSubmittedBody.position[1]}) · v=({lastSubmittedBody.velocity[0]}, {lastSubmittedBody
						.velocity[1]}) · gravity=({lastSubmittedInput.settings.gravity[0]}, {lastSubmittedInput
						.settings.gravity[1]})
				</p>
			{/if}
			<button type="button" class="run-button" onclick={onRun}>Run simulation</button>
		</div>
	</div>

	{#if scenarioError}
		<p class="panel-error" role="alert">
			<strong>{scenarioError.code}</strong> · {scenarioError.message}
		</p>
	{:else if exportFeedback}
		<p
			class:error={exportFeedback.kind === 'error'}
			class="feedback"
			role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
		>
			{exportFeedback.message}
		</p>
	{:else if feedback}
		<p class="feedback" role="status">{feedback}</p>
	{/if}
</section>

<style>
	.input-panel {
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}

	header {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-raised);
	}

	header p,
	h2,
	.run-column p,
	.feedback,
	.panel-error {
		margin: 0;
	}

	header p {
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

	.scenario-actions {
		display: flex;
		gap: var(--space-2);
	}

	.secondary,
	.diagnostic-export,
	.run-button {
		min-height: 2.5rem;
		border-radius: var(--radius-sm);
	}

	.secondary {
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		color: var(--color-text-subtle);
		background: var(--color-surface);
		font-weight: 700;
		cursor: pointer;
	}

	.diagnostic-export {
		padding: 0 var(--space-3);
		border: 1px solid var(--color-accent);
		color: var(--color-background);
		background: var(--color-accent);
		font-weight: 800;
		cursor: pointer;
	}

	.diagnostic-export:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.input-body {
		display: grid;
		grid-template-columns: minmax(26rem, 1.25fr) minmax(22rem, 1fr) minmax(14rem, 0.55fr);
		gap: var(--space-4);
		align-items: start;
		padding: var(--space-4) var(--space-5);
	}

	.run-column {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-raised);
	}

	.run-column p {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		line-height: 1.45;
	}

	.run-column .submitted {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}

	.run-button {
		padding: 0 var(--space-4);
		border: 0;
		color: #07111e;
		background: var(--color-accent);
		font-weight: 900;
		cursor: pointer;
	}

	.feedback,
	.panel-error {
		padding: 0 var(--space-5) var(--space-4);
		font-size: var(--font-size-sm);
	}

	.feedback {
		color: var(--color-success);
	}

	.feedback.error {
		color: var(--color-danger);
	}

	.panel-error {
		color: var(--color-danger);
	}

	.file-input {
		display: none;
	}

	button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}

	@media (max-width: 1249px) {
		.input-body {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.run-column {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 719px) {
		header,
		.scenario-actions,
		.input-body {
			display: grid;
			grid-template-columns: 1fr;
			align-items: stretch;
		}

		header,
		.input-body {
			padding: var(--space-4);
		}

		.run-column {
			grid-column: auto;
		}

		.secondary,
		.diagnostic-export,
		.run-button {
			min-height: 2.75rem;
		}
	}
</style>
