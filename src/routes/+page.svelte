<script lang="ts">
	import canonicalFixtureJson from '../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
	import SimulationWorkbench from '$lib/workbench/SimulationWorkbench.svelte';
	import type { RepositoryRunFixture } from '$lib/workbench/model';

	const repositoryFixtures = [
		{
			id: 'canonical-event-driven-offset-drop',
			name: 'canonical-event-driven-offset-drop.json',
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
