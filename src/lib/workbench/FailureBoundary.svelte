<script lang="ts">
	import type {
		RunContactCandidateDiagnostic,
		RunContactSearchDiagnostic,
		SimulationRunRecord
	} from '$lib/simulation/contracts';
	import { formatRecordedSeconds, formatVector } from './model';

	let { run }: { run: SimulationRunRecord } = $props();

	let lastSearch = $derived(run.diagnostics.contactSearches.at(-1) ?? null);
	let candidate = $derived(findBoundaryCandidate(run, lastSearch));
	let nearSimultaneous = $derived(
		lastSearch?.candidates.filter(({ nearSimultaneous }) => nearSimultaneous) ?? []
	);
	let detail = $derived('detail' in run.terminalReason ? run.terminalReason.detail : null);

	function findBoundaryCandidate(
		currentRun: SimulationRunRecord,
		search: RunContactSearchDiagnostic | null
	): RunContactCandidateDiagnostic | null {
		if (!search) return null;

		const terminalCollider =
			'colliderId' in currentRun.terminalReason ? currentRun.terminalReason.colliderId : null;
		const targetCollider = terminalCollider ?? search.selectedColliderId;
		const accepted = search.candidates.filter(
			({ classification }) => classification === 'accepted'
		);

		return (
			(targetCollider
				? accepted.find(({ colliderId }) => colliderId === targetCollider)
				: accepted[0]) ?? null
		);
	}

	function candidateDelta(
		item: RunContactCandidateDiagnostic,
		search: RunContactSearchDiagnostic
	): number {
		return item.timeDelta ?? item.time - search.searchInterval[0];
	}
</script>

<section
	class:invalid={run.validity === 'invalid'}
	class="boundary"
	aria-labelledby="boundary-heading"
