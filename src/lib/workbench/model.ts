import type {
	RunTerminalReason,
	RunOutcome,
	RunValidity,
	SimulationRunRecord,
	Vec2
} from '$lib/simulation/contracts';

export interface RepositoryRunFixture {
	readonly id: string;
	readonly name: string;
	readonly json: string;
}

export type RunSource =
	| { readonly kind: 'repository'; readonly id: string; readonly name: string }
	| { readonly kind: 'local'; readonly name: string }
	| { readonly kind: 'simulation'; readonly name: string };

export type LoadFeedback =
	| { readonly kind: 'reading'; readonly message: string }
	| { readonly kind: 'success'; readonly message: string }
	| { readonly kind: 'error'; readonly message: string };

export type InspectionMode = 'completed-replay' | 'recorded-prefix' | 'invalid-prefix';

export interface RunCounts {
	readonly bodies: number;
	readonly colliders: number;
	readonly trajectories: number;
	readonly segments: number;
	readonly events: number;
	readonly diagnostics: number;
}

export interface SeverityCounts {
	readonly info: number;
	readonly warning: number;
	readonly error: number;
}

export function getInspectionMode(validity: RunValidity, outcome: RunOutcome): InspectionMode {
	if (validity === 'invalid') return 'invalid-prefix';
	return outcome === 'exited' || outcome === 'settled' ? 'completed-replay' : 'recorded-prefix';
}

export function getInspectionModeLabel(mode: InspectionMode): string {
	switch (mode) {
		case 'completed-replay':
			return 'Calculated run replay';
		case 'recorded-prefix':
			return 'Recorded-prefix inspection';
		case 'invalid-prefix':
			return 'Invalid-prefix inspection';
	}
}

export function getRunStatusLabel(reason: RunTerminalReason): string {
	switch (reason.type) {
		case 'completion-region':
			return 'Exited';
		case 'escape-region':
			return 'Escaped';
		case 'bounds-escape':
			return 'Escaped bounds';
		case 'resting-contact':
			return 'Settled';
		case 'no-future-event':
			return 'No future event';
		case 'time-limit':
			return 'Time limit reached';
		case 'event-limit':
			return 'Event limit reached';
		case 'unresolved-collision-search':
			return 'Unresolved collision search';
		case 'zero-time-loop':
			return 'Zero-time loop';
		case 'invalid-state':
			return 'Invalid run';
		case 'numerical-failure':
			return 'Numerical failure';
	}
}

export function getRunCounts(run: SimulationRunRecord): RunCounts {
	return {
		bodies: run.input.initialDynamicBodies.length,
		colliders: run.input.scene.staticColliders.length,
		trajectories: run.trajectories.length,
		segments: run.trajectories.reduce((total, trajectory) => total + trajectory.segments.length, 0),
		events: run.events.length,
		diagnostics: run.diagnostics.entries.length
	};
}

export function getSeverityCounts(run: SimulationRunRecord): SeverityCounts {
	const counts = { info: 0, warning: 0, error: 0 };

	for (const entry of run.diagnostics.entries) {
		counts[entry.severity] += 1;
	}

	return counts;
}

export function formatReplaySeconds(value: number): string {
	return `${value.toFixed(3)} s`;
}

export function formatRecordedSeconds(value: number): string {
	return `${String(value)} s`;
}

export function formatVector(vector: Vec2): string {
	return `(${String(vector[0])}, ${String(vector[1])})`;
}

export function formatSource(source: RunSource): string {
	const label =
		source.kind === 'repository'
			? 'Repository fixture'
			: source.kind === 'local'
				? 'Local file'
				: 'Calculated scenario';
	return `${label} · ${source.name}`;
}

export function createDiagnosticExportFilename(name: string, exportedAt: string): string {
	const readableName = name
		.replace(/\.json$/i, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	const timestamp = exportedAt.replace(/[-:]/g, '').replace('.', '');
	return `${readableName || 'simulation-run'}-diagnostics-${timestamp}.json`;
}
