import type {
	BodyEventHorizonDiagnostic,
	DynamicContactRecord,
	DynamicSupportDiagnostic,
	ComponentLifecycleEvent,
	ContactComponentRecord,
	ConstrainedImpactSolveDiagnostic,
	ImpactSolveDiagnostic,
	InitialDynamicCircleBodyState,
	PairPredictionDiagnostic,
	ReleaseEvent,
	SimulationInput,
	WorldSchedulerStepDiagnostic
} from '../../contracts';
import type { LocalBodyPrediction, LocalBodyRuntime } from '../single-ball/local-events';
import type { DynamicSupportPrediction, DynamicSupportRuntime } from './dynamic-support/types';

export interface SchedulerState {
	readonly input: SimulationInput;
	readonly wallTimeStart: number;
	worldTime: number;
	readonly scheduled: InitialDynamicCircleBodyState[];
	readonly runtimes: Map<string, LocalBodyRuntime>;
	readonly predictions: Map<string, LocalBodyPrediction>;
	readonly releases: ReleaseEvent[];
	readonly horizons: BodyEventHorizonDiagnostic[];
	readonly steps: WorldSchedulerStepDiagnostic[];
	readonly pairPredictions: PairPredictionDiagnostic[];
	readonly dynamicContacts: DynamicContactRecord[];
	readonly contactComponents: ContactComponentRecord[];
	readonly componentEvents: ComponentLifecycleEvent[];
	readonly impactSolves: ImpactSolveDiagnostic[];
	readonly constrainedImpactSolves: ConstrainedImpactSolveDiagnostic[];
	readonly dynamicSupports: Map<string, DynamicSupportRuntime>;
	readonly dynamicSupportPredictions: Map<string, DynamicSupportPrediction>;
	readonly dynamicSupportDiagnostics: DynamicSupportDiagnostic[];
	readonly releasedDynamicPairs: Set<string>;
	readonly rejectedBodyIds: Set<string>;
}
