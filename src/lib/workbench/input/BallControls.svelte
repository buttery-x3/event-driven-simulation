<script lang="ts">
	import type {
		SimulationInputDraft,
		SimulationInputField,
		SimulationInputValidationError
	} from './simulation-input-draft';
	import { changeVelocityEntryMode } from './velocity-entry';

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

<fieldset class="control-group">
	<legend>Ball</legend>

	<label>
		<span>Radius (m)</span>
		<input
			type="number"
			step="any"
			min="0"
			value={draft.radius}
			aria-invalid={fieldError('radius') ? 'true' : undefined}
			aria-describedby={fieldError('radius') ? 'radius-error' : undefined}
			oninput={(event) => changeField('radius', event.currentTarget.value)}
		/>
		{#if fieldError('radius')}
			<small class="error" id="radius-error">{fieldError('radius')!.message}</small>
		{/if}
	</label>

	<div class="field-section" role="group" aria-labelledby="position-label">
		<p id="position-label">Initial position (m)</p>
		<div class="paired-fields">
			<label>
				<span>X</span>
				<input
					type="number"
					step="any"
					value={draft.positionX}
					aria-invalid={fieldError('positionX') ? 'true' : undefined}
					aria-describedby={fieldError('positionX') ? 'position-x-error' : undefined}
					oninput={(event) => changeField('positionX', event.currentTarget.value)}
				/>
				{#if fieldError('positionX')}
					<small class="error" id="position-x-error">{fieldError('positionX')!.message}</small>
				{/if}
			</label>
			<label>
				<span>Y</span>
				<input
					type="number"
					step="any"
					value={draft.positionY}
					aria-invalid={fieldError('positionY') ? 'true' : undefined}
					aria-describedby={fieldError('positionY') ? 'position-y-error' : undefined}
					oninput={(event) => changeField('positionY', event.currentTarget.value)}
				/>
				{#if fieldError('positionY')}
					<small class="error" id="position-y-error">{fieldError('positionY')!.message}</small>
				{/if}
			</label>
		</div>
	</div>

	<div class="field-section" role="group" aria-labelledby="velocity-label">
		<p id="velocity-label">Initial velocity</p>
		<div class="mode-fields">
			<label>
				<input
					type="radio"
					name="velocity-mode"
					value="speed-angle"
					checked={draft.velocityMode === 'speed-angle'}
					onchange={() => onChangeDraft(changeVelocityEntryMode(draft, 'speed-angle'))}
				/>
				Speed + angle
			</label>
			<label>
				<input
					type="radio"
					name="velocity-mode"
					value="components"
					checked={draft.velocityMode === 'components'}
					onchange={() => onChangeDraft(changeVelocityEntryMode(draft, 'components'))}
				/>
				Components
			</label>
		</div>

		{#if draft.velocityMode === 'speed-angle'}
			<div class="paired-fields">
				<label>
					<span>Speed (m/s)</span>
					<input
						type="number"
						step="any"
						min="0"
						value={draft.speed}
						aria-invalid={fieldError('speed') ? 'true' : undefined}
						aria-describedby={fieldError('speed') ? 'speed-error' : undefined}
						oninput={(event) => changeField('speed', event.currentTarget.value)}
					/>
					{#if fieldError('speed')}
						<small class="error" id="speed-error">{fieldError('speed')!.message}</small>
					{/if}
				</label>
				<label>
					<span>Angle (degrees)</span>
					<input
						type="number"
						step="any"
						value={draft.angleDegrees}
						aria-invalid={fieldError('angleDegrees') ? 'true' : undefined}
						aria-describedby={fieldError('angleDegrees') ? 'angle-error' : undefined}
						oninput={(event) => changeField('angleDegrees', event.currentTarget.value)}
					/>
					{#if fieldError('angleDegrees')}
						<small class="error" id="angle-error">{fieldError('angleDegrees')!.message}</small>
					{/if}
				</label>
			</div>
		{:else}
			<div class="paired-fields">
				<label>
					<span>Velocity X (m/s)</span>
					<input
						type="number"
						step="any"
						value={draft.velocityX}
						aria-invalid={fieldError('velocityX') ? 'true' : undefined}
						aria-describedby={fieldError('velocityX') ? 'velocity-x-error' : undefined}
						oninput={(event) => changeField('velocityX', event.currentTarget.value)}
					/>
					{#if fieldError('velocityX')}
						<small class="error" id="velocity-x-error">{fieldError('velocityX')!.message}</small>
					{/if}
				</label>
				<label>
					<span>Velocity Y (m/s)</span>
					<input
						type="number"
						step="any"
						value={draft.velocityY}
						aria-invalid={fieldError('velocityY') ? 'true' : undefined}
						aria-describedby={fieldError('velocityY') ? 'velocity-y-error' : undefined}
						oninput={(event) => changeField('velocityY', event.currentTarget.value)}
					/>
					{#if fieldError('velocityY')}
						<small class="error" id="velocity-y-error">{fieldError('velocityY')!.message}</small>
					{/if}
				</label>
			</div>
		{/if}
	</div>
</fieldset>

<style>
	.control-group,
	.field-section,
	label {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}

	.control-group {
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		margin: 0;
		background: var(--color-background-soft);
	}

	legend,
	.field-section > p,
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

	.field-section > p {
		margin: var(--space-2) 0 0;
	}

	.paired-fields,
	.mode-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.mode-fields {
		grid-template-columns: repeat(2, auto);
		justify-content: start;
	}

	.mode-fields label {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		font-weight: 700;
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
		.paired-fields,
		.mode-fields {
			grid-template-columns: 1fr;
		}

		.mode-fields label,
		input[type='number'] {
			min-height: 2.75rem;
		}
	}
</style>
