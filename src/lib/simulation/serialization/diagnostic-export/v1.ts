import type { SimulationRunRecord } from '../../contracts';
import type {
	DiagnosticExportMetadata,
	DiagnosticExportRunSummary,
	DiagnosticExportV1
} from './types';

export function createDiagnosticExport(
	run: SimulationRunRecord,
	metadata: DiagnosticExportMetadata
): DiagnosticExportV1 {
	const trajectorySegmentCount = run.trajectories.reduce(
		(total, trajectory) => total + trajectory.segments.length,
		0
	);
	const contactCandidateCount = run.diagnostics.contactSearches.reduce(
		(total, search) => total + search.candidates.length,
		0
	);
	const simulatedUntilTime = run.diagnostics.simulatedUntilTime;
	const summary: DiagnosticExportRunSummary = {
		validity: run.validity,
		outcome: run.outcome,
		terminalReason: run.terminalReason,
		simulatedUntilTime,
		playableUntilTime: simulatedUntilTime,
		counts: {
			bodies: run.input.initialDynamicBodies.length,
			colliders: run.input.scene.staticColliders.length,
			trajectories: run.trajectories.length,
			trajectorySegments: trajectorySegmentCount,
			events: run.events.length,
			contactSearches: run.diagnostics.contactSearches.length,
			contactCandidates: contactCandidateCount,
			diagnostics: run.diagnostics.entries.length
		},
		runLimits: {
			maximumEvents: run.input.settings.maximumEvents,
			maximumSimulationTime: run.input.settings.maximumSimulationTime
		},
		numericalPolicy: {
			gravity: run.input.settings.gravity,
			restitution: run.input.settings.restitution,
			tolerances: run.input.settings.tolerances
		},
		validPrefix: {
			untilTime: simulatedUntilTime,
			trajectorySegmentCount,
			eventCount: run.events.length
		}
	};

	return {
		kind: 'simulation-diagnostic-export',
		schemaVersion: 1,
		provenance: {
			exportedAt: metadata.exportedAt,
			runId: metadata.runId ?? null,
			scenarioId: metadata.scenarioId ?? null,
			descriptiveName: metadata.descriptiveName ?? null,
			sceneId: run.input.scene.id,
			source: metadata.source ?? null,
			applicationVersion: metadata.applicationVersion ?? null,
			repositoryRevision: metadata.repositoryRevision ?? null
		},
		submittedInput: run.input,
		summary,
		authoritativeRun: {
			contractVersion: run.contractVersion,
			trajectories: run.trajectories,
			events: run.events
		},
		diagnostics: run.diagnostics
	};
}

export function serializeDiagnosticExport(bundle: DiagnosticExportV1): string {
	return `${JSON.stringify(bundle, null, 2)}\n`;
}
