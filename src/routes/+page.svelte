<script lang="ts">
	import canonicalFixtureJson from '../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
	import SimulationWorkbench from '$lib/workbench/SimulationWorkbench.svelte';
	import { syntheticMultiBodyFixtures } from '$lib/workbench/fixtures';
	import type { RepositoryRunFixture } from '$lib/workbench/model';

	const repositoryFixtures = [
		{
			id: 'canonical-event-driven-offset-drop',
			name: 'canonical-event-driven-offset-drop.json',
			json: canonicalFixtureJson,
			evidenceKind: 'production-run',
			description: 'Recorded output from the production single-body simulator.'
		},
		...syntheticMultiBodyFixtures.map((fixture) => ({
			id: fixture.id,
			name: fixture.name,
			json: JSON.stringify(fixture.run),
			evidenceKind: 'synthetic-contract' as const,
			description: fixture.description
		}))
	] as const satisfies readonly RepositoryRunFixture[];
</script>

<svelte:head>
	<title>Diagnostics Workbench | Event-Driven Simulation</title>
	<meta
		name="description"
		content="Load, replay and inspect calculated event-driven simulation runs."
	/>
</svelte:head>

<SimulationWorkbench fixtures={repositoryFixtures} />
