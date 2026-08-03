import { RunFixtureError } from '$lib/simulation/serialization/run-record';
import { parseSimulationRunFixture } from '$lib/simulation/serialization/run-record';
import {
	parseSimulationInputFixture,
	serializeSimulationInputFixture
} from '$lib/simulation/serialization/simulation-input';
import {
	createDiagnosticExport,
	serializeDiagnosticExport
} from '$lib/simulation/serialization/diagnostic-export';
import type { SimulationInput, SimulationRunRecord } from '$lib/simulation/contracts';
import type { RunValidationResult } from '$lib/simulation/verification';
import {
	createDiagnosticExportFilename,
	type RepositoryRunFixture,
	type RunSource
} from '../model';

export function downloadJsonFile(filename: string, contents: string): void {
	const blob = new Blob([contents], { type: 'application/json' });
	const objectUrl = URL.createObjectURL(blob);
	try {
		const link = document.createElement('a');
		link.href = objectUrl;
		link.download = filename;
		link.click();
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

export function formatRunFixtureLoadError(error: unknown): string {
	return error instanceof RunFixtureError
		? `${error.code} · ${error.message}${error.path ? ` · ${error.path}` : ''}`
		: `FILE_READ_ERROR · ${error instanceof Error ? error.message : 'Could not read file.'}`;
}

export function parseRepositoryRun(fixture: RepositoryRunFixture): SimulationRunRecord {
	return parseSimulationRunFixture(fixture.json);
}

export async function parseLocalRun(file: File): Promise<SimulationRunRecord> {
	return parseSimulationRunFixture(await file.text());
}

export async function parseLocalSimulationInput(file: File): Promise<SimulationInput> {
	return parseSimulationInputFixture(await file.text());
}

export function downloadSimulationInput(input: SimulationInput, scenarioId: string | null): string {
	const filename = `${scenarioId ?? 'custom-scenario'}-input.json`;
	downloadJsonFile(filename, serializeSimulationInputFixture(input));
	return filename;
}

export function downloadRunDiagnostics(
	run: SimulationRunRecord,
	source: RunSource,
	scenarioId: string | null,
	validation: RunValidationResult,
	exportedAt = new Date().toISOString()
): string {
	const bundle = createDiagnosticExport(
		run,
		{
			exportedAt,
			runId: source.kind === 'repository' ? source.id : null,
			scenarioId,
			descriptiveName: source.name,
			source:
				source.kind === 'repository'
					? { kind: 'repository', id: source.id, name: source.name }
					: source.kind === 'local'
						? { kind: 'local', name: source.name }
						: source
		},
		validation
	);
	const filename = createDiagnosticExportFilename(source.name, exportedAt);
	downloadJsonFile(filename, serializeDiagnosticExport(bundle));
	return filename;
}
