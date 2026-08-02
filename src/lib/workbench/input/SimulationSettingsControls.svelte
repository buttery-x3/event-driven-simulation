<script lang="ts">
	import type {
		SimulationInputDraft,
		SimulationInputField,
		SimulationInputValidationError
	} from './simulation-input-draft';

	let {
		draft,
		errors,
		onChangeDraft
	}: {
		draft: SimulationInputDraft;
		errors: readonly SimulationInputValidationError[];
		onChangeDraft: (draft: SimulationInputDraft) => void;
	} = $props();

	function changeField(field: keyof SimulationInputDraft, value: string): void {
		onChangeDraft({ ...draft, [field]: value });
	}

	function fieldError(field: SimulationInputField): SimulationInputValidationError | undefined {
		return errors.find((error) => error.field === field);
	}
</script>

<div class="settings-groups">
	<fieldset class="control-group">
		<legend>Environment</legend>
		<div class="paired-fields">
			<label>
				<span>Gravity X (m/s²)</span>
				<input
					type="number"
					step="any"
					value={draft.gravityX}
					aria-invalid={fieldError('gravityX') ? 'true' : undefined}
					aria-describedby={fieldError('gravityX') ? 'gravity-x-error' : undefined}
					oninput={(event) => changeField('gravityX', event.currentTarget.value)}
				/>
				{#if fieldError('gravityX')}
					<small class="error" id="gravity-x-error">{fieldError('gravityX')!.message}</small>
				{/if}
			</label>
			<label>
				<span>Gravity Y (m/s²)</span>
				<input
					type="number"
					step="any"
					value={draft.gravityY}
					aria-invalid={fieldError('gravityY') ? 'true' : undefined}
					aria-describedby={fieldError('gravityY') ? 'gravity-y-error' : undefined}
					oninput={(event) => changeField('gravityY', event.currentTarget.value)}
				/>
				{#if fieldError('gravityY')}
					<small class="error" id="gravity-y-error">{fieldError('gravityY')!.message}</small>
				{/if}
			</label>
		</div>
		<label>
			<span>Bounciness</span>
			<small class="hint">Coefficient of restitution · 0 to 1</small>
			<input
				type="number"
				step="any"
				min="0"
				max="1"
				value={draft.restitution}
				aria-invalid={fieldError('restitution') ? 'true' : undefined}
				aria-describedby={fieldError('restitution') ? 'restitution-error' : undefined}
				oninput={(event) => changeField('restitution', event.currentTarget.value)}
			/>
			{#if fieldError('restitution')}
				<small class="error" id="restitution-error">{fieldError('restitution')!.message}</small>
			{/if}
		</label>
	</fieldset>

	<fieldset class="control-group run-limits">
		<legend>Run limits</legend>
		<p>Reproducibility and safety limits; these are not physical properties.</p>
		<div class="paired-fields">
			<label>
				<span>Maximum time (s)</span>
				<input
					type="number"
					step="any"
					min="0"
					value={draft.maximumSimulationTime}
					aria-invalid={fieldError('maximumSimulationTime') ? 'true' : undefined}
					aria-describedby={fieldError('maximumSimulationTime') ? 'maximum-time-error' : undefined}
					oninput={(event) => changeField('maximumSimulationTime', event.currentTarget.value)}
				/>
				{#if fieldError('maximumSimulationTime')}
					<small class="error" id="maximum-time-error"
						>{fieldError('maximumSimulationTime')!.message}</small
					>
				{/if}
			</label>
			<label>
				<span>Maximum events</span>
				<input
					type="number"
					step="1"
					min="0"
					value={draft.maximumEvents}
					aria-invalid={fieldError('maximumEvents') ? 'true' : undefined}
					aria-describedby={fieldError('maximumEvents') ? 'maximum-events-error' : undefined}
					oninput={(event) => changeField('maximumEvents', event.currentTarget.value)}
				/>
				{#if fieldError('maximumEvents')}
					<small class="error" id="maximum-events-error"
						>{fieldError('maximumEvents')!.message}</small
					>
				{/if}
			</label>
		</div>
	</fieldset>
</div>

<style>
	.settings-groups,
	.control-group,
	label {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}

	.settings-groups {
		gap: var(--space-4);
	}

	.control-group {
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		margin: 0;
		background: var(--color-background-soft);
	}

	.run-limits {
		border-style: dashed;
	}

	legend,
	label > span {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	legend {
		padding: 0 var(--space-2);
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}

	.paired-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.hint,
	.run-limits p {
		margin: 0;
		color: var(--color-text-subtle);
		font-size: var(--font-size-xs);
		line-height: 1.4;
	}

	input[type='number'] {
		width: 100%;
		min-height: 2.5rem;
		box-sizing: border-box;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		background: var(--color-surface);
		font-family: var(--font-mono);
	}

	input[aria-invalid='true'] {
		border-color: var(--color-danger);
	}

	.error {
		color: var(--color-danger);
		font-size: var(--font-size-xs);
		line-height: 1.35;
	}

	@media (max-width: 719px) {
		.paired-fields {
			grid-template-columns: 1fr;
		}

		input[type='number'] {
			min-height: 2.75rem;
		}
	}
</style>
