<script lang="ts">
	import type { SimulationRunRecord } from '$lib/simulation/contracts';
	import {
		formatRecordedSeconds,
		getRunCounts,
		getSeverityCounts,
		type RunCounts,
		type SeverityCounts
	} from './model';

	let { run }: { run: SimulationRunRecord } = $props();

	let counts: RunCounts = $derived(getRunCounts(run));
	let severities: SeverityCounts = $derived(getSeverityCounts(run));
</script>

<section class="metrics" aria-labelledby="metrics-heading">
	<header>
		<p>Measurement provenance</p>
		<h2 id="metrics-heading">Metrics</h2>
	</header>

	<dl>
		<div>
			<dt>Solver iterations <span>Recorded</span></dt>
			<dd>{run.diagnostics.iterations}</dd>
		</div>
		<div>
			<dt>Simulated until <span>Recorded</span></dt>
			<dd>{formatRecordedSeconds(run.diagnostics.simulatedUntilTime)}</dd>
		</div>
		<div>
			<dt>Events / segments <span>Derived</span></dt>
			<dd>{counts.events} / {counts.segments}</dd>
		</div>
		<div>
			<dt>Diagnostics I / W / E <span>Derived</span></dt>
			<dd>{severities.info} / {severities.warning} / {severities.error}</dd>
		</div>
	</dl>

	<div class="unavailable">
		<h3>Not recorded</h3>
		<ul>
			<li>Calculation duration</li>
			<li>Validation duration</li>
			<li>Renderer frame time / FPS</li>
			<li>Lookahead / horizon performance</li>
		</ul>
	</div>
</section>

<style>
	.metrics {
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

	dl {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
	}

	dt {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
	}

	dt span {
		display: block;
		margin-top: var(--space-1);
		color: var(--color-accent);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
	}

	dd {
		margin: var(--space-1) 0 0;
		color: var(--color-text);
		font-family: var(--font-mono);
	}

	.unavailable {
		padding: var(--space-4) var(--space-5);
		border-top: 1px solid var(--color-border);
	}

	ul {
		display: grid;
		gap: var(--space-2);
		padding: 0;
		margin: var(--space-3) 0 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		list-style: none;
	}

	li::before {
		margin-right: var(--space-2);
		color: var(--color-text-muted);
		content: '—';
	}

	@media (max-width: 1099px) and (min-width: 720px) {
		dl {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		.unavailable ul {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
