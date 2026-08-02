<script lang="ts">
	import type { RunOutcome, SimulationInput } from '$lib/simulation/contracts';
	import {
		assessScenarioOutcome,
		workbenchScenarioCategories,
		type WorkbenchScenarioDescriptor
	} from './scenario-catalogue';

	let {
		scenarios,
		selectedScenarioId,
		customInput,
		actualScenarioId,
		actualOutcome,
		onSelectScenario
	}: {
		scenarios: readonly WorkbenchScenarioDescriptor[];
		selectedScenarioId: string | null;
		customInput: SimulationInput;
		actualScenarioId: string | null;
		actualOutcome: RunOutcome | null;
		onSelectScenario: (scenarioId: string) => void;
	} = $props();

	let selectedScenario = $derived(
		scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null
	);
	let displayedInput = $derived(selectedScenario?.input ?? customInput);
	let initialBody = $derived(displayedInput.initialDynamicBodies[0] ?? null);
	let outcomeAssessment = $derived(
		selectedScenario
			? assessScenarioOutcome(selectedScenario, actualScenarioId, actualOutcome)
			: { status: 'not-run' as const, actualOutcome: null }
	);
</script>

<section class="catalogue-panel" aria-labelledby="scenario-catalogue-heading">
	<header>
		<div>
			<p>Verification worlds</p>
			<h2 id="scenario-catalogue-heading">Scenario catalogue</h2>
		</div>
		<label>
			<span>Scenario preset</span>
			<select
				aria-label="Scenario preset"
				value={selectedScenarioId ?? ''}
				onchange={(event) => onSelectScenario(event.currentTarget.value)}
			>
				{#if selectedScenarioId === null}
					<option value="">Loaded custom scenario</option>
				{/if}
				{#each workbenchScenarioCategories as category (category.id)}
					{@const categoryScenarios = scenarios.filter(
						(scenario) => scenario.categoryId === category.id
					)}
					{#if categoryScenarios.length > 0}
						<optgroup label={category.name}>
							{#each categoryScenarios as scenario (scenario.id)}
								<option value={scenario.id}>{scenario.name}</option>
							{/each}
						</optgroup>
					{/if}
				{/each}
			</select>
		</label>
	</header>

	<div class="catalogue-body" aria-live="polite">
		<div class="identity">
			<span>Stable scenario ID</span>
			<strong aria-label="Selected scenario ID">{selectedScenario?.id ?? 'custom-input'}</strong>
		</div>
		<div class="identity">
			<span>Scene / board ID</span>
			<strong aria-label="Selected scene ID">{displayedInput.scene.id}</strong>
		</div>
		<div class="purpose">
			<span>Verification purpose</span>
			<p>
				{selectedScenario?.verificationPurpose ??
					'The scene and numerical policy came from the validated local input document.'}
			</p>
		</div>
		<div class="initial-state">
			<span>Relevant initial state</span>
			{#if initialBody}
				<p>
					<strong>{initialBody.id}</strong> · radius {initialBody.physicalShape.radius} m · p=({initialBody
						.position[0]}, {initialBody.position[1]}) · v=({initialBody.velocity[0]}, {initialBody
						.velocity[1]})
				</p>
			{:else}
				<p>No dynamic body is declared.</p>
			{/if}
			<p>
				{displayedInput.scene.staticColliders.length} fixed colliders · gravity=({displayedInput
					.settings.gravity[0]}, {displayedInput.settings.gravity[1]}) m/s² · restitution {displayedInput
					.settings.restitution}
			</p>
		</div>
		<div class="outcomes" aria-label="Scenario outcome comparison">
			<div>
				<span>Expected / permitted outcomes</span>
				<p>{selectedScenario?.expectedOutcomes.join(' or ') ?? 'No catalogue contract'}</p>
			</div>
			<div
				class:matched={outcomeAssessment.status === 'matched'}
				class:mismatched={outcomeAssessment.status === 'mismatched'}
				role={outcomeAssessment.status === 'mismatched' ? 'alert' : undefined}
			>
				<span>Actual outcome (accepted run)</span>
				{#if outcomeAssessment.status === 'not-run'}
					<p>Not run for this selection</p>
				{:else}
					<p>
						{outcomeAssessment.actualOutcome} · {outcomeAssessment.status === 'matched'
							? 'permitted'
							: 'mismatch'}
					</p>
				{/if}
			</div>
		</div>
	</div>
</section>

<style>
	.catalogue-panel {
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}

	header {
		display: flex;
		gap: var(--space-5);
		align-items: end;
		justify-content: space-between;
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-raised);
	}

	header p,
	header h2,
	.catalogue-body p {
		margin: 0;
	}

	header p,
	span {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	header h2 {
		margin-top: var(--space-1);
		font-size: 1rem;
	}

	header label {
		display: grid;
		grid-template-columns: auto minmax(16rem, 25rem);
		gap: var(--space-2);
		align-items: center;
	}

	select {
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		background: var(--color-surface);
		font-family: var(--font-mono);
	}

	.catalogue-body {
		display: grid;
		grid-template-columns: minmax(10rem, 0.55fr) minmax(12rem, 0.75fr) minmax(20rem, 1.5fr) minmax(
				20rem,
				1.5fr
			);
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
	}

	.identity,
	.purpose,
	.initial-state,
	.outcomes,
	.outcomes > div {
		display: grid;
		gap: var(--space-2);
		align-content: start;
		min-width: 0;
	}

	.identity strong {
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.purpose p,
	.initial-state p,
	.outcomes p {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		line-height: 1.45;
	}

	.initial-state p:first-of-type {
		font-family: var(--font-mono);
	}

	.outcomes {
		grid-column: 1 / -1;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
	}

	.outcomes > div {
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background-soft);
	}

	.outcomes .matched {
		border-color: color-mix(in srgb, var(--color-success) 45%, var(--color-border));
	}

	.outcomes .matched p {
		color: var(--color-success);
	}

	.outcomes .mismatched {
		border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border));
	}

	.outcomes .mismatched p {
		color: var(--color-danger);
		font-weight: 800;
	}

	@media (max-width: 1250px) {
		.catalogue-body {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 719px) {
		header,
		header label,
		.catalogue-body,
		.outcomes {
			display: grid;
			grid-template-columns: 1fr;
			align-items: stretch;
		}

		header,
		.catalogue-body {
			padding: var(--space-4);
		}

		.outcomes {
			grid-column: auto;
		}
	}
</style>
