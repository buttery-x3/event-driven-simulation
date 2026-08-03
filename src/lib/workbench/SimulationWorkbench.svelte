<script lang="ts">
	import './simulation-workbench.css';
	import { onMount } from 'svelte';
	import {
		getPlaybackFrame,
		PlaybackClock,
		toRendererPlaybackInput
	} from '$lib/rendering/playback';
	import type { SimulationInput, SimulationRunRecord } from '$lib/simulation/contracts';
	import { RunFixtureError } from '$lib/simulation/serialization/run-record';
	import { constructSingleBallRun } from '$lib/simulation/run';
	import { validateSimulationRun, type RunValidationResult } from '$lib/simulation/verification';
	import ApplicationBar from './ApplicationBar.svelte';
	import ScenarioCatalogue from './ScenarioCatalogue.svelte';
	import { EvidenceWorkspace, ReplayWorkspace } from './layout';
	import {
		downloadRunDiagnostics,
		downloadSimulationInput,
		parseLocalRun,
		parseLocalSimulationInput,
		parseRepositoryRun
	} from './io';
	import {
		getInspectionMode,
		requireInitialRepositoryFixture,
		toRunValidationDiagnosticEntries,
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
	import { startPlaybackAnimationLoop } from './session';

	let { fixtures }: { fixtures: readonly RepositoryRunFixture[] } = $props();

	const initialFixture = (() => requireInitialRepositoryFixture(fixtures))();

	const initialRun = parseRepositoryRun(initialFixture);
	let currentRun = $state.raw<SimulationRunRecord>(initialRun);
	let currentValidation = $state.raw<RunValidationResult>(
		validateSimulationRun(initialRun.input, initialRun)
	);
	let currentSource = $state.raw<RunSource>({
		kind: 'repository',
		id: initialFixture.id,
		name: initialFixture.name,
		evidenceKind: initialFixture.evidenceKind
	});
	let loadFeedback = $state.raw<LoadFeedback | null>(null);
	let selectedScenarioId = $state<string | null>(defaultWorkbenchScenario.id);
	let draftBaseInput = $state.raw<SimulationInput>(defaultWorkbenchScenario.input);
	let inputDraft = $state.raw<SimulationInputDraft>(
		createSimulationInputDraft(defaultWorkbenchScenario.input)
	);
	let inputErrors = $state.raw<readonly SimulationInputValidationError[]>([]);
	let inputFeedback = $state<string | null>(null);
	let exportFeedback = $state.raw<{
		readonly kind: 'success' | 'error';
		readonly message: string;
	} | null>(null);
	let submittedInput = $state.raw<SimulationInput | null>(null);
	let actualScenarioId = $state<string | null>(null);
	let playback = $derived(toRendererPlaybackInput(currentRun));
	let inspectionMode = $derived(
		getInspectionMode(currentRun.validity, currentRun.outcome, currentValidation.valid)
	);
	let presentedDiagnosticEntries = $derived([
		...currentRun.diagnostics.entries,
		...toRunValidationDiagnosticEntries(currentValidation)
	]);
	let selectedBodyId = $state<string | null>(null);
	let filteredDiagnosticEntries = $derived(
		selectedBodyId === null
			? presentedDiagnosticEntries
			: presentedDiagnosticEntries.filter(
					(entry) => entry.bodyId === null || entry.bodyId === selectedBodyId
				)
	);
	let clock = new PlaybackClock(initialRun.diagnostics.simulatedUntilTime);
	let replayTime = $state(0);
	let replayFrame = $derived(getPlaybackFrame(playback, replayTime));
	let playing = $state(false);
	let selectedHistoryItemId = $state<string | null>(null);
	let transportState: 'playing' | 'paused' | 'ended' = $derived(
		playing
			? 'playing'
			: replayTime >= playback.playableUntilTime && playback.playableUntilTime > 0
				? 'ended'
				: 'paused'
	);

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

		selectedHistoryItemId = null;
		clock.restart();
		syncClock();
	}

	function seekPlayback(time: number): void {
		clock.pause();
		clock.seek(time);
		syncClock();
	}

	function selectHistoryItem(id: string, time: number): void {
		selectedHistoryItemId = id;
		seekPlayback(time);
	}

	function selectBody(bodyId: string | null): void {
		selectedBodyId = bodyId;
		selectedHistoryItemId = null;
	}

	function loadRunInputAsDraft(run: SimulationRunRecord, name: string): void {
		selectedScenarioId = null;
		draftBaseInput = run.input;
		inputDraft = createSimulationInputDraft(run.input);
		inputErrors = [];
		inputFeedback = `Loaded ${name} inputs for editing. Accepted replay history remains immutable.`;
	}

	function acceptRun(
		run: SimulationRunRecord,
		source: RunSource,
		scenarioId: string | null = null
	): void {
		currentRun = run;
		currentValidation = validateSimulationRun(run.input, run);
		currentSource = source;
		actualScenarioId = scenarioId;
		clock = new PlaybackClock(run.diagnostics.simulatedUntilTime);
		replayTime = 0;
		playing = false;
		selectedHistoryItemId = null;
		selectedBodyId = null;
		exportFeedback = null;
	}

	function selectScenario(scenarioId: string): void {
		const scenario = getWorkbenchScenario(scenarioId);
		if (!scenario) return;

		selectedScenarioId = scenario.id;
		draftBaseInput = scenario.input;
		inputDraft = createSimulationInputDraft(scenario.input);
		inputErrors = [];
		inputFeedback = `Draft reset to ${scenario.name}. Current run unchanged until Run.`;
		exportFeedback = null;
	}

	function changeInputDraft(nextDraft: SimulationInputDraft): void {
		inputDraft = nextDraft;
		inputErrors = [];
		inputFeedback = null;
		exportFeedback = null;
	}

	function runDraftScenario(): void {
		exportFeedback = null;
		const submission = prepareSimulationInputSubmission(draftBaseInput, inputDraft);
		if (!submission.valid) {
			inputErrors = submission.errors;
			inputFeedback = null;
			return;
		}
		if (submission.input.initialDynamicBodies.length !== 1) {
			inputErrors = [
				{
					field: 'scenario',
					code: 'PRODUCTION_MULTI_BODY_UNAVAILABLE',
					message:
						'Multi-body inputs can be saved and inspected with synthetic runs, but the production runner remains single-body.'
				}
			];
			return;
		}

		submittedInput = submission.input;
		const run = constructSingleBallRun(submission.input);
		const scenarioName = getWorkbenchScenario(selectedScenarioId)?.name ?? 'Loaded custom scenario';
		acceptRun(run, { kind: 'simulation', name: scenarioName }, selectedScenarioId);
		inputErrors = [];
		inputFeedback = `Run calculated · ${currentValidation.valid ? run.outcome : 'independently invalid'} · ${run.events.length} events · ${run.diagnostics.simulationWallTimeMilliseconds} ms wall time.`;
	}

	async function loadScenarioFile(file: File): Promise<void> {
		exportFeedback = null;
		try {
			const input = await parseLocalSimulationInput(file);
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
		exportFeedback = null;
		const submission = prepareSimulationInputSubmission(draftBaseInput, inputDraft);
		if (!submission.valid) {
			inputErrors = submission.errors;
			inputFeedback = null;
			return;
		}

		const filename = downloadSimulationInput(submission.input, selectedScenarioId);
		inputErrors = [];
		inputFeedback = `Saved ${filename}.`;
	}

	function exportDiagnostics(): void {
		try {
			const filename = downloadRunDiagnostics(
				currentRun,
				currentSource,
				actualScenarioId,
				currentValidation
			);
			inputFeedback = null;
			exportFeedback = { kind: 'success', message: `Exported ${filename}.` };
		} catch (error) {
			exportFeedback = {
				kind: 'error',
				message: `Could not export diagnostics: ${error instanceof Error ? error.message : 'serialisation or download failed'}. Current run retained.`
			};
		}
	}

	function selectRepositoryFixture(fixtureId: string): void {
		const fixture = fixtures.find(({ id }) => id === fixtureId);
		if (!fixture) return;

		try {
			const run = parseRepositoryRun(fixture);
			acceptRun(run, {
				kind: 'repository',
				id: fixture.id,
				name: fixture.name,
				evidenceKind: fixture.evidenceKind
			});
			loadRunInputAsDraft(run, fixture.name);
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
			const run = await parseLocalRun(file);
			acceptRun(run, { kind: 'local', name: file.name, evidenceKind: 'imported-run' });
			loadRunInputAsDraft(run, file.name);
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

	onMount(() =>
		startPlaybackAnimationLoop((elapsedSeconds) => {
			clock.advance(elapsedSeconds);
			syncClock();
		})
	);
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
		onResetDefault={() => selectScenario(defaultWorkbenchScenario.id)}
		onChangeDraft={changeInputDraft}
		onRun={runDraftScenario}
		onLoadScenario={loadScenarioFile}
		onSaveScenario={saveScenario}
		canRunProduction={inputDraft.bodies.length === 1}
		canExportDiagnostics={currentRun !== null}
		{exportFeedback}
		onExportDiagnostics={exportDiagnostics}
	/>

	<ReplayWorkspace
		{playback}
		run={currentRun}
		validation={currentValidation}
		source={currentSource}
		{replayTime}
		{playing}
		mode={inspectionMode}
		{transportState}
		{selectedBodyId}
		onToggle={togglePlayback}
		onRestart={restartPlayback}
		onSeek={seekPlayback}
	/>

	<EvidenceWorkspace
		run={currentRun}
		frame={replayFrame}
		entries={filteredDiagnosticEntries}
		{selectedBodyId}
		selectedItemId={selectedHistoryItemId}
		onSelectBody={selectBody}
		onSelectHistory={selectHistoryItem}
	/>
</main>
