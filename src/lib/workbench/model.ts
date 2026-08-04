import type {
	DiagnosticEntry,
	RunTerminalReason,
	RunOutcome,
	RunValidity,
	SimulationRunRecord,
	Vec2
} from '$lib/simulation/contracts';
import type { RunValidationResult } from '$lib/simulation/verification';

export interface RepositoryRunFixture {
	readonly id: string;
	readonly name: string;
	readonly json: string;
	readonly evidenceKind: 'production-run' | 'synthetic-contract' | 'saved-regression';
	readonly description?: string;
}

export function requireInitialRepositoryFixture(
	fixtures: readonly RepositoryRunFixture[]
): RepositoryRunFixture {
	const fixture = fixtures[0];
	if (!fixture) throw new Error('The workbench requires at least one repository fixture.');
	return fixture;
}

export type RunSource =
	| {
			readonly kind: 'repository';
			readonly id: string;
			readonly name: string;
			readonly evidenceKind: RepositoryRunFixture['evidenceKind'];
	  }
	| { readonly kind: 'local'; readonly name: string; readonly evidenceKind: 'imported-run' }
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
	readonly releases: number;
	readonly dynamicContacts: number;
	readonly contactComponents: number;
	readonly diagnostics: number;
}

export interface SeverityCounts {
	readonly info: number;
	readonly warning: number;
	readonly error: number;
}

export function getInspectionMode(
	validity: RunValidity,
	outcome: RunOutcome,
	independentValidationPassed = true
): InspectionMode {
	if (validity === 'invalid' || !independentValidationPassed) return 'invalid-prefix';
	return outcome === 'exited' || outcome === 'settled' ? 'completed-replay' : 'recorded-prefix';
}

export function toRunValidationDiagnosticEntries(
	validation: RunValidationResult
): readonly DiagnosticEntry[] {
	return validation.failures.map((failure) => ({
		severity: 'error',
		code: `RUN_VALIDATION_${failure.code}`,
		message: `${failure.category}: ${failure.message} (${failure.reference.path}${failure.reference.colliderId ? `, collider ${failure.reference.colliderId}` : ''})`,
		time: failure.reference.time ?? null,
		bodyId: failure.reference.bodyId ?? null
	}));
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
		case 'world-complete':
			return 'World complete';
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
		case 'unsupported-body-body-response':
			return 'Body contact reached (response unsupported)';
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
		releases: run.releases.length,
		dynamicContacts: run.dynamicContacts.length,
		contactComponents: run.contactComponents.length,
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
			? source.evidenceKind === 'synthetic-contract'
				? 'Synthetic contract fixture'
				: source.evidenceKind === 'saved-regression'
					? 'Saved regression fixture'
					: 'Production-generated run'
			: source.kind === 'local'
				? 'Imported diagnostic run'
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
