<script lang="ts">
	import type { SimulationRunRecord } from '$lib/simulation/contracts';
	import type { RunValidationResult } from '$lib/simulation/verification';
	import FailureBoundary from './FailureBoundary.svelte';
	import {
		formatRecordedSeconds,
		formatSource,
		formatVector,
		getRunCounts,
		getRunStatusLabel,
		type RunSource
	} from './model';

	let {
		run,
		validation,
		source,
		playableUntilTime
	}: {
		run: SimulationRunRecord;
		validation: RunValidationResult;
		source: RunSource;
		playableUntilTime: number;
	} = $props();

	let counts = $derived(getRunCounts(run));
	let submittedBody = $derived(run.input.initialDynamicBodies[0] ?? null);
	let impactSolves = $derived(run.diagnostics.impactSolves ?? []);
	let accumulations = $derived(run.diagnostics.accumulations ?? []);

	function formatGeneralisedVelocity(values: readonly number[]): string {
		return `[${values.map((value) => Number(value.toPrecision(6))).join(', ')}]`;
	}
</script>

<aside class="inspector" aria-labelledby="inspector-heading">
	<header>
		<p>Authoritative record</p>
		<h2 id="inspector-heading">Run inspector</h2>
	</header>

	<section class="outcome" aria-label="Calculation outcome">
		<strong
			class:failed={!validation.valid || (run.outcome !== 'exited' && run.outcome !== 'settled')}
			>{validation.valid
				? getRunStatusLabel(run.terminalReason)
				: 'Independent validation failed'}</strong
		>
		{#if !validation.valid}
			<p>
				{validation.failures.length} structured validation {validation.failures.length === 1
					? 'failure'
					: 'failures'} detected. The authoritative solver result remains {run.validity} / {run.outcome}.
			</p>
		{:else if run.outcome === 'exited' || run.outcome === 'settled'}
			<p>Calculation completed before replay began.</p>
		{:else}
			<p>
				{'detail' in run.terminalReason
					? run.terminalReason.detail
					: `Simulation stopped at ${run.terminalReason.type}.`}
			</p>
		{/if}
	</section>

	<dl>
		<div class="wide">
			<dt>Source</dt>
			<dd>{formatSource(source)}</dd>
		</div>
		<div>
			<dt>Scene</dt>
			<dd>{run.input.scene.id}</dd>
		</div>
		<div>
			<dt>Contract</dt>
			<dd>v{run.contractVersion}</dd>
		</div>
		<div>
			<dt>Simulated until</dt>
			<dd>{formatRecordedSeconds(run.diagnostics.simulatedUntilTime)}</dd>
		</div>
		<div>
			<dt>Playable until</dt>
			<dd>{formatRecordedSeconds(playableUntilTime)}</dd>
		</div>
	</dl>

	<section class="counts" aria-labelledby="counts-heading">
		<h3 id="counts-heading">Recorded contents</h3>
		<dl>
			<div>
				<dt>Bodies</dt>
				<dd>{counts.bodies}</dd>
			</div>
			<div>
				<dt>Colliders</dt>
				<dd>{counts.colliders}</dd>
			</div>
			<div>
				<dt>Trajectories</dt>
				<dd>{counts.trajectories}</dd>
			</div>
			<div>
				<dt>Segments</dt>
				<dd>{counts.segments}</dd>
			</div>
			<div>
				<dt>Events</dt>
				<dd>{counts.events}</dd>
			</div>
			<div>
				<dt>Releases</dt>
				<dd>{counts.releases}</dd>
			</div>
			<div>
				<dt>Dynamic contacts</dt>
				<dd>{counts.dynamicContacts}</dd>
			</div>
			<div>
				<dt>Contact components</dt>
				<dd>{counts.contactComponents}</dd>
			</div>
			<div>
				<dt>Diagnostics</dt>
				<dd>{counts.diagnostics}</dd>
			</div>
		</dl>
	</section>

	{#if run.outcome !== 'exited' && run.outcome !== 'settled'}
		<FailureBoundary {run} />
	{/if}

	<details open>
		<summary>Submitted settings and numerical policy</summary>
		<dl class="settings">
			{#if submittedBody}
				<div>
					<dt>First body radius</dt>
					<dd>{submittedBody.physicalShape.radius} m</dd>
				</div>
			{/if}
			<div>
				<dt>Gravity</dt>
				<dd>{formatVector(run.input.settings.gravity)}</dd>
			</div>
			<div>
				<dt>Bounciness (restitution)</dt>
				<dd>{run.input.settings.restitution}</dd>
			</div>
			<div>
				<dt>Maximum events</dt>
				<dd>{run.input.settings.maximumEvents}</dd>
			</div>
			<div>
				<dt>Maximum simulation time</dt>
				<dd>{formatRecordedSeconds(run.input.settings.maximumSimulationTime)}</dd>
			</div>
			<div>
				<dt>Contact tolerance</dt>
				<dd>{run.input.settings.tolerances.contactDistance}</dd>
			</div>
			<div>
				<dt>Event-time tolerance</dt>
				<dd>{run.input.settings.tolerances.eventTime}</dd>
			</div>
		</dl>
	</details>

	{#if accumulations.length > 0}
		<details open>
			<summary>Accumulation candidates and resolution</summary>
			<div class="impact-solves">
				{#each accumulations as accumulation, index (`${accumulation.limit?.id}-${index}`)}
					<section>
						<strong>{accumulation.limit?.id ?? `rejected candidate ${index + 1}`}</strong>
						<p>Candidate decision: {accumulation.status} — {accumulation.reason}</p>
						<p>
							Physical resolution: {accumulation.finalClassification}; impact components
							{accumulation.downstreamImpactComponentIds.length}, support components
							{accumulation.downstreamSupportComponentIds.length}.
						</p>
						<dl class="impact-evidence">
							<div class="wide">
								<dt>Participant bodies</dt>
								<dd>{accumulation.participantBodyIds.join(', ') || 'none'}</dd>
							</div>
							<div class="wide">
								<dt>Candidate fixed contacts</dt>
								<dd>{accumulation.candidateFixedColliderIds.join(', ') || 'none'}</dd>
							</div>
						</dl>
						<details>
							<summary>Source physical events ({accumulation.sourceEventIds.length})</summary>
							<ol>
								{#each accumulation.sourceEventIds as eventId (eventId)}
									<li><code>{eventId}</code></li>
								{/each}
							</ol>
						</details>
						{#if accumulation.limit}
							<dl class="impact-evidence">
								<div>
									<dt>Limit contacts / components</dt>
									<dd>
										{accumulation.limit.activeLimitContacts.length} / {accumulation.limit
											.connectedComponents.length}
									</dd>
								</div>
								<div>
									<dt>Certification method</dt>
									<dd>{accumulation.limit.certificationMethod}</dd>
								</div>
								<div>
									<dt>Certified event time</dt>
									<dd>{formatRecordedSeconds(accumulation.limit.currentCertifiedTime)}</dd>
								</div>
								<div>
									<dt>Mathematical limit time</dt>
									<dd>{formatRecordedSeconds(accumulation.limit.candidateLimitTime)}</dd>
								</div>
								<div class="wide">
									<dt>Remaining-time upper bound</dt>
									<dd>{accumulation.limit.remainingTimeUpperBound}</dd>
								</div>
								<div class="wide">
									<dt>Positive event intervals</dt>
									<dd>{accumulation.limit.temporalResiduals.positiveIntervals.join(', ')}</dd>
								</div>
								<div class="wide">
									<dt>Reconstructed limiting contacts</dt>
									<dd>{accumulation.limit.activeLimitContacts.map(({ id }) => id).join(', ')}</dd>
								</div>
								<div class="wide">
									<dt>Downstream component IDs</dt>
									<dd>
										{[
											...accumulation.downstreamImpactComponentIds,
											...accumulation.downstreamSupportComponentIds
										].join(', ') || 'none'}
									</dd>
								</div>
							</dl>
						{/if}
					</section>
				{/each}
			</div>
		</details>
	{/if}

	{#if impactSolves.length > 0}
		<details open>
			<summary>Coupled impact flow</summary>
			<div class="impact-solves">
				{#each impactSolves as solve, index (`${solve.componentId}-${index}`)}
					<section>
						<strong>{solve.componentId ?? `impact ${index + 1}`}</strong>
						<p>
							active component ({solve.bodyIds.length} bodies / {solve.contactIds.length} contacts) &rarr;
							implicit equality detection ({solve.linealityDimension}) &rarr; anti-locking
							projection &rarr; elastic reflection sequence ({solve.reflections.length}) &rarr;
							inelastic endpoint &rarr; energetic restitution ({solve.restitution}) &rarr; {solve.completion ===
							'complete'
								? 'final state'
								: 'certification failure'}
						</p>
						<dl class="impact-evidence">
							<div>
								<dt>Violation threshold</dt>
								<dd>{solve.violationThreshold}</dd>
							</div>
							<div>
								<dt>Projected / removed gradients</dt>
								<dd>{solve.projectedContactGradients.length} / {solve.removedContactIds.length}</dd>
							</div>
							<div class="wide">
								<dt>Inelastic endpoint</dt>
								<dd>{formatGeneralisedVelocity(solve.inelasticVelocity)}</dd>
							</div>
							<div class="wide">
								<dt>Elastic endpoint</dt>
								<dd>{formatGeneralisedVelocity(solve.elasticVelocity)}</dd>
							</div>
							<div class="wide">
								<dt>Final velocity</dt>
								<dd>{formatGeneralisedVelocity(solve.finalVelocity)}</dd>
							</div>
						</dl>
					</section>
				{/each}
			</div>
		</details>
	{/if}
</aside>

<style>
	.inspector {
		align-self: start;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}

	header {
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-raised);
	}

	header p,
	h2,
	h3,
	.outcome p,
	dl {
		margin: 0;
	}

	header p,
	h3 {
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

	.outcome {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
	}

	.outcome strong {
		color: var(--color-success);
		font-size: 1.05rem;
	}

	.outcome strong.failed {
		color: var(--color-warning);
	}

	.outcome p {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.inspector > dl,
	.counts,
	details {
		padding: var(--space-4) var(--space-5);
	}

	.inspector > dl,
	.counts dl,
	.settings {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
	}

	.impact-solves {
		display: grid;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}

	.impact-solves section {
		display: grid;
		gap: var(--space-2);
	}

	.impact-solves strong {
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.impact-solves p {
		margin: 0;
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.impact-evidence {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}

	.wide {
		grid-column: 1 / -1;
	}

	dt {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
	}

	dd {
		overflow-wrap: anywhere;
		margin: var(--space-1) 0 0;
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.counts,
	details {
		border-top: 1px solid var(--color-border);
	}

	.counts h3 {
		margin-bottom: var(--space-4);
	}

	summary {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		font-weight: 800;
		cursor: pointer;
	}

	.settings {
		margin-top: var(--space-4);
	}

	@media (max-width: 1099px) and (min-width: 720px) {
		.inspector > dl,
		.counts dl,
		.settings {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		.wide {
			grid-column: span 2;
		}
	}
</style>
