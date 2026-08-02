<script lang="ts">
	import { onMount } from 'svelte';
	import { PlaybackClock, toRendererPlaybackInput } from '$lib/rendering/playback';
	import type { SimulationInput, SimulationRunRecord } from '$lib/simulation/contracts';
	import {
		parseSimulationRunFixture,
		RunFixtureError
	} from '$lib/simulation/serialization/run-record';
	import {
		parseSimulationInputFixture,
		serializeSimulationInputFixture
	} from '$lib/simulation/serialization/simulation-input';
	import { constructSingleBallRun } from '$lib/simulation/run';
	import ApplicationBar from './ApplicationBar.svelte';
	import DiagnosticsConsole from './DiagnosticsConsole.svelte';
	import EventTimeline from './EventTimeline.svelte';
	import MetricsPanel from './MetricsPanel.svelte';
	import PlaybackControls from './PlaybackControls.svelte';
	import RunInspector from './RunInspector.svelte';
	import ScenarioCatalogue from './ScenarioCatalogue.svelte';
	import SimulationViewport from './SimulationViewport.svelte';
	import {
		getInspectionMode,
		type LoadFeedback,
		type RepositoryRunFixture,
		type RunSource
	} from './model';
	import {
		createSimulationInputDraft,
		prepareSimulationInputSubmission,
		SimulationInputControls,
		type SimulationInputDraft,
		type SimulationInputValidationError
	} from './input';
	import {
		defaultWorkbenchScenario,
		getWorkbenchScenario,
		workbenchScenarios
	} from './scenario-catalogue';

	let { fixtures }: { fixtures: readonly RepositoryRunFixture[] } = $props();

	const initialFixture = getInitialFixture();
	if (!initialFixture) throw new Error('The workbench requires at least one repository fixture.');

	const initialRun = parseSimulationRunFixture(initialFixture.json);
	let currentRun = $state.raw<SimulationRunRecord>(initialRun);
	let currentSource = $state.raw<RunSource>({
		kind: 'repository',
		id: initialFixture.id,
		name: initialFixture.name
	});
	let loadFeedback = $state.raw<LoadFeedback | null>(null);
	let selectedScenarioId = $state<string | null>(defaultWorkbenchScenario.id);
	let draftBaseInput = $state.raw<SimulationInput>(defaultWorkbenchScenario.input);
	let inputDraft = $state.raw<SimulationInputDraft>(
		createSimulationInputDraft(defaultWorkbenchScenario.input)
	);
	let inputErrors = $state.raw<readonly SimulationInputValidationError[]>([]);
	let inputFeedback = $state<string | null>(null);
	let submittedInput = $state.raw<SimulationInput | null>(null);
	let actualScenarioId = $state<string | null>(null);
	let playback = $derived(toRendererPlaybackInput(currentRun));
	let inspectionMode = $derived(getInspectionMode(currentRun.validity, currentRun.outcome));
	let clock = new PlaybackClock(initialRun.diagnostics.simulatedUntilTime);
	let replayTime = $state(0);
	let playing = $state(false);
	let selectedEventIndex = $state<number | null>(null);
	let transportState: 'playing' | 'paused' | 'ended' = $derived(
		playing
			? 'playing'
			: replayTime >= playback.playableUntilTime && playback.playableUntilTime > 0
				? 'ended'
				: 'paused'
	);

	function getInitialFixture(): RepositoryRunFixture | undefined {
		return fixtures[0];
	}

	function syncClock(): void {
		replayTime = clock.time;
		playing = clock.playing;
	}

	function togglePlayback(): void {
		if (playback.playableUntilTime <= 0) return;

		if (clock.playing) clock.pause();
		else clock.play();
		syncClock();
	}

	function restartPlayback(): void {
		if (playback.playableUntilTime <= 0) return;

		selectedEventIndex = null;
		clock.restart();
		syncClock();
	}

	function seekPlayback(time: number): void {
		clock.pause();
		clock.seek(time);
		syncClock();
	}

	function selectEvent(index: number, time: number): void {
		selectedEventIndex = index;
		seekPlayback(time);
	}

	function acceptRun(
		run: SimulationRunRecord,
		source: RunSource,
		scenarioId: string | null = null
	): void {
		currentRun = run;
		currentSource = source;
		actualScenarioId = scenarioId;
		clock = new PlaybackClock(run.diagnostics.simulatedUntilTime);
		replayTime = 0;
		playing = false;
		selectedEventIndex = null;
	}

	function selectScenario(scenarioId: string): void {
		const scenario = getWorkbenchScenario(scenarioId);
		if (!scenario) return;

		selectedScenarioId = scenario.id;
		draftBaseInput = scenario.input;
		inputDraft = createSimulationInputDraft(scenario.input);
		inputErrors = [];
		inputFeedback = `Draft reset to ${scenario.name}. Current run unchanged until Run.`;
	}

	function resetCanonicalDefault(): void {
		selectScenario(defaultWorkbenchScenario.id);
	}

	function changeInputDraft(nextDraft: SimulationInputDraft): void {
		inputDraft = nextDraft;
		inputErrors = [];
		inputFeedback = null;
	}

	function runDraftScenario(): void {
		const submission = prepareSimulationInputSubmission(draftBaseInput, inputDraft);
		if (!submission.valid) {
			inputErrors = submission.errors;
			inputFeedback = null;
			return;
		}

		submittedInput = submission.input;
		const run = constructSingleBallRun(submission.input);
		const scenarioName = getWorkbenchScenario(selectedScenarioId)?.name ?? 'Loaded custom scenario';
		acceptRun(run, { kind: 'simulation', name: scenarioName }, selectedScenarioId);
		inputErrors = [];
		inputFeedback = `Run calculated · ${run.outcome} · ${run.events.length} events · ${run.diagnostics.simulationWallTimeMilliseconds} ms wall time.`;
	}

	async function loadScenarioFile(file: File): Promise<void> {
		try {
			const input = parseSimulationInputFixture(await file.text());
			selectedScenarioId = null;
			draftBaseInput = input;
			inputDraft = createSimulationInputDraft(input);
			inputErrors = [];
			inputFeedback = `Loaded ${file.name}. Current run unchanged until Run.`;
		} catch (error) {
			inputErrors = [
				{
					field: 'scenario',
					code: error instanceof RunFixtureError ? error.code : 'FILE_READ_ERROR',
					message:
						error instanceof Error ? error.message : 'Could not read the scenario input file.'
				}
			];
			inputFeedback = null;
		}
	}

	function saveScenario(): void {
		const submission = prepareSimulationInputSubmission(draftBaseInput, inputDraft);
		if (!submission.valid) {
			inputErrors = submission.errors;
			inputFeedback = null;
			return;
		}

		const blob = new Blob([serializeSimulationInputFixture(submission.input)], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${selectedScenarioId ?? 'custom-scenario'}-input.json`;
		link.click();
		URL.revokeObjectURL(url);
		inputErrors = [];
		inputFeedback = `Saved ${link.download}.`;
	}

	function selectRepositoryFixture(fixtureId: string): void {
		const fixture = fixtures.find(({ id }) => id === fixtureId);
		if (!fixture) return;

		try {
			const run = parseSimulationRunFixture(fixture.json);
			acceptRun(run, { kind: 'repository', id: fixture.id, name: fixture.name });
			loadFeedback = {
				kind: 'success',
				message: `Loaded ${fixture.name} · contract v${run.contractVersion}`
			};
		} catch (error) {
			rejectLoad(fixture.name, error);
		}
	}

	async function loadLocalFile(file: File): Promise<void> {
		loadFeedback = { kind: 'reading', message: `Reading ${file.name}…` };

		try {
			const run = parseSimulationRunFixture(await file.text());
			acceptRun(run, { kind: 'local', name: file.name });
			loadFeedback = {
				kind: 'success',
				message: `Loaded ${file.name} · contract v${run.contractVersion}`
			};
		} catch (error) {
			rejectLoad(file.name, error);
		}
	}

	function rejectLoad(candidateName: string, error: unknown): void {
		const detail =
			error instanceof RunFixtureError
				? `${error.code} · ${error.message}${error.path ? ` · ${error.path}` : ''}`
				: `FILE_READ_ERROR · ${error instanceof Error ? error.message : 'Could not read file.'}`;

		loadFeedback = {
			kind: 'error',
			message: `Could not load ${candidateName}: ${detail}. Current run retained.`
		};
	}

	onMount(() => {
		let previousTimestamp: number | null = null;
		let animationFrame = 0;

		const animate = (timestamp: number) => {
			const elapsedSeconds =
				previousTimestamp === null ? 0 : (timestamp - previousTimestamp) / 1_000;
			previousTimestamp = timestamp;
			clock.advance(elapsedSeconds);
			syncClock();
			animationFrame = requestAnimationFrame(animate);
		};

		animationFrame = requestAnimationFrame(animate);

		return () => cancelAnimationFrame(animationFrame);
	});
</script>

<main class="workbench" aria-label="Simulation diagnostics workbench">
	<ApplicationBar
		{fixtures}
		source={currentSource}
		feedback={loadFeedback}
		onSelectFixture={selectRepositoryFixture}
		onLoadFile={loadLocalFile}
	/>

	<ScenarioCatalogue
		scenarios={workbenchScenarios}
		{selectedScenarioId}
		customInput={draftBaseInput}
		{actualScenarioId}
		actualOutcome={actualScenarioId === null ? null : currentRun.outcome}
		onSelectScenario={selectScenario}
	/>

	<SimulationInputControls
		draft={inputDraft}
		errors={inputErrors}
		feedback={inputFeedback}
		lastSubmittedInput={submittedInput}
		onResetDefault={resetCanonicalDefault}
		onChangeDraft={changeInputDraft}
		onRun={runDraftScenario}
		onLoadScenario={loadScenarioFile}
		onSaveScenario={saveScenario}
	/>

	<div class="primary-workspace">
		<div class="replay-workspace">
			<SimulationViewport
				input={playback}
				time={replayTime}
				mode={inspectionMode}
				{transportState}
			/>
			<PlaybackControls
				time={replayTime}
				duration={playback.playableUntilTime}
				{playing}
				mode={inspectionMode}
				onToggle={togglePlayback}
				onRestart={restartPlayback}
				onSeek={seekPlayback}
			/>
		</div>

		<RunInspector
			run={currentRun}
			source={currentSource}
			playableUntilTime={playback.playableUntilTime}
		/>
	</div>

	<div class="evidence-grid">
		<EventTimeline
			events={currentRun.events}
			selectedIndex={selectedEventIndex}
			canSeek={true}
			onSelect={selectEvent}
		/>
		<DiagnosticsConsole entries={currentRun.diagnostics.entries} />
		<div class="metrics-slot">
			<MetricsPanel run={currentRun} />
		</div>
	</div>
</main>

<style>
	.workbench {
		display: grid;
		gap: var(--space-5);
		width: min(100% - 2rem, 100rem);
		margin: 0 auto;
		padding: var(--space-5) 0 var(--space-8);
	}

	.primary-workspace {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(18rem, 0.8fr);
		gap: var(--space-5);
		align-items: start;
	}

	.replay-workspace {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
	}

	.evidence-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) minmax(18rem, 1fr) minmax(15rem, 0.65fr);
		gap: var(--space-5);
		align-items: start;
	}

	.metrics-slot {
		min-width: 0;
	}

	@media (max-width: 1099px) {
		.primary-workspace {
			grid-template-columns: 1fr;
		}

		.evidence-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.metrics-slot {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 719px) {
		.workbench {
			gap: var(--space-4);
			width: min(100% - 1rem, 100rem);
			padding-top: var(--space-2);
		}

		.primary-workspace,
		.evidence-grid {
			grid-template-columns: 1fr;
			gap: var(--space-4);
		}

		.metrics-slot {
			grid-column: auto;
		}
	}
</style>
