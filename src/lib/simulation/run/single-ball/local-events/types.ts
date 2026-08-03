import type {
	BodyEventHorizonDiagnostic,
	DiagnosticEntry,
	FreeFlightMotionSegment,
	InitialDynamicCircleBodyState,
	MotionSegment,
	PhysicalEvent,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	SimulationInput
} from '../../../contracts';
import type { FixedWorldContactQueryResult } from '../../../collision';
import type { ImpactNextState, ImpactObservation } from '../impact';

export interface PreparedLocalContinuation {
	readonly segments: MotionSegment[];
	readonly events: PhysicalEvent[];
	readonly contactSearches: RunContactSearchDiagnostic[];
	readonly entries: DiagnosticEntry[];
	readonly finalState: ImpactNextState | null;
	readonly terminalReason: RunTerminalReason | null;
	readonly finalTime: number;
}

export interface LocalBodyRuntime {
	readonly input: SimulationInput;
	readonly body: InitialDynamicCircleBodyState;
	revision: number;
	committedTime: number;
	state: ImpactNextState;
	terminalReason: RunTerminalReason | null;
	prepared: PreparedLocalContinuation | null;
	readonly segments: MotionSegment[];
	readonly events: PhysicalEvent[];
	readonly contactSearches: RunContactSearchDiagnostic[];
	readonly entries: DiagnosticEntry[];
	readonly impactHistory: ImpactObservation[];
}

interface PredictionBase {
	readonly bodyId: string;
	readonly revision: number;
	readonly time: number;
	readonly eventType: BodyEventHorizonDiagnostic['eventType'];
}

export type LocalBodyPrediction =
	| (PredictionBase & {
			readonly kind: 'contact';
			readonly path: FreeFlightMotionSegment | null;
			readonly result: Extract<FixedWorldContactQueryResult, { readonly type: 'contact' }>;
			readonly search: RunContactSearchDiagnostic | null;
	  })
	| (PredictionBase & {
			readonly kind: 'terminal';
			readonly reason: RunTerminalReason;
			readonly path: MotionSegment | null;
			readonly search: RunContactSearchDiagnostic | null;
	  })
	| (PredictionBase & { readonly kind: 'prepared' });
