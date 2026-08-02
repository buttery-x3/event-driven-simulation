import type {
	BodyTrajectory,
	PhysicalEvent,
	RunDiagnostics,
	RunOutcome,
	RunTerminalReason,
	RunValidity,
	SimulationInput,
	SimulationRunRecord
} from '../../contracts';

export type DiagnosticExportSource =
	| { readonly kind: 'repository'; readonly id: string; readonly name: string }
	| { readonly kind: 'local'; readonly name: string }
	| { readonly kind: 'simulation'; readonly name: string };

export interface DiagnosticExportMetadata {
	readonly exportedAt: string;
	readonly runId?: string | null;
	readonly scenarioId?: string | null;
	readonly descriptiveName?: string | null;
	readonly source?: DiagnosticExportSource | null;
	readonly applicationVersion?: string | null;
	readonly repositoryRevision?: string | null;
}

export interface DiagnosticExportCounts {
	readonly bodies: number;
	readonly colliders: number;
	readonly trajectories: number;
	readonly trajectorySegments: number;
	readonly events: number;
	readonly contactSearches: number;
	readonly contactCandidates: number;
	readonly diagnostics: number;
}

export interface DiagnosticExportRunSummary {
	readonly validity: RunValidity;
	readonly authoritativeValidity: RunValidity;
	readonly independentValidationPassed: boolean;
	readonly outcome: RunOutcome;
	readonly terminalReason: RunTerminalReason;
	readonly simulatedUntilTime: number;
	readonly playableUntilTime: number;
	readonly counts: DiagnosticExportCounts;
	readonly runLimits: Pick<SimulationInput['settings'], 'maximumEvents' | 'maximumSimulationTime'>;
	readonly numericalPolicy: Pick<
		SimulationInput['settings'],
		'gravity' | 'restitution' | 'tolerances'
	>;
	readonly validPrefix: {
		readonly untilTime: number;
		readonly trajectorySegmentCount: number;
		readonly eventCount: number;
	};
}

export interface DiagnosticExportIndependentValidation {
	readonly valid: boolean;
	readonly checkedCategories: readonly string[];
	readonly failures: readonly {
		readonly category: string;
		readonly code: string;
		readonly message: string;
		readonly reference: {
			readonly path: string;
			readonly time?: number;
			readonly bodyId?: string;
			readonly colliderId?: string;
		};
	}[];
}

export interface DiagnosticExportV1 {
	readonly kind: 'simulation-diagnostic-export';
	readonly schemaVersion: 1;
	readonly provenance: {
		readonly exportedAt: string;
		readonly runId: string | null;
		readonly scenarioId: string | null;
		readonly descriptiveName: string | null;
		readonly sceneId: string;
		readonly source: DiagnosticExportSource | null;
		readonly applicationVersion: string | null;
		readonly repositoryRevision: string | null;
	};
	readonly submittedInput: SimulationInput;
	readonly summary: DiagnosticExportRunSummary;
	readonly authoritativeRun: {
		readonly contractVersion: SimulationRunRecord['contractVersion'];
		readonly validity: RunValidity;
		readonly outcome: RunOutcome;
		readonly terminalReason: RunTerminalReason;
		readonly trajectories: readonly BodyTrajectory[];
		readonly events: readonly PhysicalEvent[];
	};
	readonly independentValidation: DiagnosticExportIndependentValidation;
	readonly diagnostics: RunDiagnostics;
}
