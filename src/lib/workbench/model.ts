import type { RunStatus, SimulationRunRecord, Vec2 } from '$lib/simulation/contracts';

export interface RepositoryRunFixture {
	readonly id: string;
	readonly name: string;
	readonly json: string;
}

export type RunSource =
	| { readonly kind: 'repository'; readonly id: string; readonly name: string }
	| { readonly kind: 'local'; readonly name: string };

export type LoadFeedback =
	| { readonly kind: 'reading'; readonly message: string }
	| { readonly kind: 'success'; readonly message: string }
	| { readonly kind: 'error'; readonly message: string };

export type InspectionMode = 'completed-replay' | 'recorded-prefix' | 'diagnostics-only';

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

export function getInspectionMode(status: RunStatus): InspectionMode {
	switch (status.type) {
		case 'complete':
			return 'completed-replay';
		case 'unresolved':
		case 'iteration-limited':
			return 'recorded-prefix';
		case 'invalid':
			return 'diagnostics-only';
	}
}

export function getInspectionModeLabel(mode: InspectionMode): string {
	switch (mode) {
		case 'completed-replay':
			return 'Calculated run replay';
		case 'recorded-prefix':
			return 'Recorded-prefix inspection';
		case 'diagnostics-only':
			return 'Diagnostics only';
	}
}

export function getRunStatusLabel(status: RunStatus): string {
	switch (status.type) {
		case 'complete':
			return 'Complete';
		case 'unresolved':
			return 'Unresolved';
		case 'iteration-limited':
			return 'Iteration limit reached';
		case 'invalid':
			return 'Invalid run';
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
	return `${source.kind === 'repository' ? 'Repository fixture' : 'Local file'} · ${source.name}`;
}