>
	<header>
		<p>Termination report</p>
		<h3 id="boundary-heading">Failure boundary</h3>
	</header>

	<dl class="summary">
		<div>
			<dt>Classification</dt>
			<dd>{run.validity} / {run.outcome}</dd>
		</div>
		<div>
			<dt>Reason</dt>
			<dd>{run.terminalReason.type}</dd>
		</div>
		<div>
			<dt>Boundary time</dt>
			<dd>
				{run.terminalReason.time === null ? '—' : formatRecordedSeconds(run.terminalReason.time)}
			</dd>
		</div>
		<div>
			<dt>Committed segments</dt>
			<dd>{run.diagnostics.segmentCount}</dd>
		</div>
		<div>
			<dt>Physical events</dt>
			<dd>{run.diagnostics.eventCount}</dd>
		</div>
		<div>
			<dt>Last event index</dt>
			<dd>{run.events.length === 0 ? 'none' : run.events.length - 1}</dd>
		</div>
	</dl>

	{#if detail}
		<p class="detail">{detail}</p>
	{/if}

	{#if lastSearch}
		<section class="uncommitted" aria-labelledby="candidate-heading">
			<div class="uncommitted-heading">
				<div>
					<p>Uncommitted diagnostic evidence</p>
					<h4 id="candidate-heading">Proposed next contact</h4>
				</div>
				<span>Not accepted motion</span>
			</div>

			<dl>
				<div>
					<dt>Search outcome</dt>
					<dd>{lastSearch.outcome}</dd>
				</div>
				<div>
					<dt>Search interval</dt>
					<dd>
						{formatRecordedSeconds(lastSearch.searchInterval[0])} → {formatRecordedSeconds(
							lastSearch.searchInterval[1]
						)}
					</dd>
				</div>
				<div>
					<dt>Candidate collider</dt>
					<dd>
						{candidate?.colliderId ??
							lastSearch.selectedColliderId ??
							('colliderId' in run.terminalReason ? run.terminalReason.colliderId : '—')}
					</dd>
				</div>
				<div>
					<dt>Proposed event Δt</dt>
					<dd>{candidate ? formatRecordedSeconds(candidateDelta(candidate, lastSearch)) : '—'}</dd>
				</div>
				<div>
					<dt>Event-time tolerance</dt>
					<dd>
						{lastSearch.eventTimeTolerance === undefined
							? '—'
							: formatRecordedSeconds(lastSearch.eventTimeTolerance)}
					</dd>
				</div>
				<div>
					<dt>Contact normal</dt>
					<dd>{candidate?.normal ? formatVector(candidate.normal) : '—'}</dd>
				</div>
				<div>
					<dt>Pre-contact velocity</dt>
					<dd>
						{candidate?.preContactVelocity ? formatVector(candidate.preContactVelocity) : '—'}
					</dd>
				</div>
				<div>
					<dt>Proposed post-contact velocity</dt>
					<dd>
						{candidate?.postContactVelocity ? formatVector(candidate.postContactVelocity) : '—'}
					</dd>
				</div>
			</dl>

			{#if lastSearch.reason}
				<p class="search-reason">{lastSearch.reason}</p>
			{/if}

			<div class="near">
				<strong>Near-simultaneous candidates</strong>
				{#if nearSimultaneous.length === 0}
					<span>None recorded.</span>
				{:else}
					<ul>
						{#each nearSimultaneous as item (`${item.colliderId}-${item.feature}-${item.time}`)}
							<li>
								{item.colliderId} · {item.feature} · Δt {formatRecordedSeconds(
									candidateDelta(item, lastSearch)
								)}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>

		<details>
			<summary>Contact-search history ({run.diagnostics.contactSearches.length})</summary>
			<ol>
				{#each run.diagnostics.contactSearches as search, index (`${search.searchInterval[0]}-${search.searchInterval[1]}-${index}`)}
					<li>
						<strong>Search {index}</strong>
						<span
							>{formatRecordedSeconds(search.searchInterval[0])} → {formatRecordedSeconds(
								search.searchInterval[1]
							)}</span
						>
						<span>{search.outcome} · {search.candidates.length} candidates</span>
						{#if search.candidates.length > 0}
							<code
								>{search.candidates
									.map(
										(item) =>
											`${item.colliderId}: Δt ${formatRecordedSeconds(candidateDelta(item, search))}${item.nearSimultaneous ? ' (near)' : ''}`
									)
									.join(' · ')}</code
							>
						{/if}
					</li>
				{/each}
			</ol>
		</details>
	{/if}
</section>

<style>
	.boundary {
		border-top: 1px solid var(--color-border);
		border-left: 0.22rem solid var(--color-warning);
	}

	.boundary.invalid {
		border-left-color: var(--color-danger);
	}

	header,
	.summary,
	.detail,
	.uncommitted,
	details {
		padding: var(--space-4) var(--space-5);
	}

	header p,
	header h3,
	.detail,
	dl,
	.uncommitted-heading p,
	.uncommitted-heading h4,
	.search-reason,
	.near ul,
	details ol {
		margin: 0;
	}

	header p,
	.uncommitted-heading p {
		color: var(--color-warning);
		font-size: var(--font-size-xs);
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.invalid header p {
		color: var(--color-danger);
	}

	header h3,
	.uncommitted-heading h4 {
		margin-top: var(--space-1);
		font-size: 1rem;
	}

	.summary,
	.uncommitted dl {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}

	dt {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
	}

	dd {
		overflow-wrap: anywhere;
		margin: var(--space-1) 0 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.detail,
	.search-reason {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.detail {
		padding-top: 0;
	}

	.uncommitted {
		margin: 0 var(--space-4) var(--space-4);
		padding: var(--space-4);
		border: 1px dashed color-mix(in srgb, var(--color-warning) 58%, var(--color-border));
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-warning) 5%, transparent);
	}

	.invalid .uncommitted {
		border-color: color-mix(in srgb, var(--color-danger) 58%, var(--color-border));
	}

	.uncommitted-heading {
		display: flex;
		gap: var(--space-3);
		align-items: start;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.uncommitted-heading > span {
		padding: var(--space-1) var(--space-2);
		border: 1px solid currentcolor;
		border-radius: 999px;
		color: var(--color-warning);
		font-size: var(--font-size-xs);
		font-weight: 800;
		text-transform: uppercase;
	}

	.search-reason,
	.near {
		margin-top: var(--space-4);
	}

	.near {
		display: grid;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}

	.near span,
	.near li {
		color: var(--color-text-subtle);
	}

	.near ul {
		padding-left: var(--space-5);
	}

	details {
		border-top: 1px solid var(--color-border);
	}

	summary {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
		font-weight: 800;
		cursor: pointer;
	}

	details ol {
		display: grid;
		gap: var(--space-3);
		overflow-y: auto;
		max-height: 20rem;
		padding: var(--space-4) 0 0 var(--space-5);
	}

	details li {
		display: grid;
		gap: var(--space-1);
		color: var(--color-text-subtle);
		font-size: var(--font-size-xs);
	}

	details code {
		overflow-wrap: anywhere;
		white-space: normal;
	}
</style>
