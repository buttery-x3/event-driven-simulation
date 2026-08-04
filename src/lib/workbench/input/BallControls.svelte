<script lang="ts">
	import {
		appendScheduledBallDraft,
		type DynamicBodyDraft,
		type SimulationInputDraft,
		type SimulationInputValidationError
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

	let selectedIndex = $state(0);
	let body = $derived(
		draft.bodies[Math.min(selectedIndex, Math.max(draft.bodies.length - 1, 0))] ?? null
	);
	let bodyIndex = $derived(body ? draft.bodies.indexOf(body) : 0);

	function changeField(field: keyof DynamicBodyDraft, value: string): void {
		if (!body) return;
		changeBody({ ...body, [field]: value });
	}

	function changeBody(nextBody: DynamicBodyDraft): void {
		onChangeDraft({
			...draft,
			bodies: draft.bodies.map((candidate, index) => (index === bodyIndex ? nextBody : candidate))
		});
	}

	function addBall(): void {
		const nextDraft = appendScheduledBallDraft(draft);
		selectedIndex = nextDraft.bodies.length - 1;
		onChangeDraft(nextDraft);
	}

	function fieldError(field: keyof DynamicBodyDraft): SimulationInputValidationError | undefined {
		return errors.find((error) => error.field === `body.${bodyIndex}.${field}`);
	}
</script>

<fieldset class="control-group">
	<legend>Dynamic bodies</legend>

	<div class="body-selector-row">
		<label class="body-selector">
			<span>Body to edit</span>
			<select aria-label="Body to edit" bind:value={selectedIndex}>
				{#each draft.bodies as candidate, index (`${candidate.id}-${index}`)}
					<option value={index}
						>{candidate.id || `Body ${index + 1}`} · release {candidate.releaseTime} s</option
					>
				{/each}
			</select>
			<small>{draft.bodies.length} bodies · edit one at a time</small>
		</label>
		<button type="button" class="add-ball" onclick={addBall}>Add ball</button>
	</div>

	{#if body}
		<div class="paired-fields">
			<label
				><span>Body ID</span><input
					value={body.id}
					oninput={(event) => changeField('id', event.currentTarget.value)}
				/></label
			>
			<label
				><span>Release time (s)</span><input
					type="number"
					step="any"
					min="0"
					value={body.releaseTime}
					aria-invalid={fieldError('releaseTime') ? 'true' : undefined}
					oninput={(event) => changeField('releaseTime', event.currentTarget.value)}
				/>{#if fieldError('releaseTime')}<small class="error"
						>{fieldError('releaseTime')!.message}</small
					>{/if}</label
			>
			<label
				><span>Mass (kg)</span><input
					type="number"
					step="any"
					min="0"
					value={body.mass}
					aria-invalid={fieldError('mass') ? 'true' : undefined}
					oninput={(event) => changeField('mass', event.currentTarget.value)}
				/>{#if fieldError('mass')}<small class="error">{fieldError('mass')!.message}</small
					>{/if}</label
			>
			<label
				><span>Radius (m)</span><input
					type="number"
					step="any"
					min="0"
					value={body.radius}
					aria-invalid={fieldError('radius') ? 'true' : undefined}
					oninput={(event) => changeField('radius', event.currentTarget.value)}
				/>{#if fieldError('radius')}<small class="error">{fieldError('radius')!.message}</small
					>{/if}</label
			>
		</div>

		<div class="field-section" role="group" aria-label="Initial position (m)">
			<p>Initial position (m)</p>
			<div class="paired-fields">
				<label
					><span>X</span><input
						aria-label="Initial position X (m)"
						type="number"
						step="any"
						value={body.positionX}
						aria-invalid={fieldError('positionX') ? 'true' : undefined}
						oninput={(event) => changeField('positionX', event.currentTarget.value)}
					/>{#if fieldError('positionX')}<small class="error"
							>{fieldError('positionX')!.message}</small
						>{/if}</label
				>
				<label
					><span>Y</span><input
						aria-label="Initial position Y (m)"
						type="number"
						step="any"
						value={body.positionY}
						aria-invalid={fieldError('positionY') ? 'true' : undefined}
						oninput={(event) => changeField('positionY', event.currentTarget.value)}
					/>{#if fieldError('positionY')}<small class="error"
							>{fieldError('positionY')!.message}</small
						>{/if}</label
				>
			</div>
		</div>

		<div class="field-section" role="group" aria-label="Initial velocity">
			<p>Initial velocity</p>
			<div class="mode-fields">
				<label
					><input
						type="radio"
						name="velocity-mode"
						value="speed-angle"
						checked={body.velocityMode === 'speed-angle'}
						onchange={() => changeBody(changeVelocityEntryMode(body, 'speed-angle'))}
					/> Speed + angle</label
				>
				<label
					><input
						type="radio"
						name="velocity-mode"
						value="components"
						checked={body.velocityMode === 'components'}
						onchange={() => changeBody(changeVelocityEntryMode(body, 'components'))}
					/> Components</label
				>
			</div>
			{#if body.velocityMode === 'speed-angle'}
				<div class="paired-fields">
					<label
						><span>Speed (m/s)</span><input
							type="number"
							step="any"
							min="0"
							value={body.speed}
							aria-invalid={fieldError('speed') ? 'true' : undefined}
							oninput={(event) => changeField('speed', event.currentTarget.value)}
						/>{#if fieldError('speed')}<small class="error">{fieldError('speed')!.message}</small
							>{/if}</label
					>
					<label
						><span>Angle (degrees)</span><input
							type="number"
							step="any"
							value={body.angleDegrees}
							aria-invalid={fieldError('angleDegrees') ? 'true' : undefined}
							oninput={(event) => changeField('angleDegrees', event.currentTarget.value)}
						/>{#if fieldError('angleDegrees')}<small class="error"
								>{fieldError('angleDegrees')!.message}</small
							>{/if}</label
					>
				</div>
			{:else}
				<div class="paired-fields">
					<label
						><span>Velocity X (m/s)</span><input
							type="number"
							step="any"
							value={body.velocityX}
							aria-invalid={fieldError('velocityX') ? 'true' : undefined}
							oninput={(event) => changeField('velocityX', event.currentTarget.value)}
						/>{#if fieldError('velocityX')}<small class="error"
								>{fieldError('velocityX')!.message}</small
							>{/if}</label
					>
					<label
						><span>Velocity Y (m/s)</span><input
							type="number"
							step="any"
							value={body.velocityY}
							aria-invalid={fieldError('velocityY') ? 'true' : undefined}
							oninput={(event) => changeField('velocityY', event.currentTarget.value)}
						/>{#if fieldError('velocityY')}<small class="error"
								>{fieldError('velocityY')!.message}</small
							>{/if}</label
					>
				</div>
			{/if}
		</div>
	{:else}
		<p class="empty">No dynamic body is available to edit.</p>
	{/if}
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
	.field-section > p,
	.empty {
		margin: var(--space-2) 0 0;
	}
	.body-selector small,
	.empty {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.body-selector-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-2);
		align-items: center;
	}
	.add-ball {
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		background: var(--color-surface);
		font-weight: 800;
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
	input,
	select {
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
		input,
		select,
		.add-ball {
			min-height: 2.75rem;
		}
	}
</style>
