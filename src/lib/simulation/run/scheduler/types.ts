import type {
	BodyEventHorizonDiagnostic,
	DynamicContactRecord,
	ComponentLifecycleEvent,
	ContactComponentRecord,
	ImpactSolveDiagnostic,
	InitialDynamicCircleBodyState,
	PairPredictionDiagnostic,
	ReleaseEvent,
	SimulationInput,
	WorldSchedulerStepDiagnostic
} from '../../contracts';
import type { LocalBodyPrediction, LocalBodyRuntime } from '../single-ball/local-events';

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
	readonly rejectedBodyIds: Set<string>;
}
