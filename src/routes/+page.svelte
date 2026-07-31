<script lang="ts">
	import canonicalFixtureJson from '../../fixtures/runs/canonical-synthetic-contact.json?raw';
	import SimulationWorkbench from '$lib/workbench/SimulationWorkbench.svelte';
	import type { RepositoryRunFixture } from '$lib/workbench/model';

	const repositoryFixtures = [
		{
			id: 'canonical-synthetic-contact',
			name: 'canonical-synthetic-contact.json',
			json: canonicalFixtureJson
		}
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
