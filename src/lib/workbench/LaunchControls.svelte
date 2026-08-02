<script lang="ts">
	import type { SimulationInput } from '$lib/simulation/contracts';
	import type { LaunchDraft, LaunchField, LaunchValidationError } from './launch-controls';
	import { changeVelocityEntryMode } from './launch-controls';

	let {
		draft,
		errors,
		feedback,
		lastSubmittedInput,
		onResetDefault,
		onChangeDraft,
		onRun,
		onLoadScenario,
		onSaveScenario
	}: {
		draft: LaunchDraft;
		errors: readonly LaunchValidationError[];
		feedback: string | null;
		lastSubmittedInput: SimulationInput | null;
		onResetDefault: () => void;
		onChangeDraft: (draft: LaunchDraft) => void;
		onRun: () => void;
		onLoadScenario: (file: File) => Promise<void>;
		onSaveScenario: () => void;
	} = $props();

	let scenarioInput = $state<HTMLInputElement>();
	let lastSubmittedBody = $derived(lastSubmittedInput?.initialDynamicBodies[0] ?? null);

	function changeField(field: keyof LaunchDraft, value: string): void {
		onChangeDraft({ ...draft, [field]: value });
	}

	function changeVelocityMode(mode: LaunchDraft['velocityMode']): void {
		onChangeDraft(changeVelocityEntryMode(draft, mode));
	}

	function fieldError(field: LaunchField): LaunchValidationError | undefined {
		return errors.find((error) => error.field === field);
	}

	async function loadFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) await onLoadScenario(file);
		input.value = '';
	}
</script>

<section class="launch-panel" aria-labelledby="launch-heading">
	<header>
		<div>
			<p>Authoritative simulator input</p>
			<h2 id="launch-heading">Launch controls</h2>
		</div>
		<div class="scenario-actions">
			<button type="button" class="secondary" onclick={onResetDefault}
				>Reset canonical default</button
			>
			<button type="button" class="secondary" onclick={() => scenarioInput?.click()}
				>Load scenario</button
			>
			<button type="button" class="secondary" onclick={onSaveScenario}>Save scenario</button>
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

	<div class="launch-body">
		<fieldset class="position-fields">
			<legend>Initial position (m)</legend>
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
		</fieldset>

		<div class="velocity-column">
			<fieldset class="mode-fields">
				<legend>Launch velocity entry</legend>
				<label>
					<input
						type="radio"
						name="velocity-mode"
						value="speed-angle"
						checked={draft.velocityMode === 'speed-angle'}
						onchange={() => changeVelocityMode('speed-angle')}
					/>
					Speed + angle
				</label>
				<label>
					<input
						type="radio"
						name="velocity-mode"
						value="components"
						checked={draft.velocityMode === 'components'}
						onchange={() => changeVelocityMode('components')}
					/>
					Components
				</label>
			</fieldset>

			{#if draft.velocityMode === 'speed-angle'}
				<div class="velocity-fields">
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
				<div class="velocity-fields">
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

		<div class="run-column">
			<p>Edits remain drafts until Run snapshots and validates this input.</p>
			{#if lastSubmittedBody}
				<p class="submitted">
					Last submitted · p=({lastSubmittedBody.position[0]}, {lastSubmittedBody.position[1]}) ·
					v=({lastSubmittedBody.velocity[0]}, {lastSubmittedBody.velocity[1]})
				</p>
			{/if}
			<button type="button" class="run-button" onclick={onRun}>Run simulation</button>
		</div>
	</div>

	{#if fieldError('scenario')}
		<p class="panel-error" role="alert">
			<strong>{fieldError('scenario')!.code}</strong> · {fieldError('scenario')!.message}
		</p>
	{:else if feedback}
		<p class="feedback" role="status">{feedback}</p>
	{/if}
</section>

<style>
	.launch-panel {
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

	header p,
	legend,
	label > span {
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

	.scenario-actions,
	.velocity-fields,
	.mode-fields {
		display: flex;
		gap: var(--space-2);
	}

	.secondary,
	.run-button,
	input[type='number'] {
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

	.launch-body {
		display: grid;
		grid-template-columns: minmax(12rem, 0.7fr) minmax(20rem, 1.2fr) minmax(12rem, 0.65fr);
		gap: var(--space-4);
		align-items: start;
		padding: var(--space-4) var(--space-5);
	}

	.velocity-column,
	.run-column,
	fieldset,
	label {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}

	fieldset {
		padding: 0;
		border: 0;
		margin: 0;
	}

	.position-fields {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.position-fields legend,
	.mode-fields legend {
		grid-column: 1 / -1;
	}

	input[type='number'] {
		width: 100%;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		color: var(--color-text);
		background: var(--color-surface-raised);
		font-family: var(--font-mono);
	}

	.mode-fields {
		flex-wrap: wrap;
	}

	.mode-fields label {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
	}

	.velocity-fields > label {
		flex: 1;
	}

	.run-column {
		align-self: end;
	}

	.run-column p {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		line-height: 1.4;
	}

	.run-column .submitted {
		color: var(--color-text-subtle);
		font-family: var(--font-mono);
	}

	.run-button {
		padding: 0 var(--space-4);
		border: 1px solid var(--color-accent);
		color: var(--color-background);
		background: var(--color-accent);
		font-weight: 800;
		cursor: pointer;
	}

	.error,
	.panel-error {
		color: var(--color-danger);
		font-size: var(--font-size-xs);
	}

	.feedback,
	.panel-error {
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.feedback {
		color: var(--color-success);
	}

	.file-input {
		display: none;
	}

	@media (max-width: 1250px) {
		.launch-body {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 719px) {
		header,
		.scenario-actions,
		.launch-body,
		.velocity-fields {
			display: grid;
			grid-template-columns: 1fr;
			align-items: stretch;
		}

		.launch-body {
			padding: var(--space-4);
		}

		.position-fields {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
