import type { SceneDefinition } from '../geometry';
import type { InitialDynamicCircleBodyState, SimulationInput } from '../input';
import type { BodyTrajectory } from '../motion';
import type { RunDiagnostics } from './diagnostics';
import type {
	ComponentLifecycleEvent,
	ContactComponentRecord,
	DynamicContactRecord,
	PhysicalEvent,
	ReleaseEvent
} from './events';
import type { BodyRunState, RunOutcome, RunTerminalReason, RunValidity } from './outcomes';

export interface SimulationRunRecord {
	readonly contractVersion: 7;
	readonly input: SimulationInput;
	readonly validity: RunValidity;
	readonly outcome: RunOutcome;
	readonly terminalReason: RunTerminalReason;
	readonly bodyStates: readonly BodyRunState[];
	readonly trajectories: readonly BodyTrajectory[];
	readonly events: readonly PhysicalEvent[];
	readonly releases: readonly ReleaseEvent[];
	readonly dynamicContacts: readonly DynamicContactRecord[];
	readonly contactComponents: readonly ContactComponentRecord[];
	readonly componentEvents: readonly ComponentLifecycleEvent[];
	readonly diagnostics: RunDiagnostics;
}

export interface RendererPlaybackInput {
	readonly contractVersion: 7;
	readonly scene: SceneDefinition;
	readonly initialDynamicBodies: readonly InitialDynamicCircleBodyState[];
	readonly validity: RunValidity;
	readonly outcome: RunOutcome;
	readonly terminalReason: RunTerminalReason;
	readonly playableUntilTime: number;
	readonly bodyStates: readonly BodyRunState[];
	readonly trajectories: readonly BodyTrajectory[];
	readonly events: readonly PhysicalEvent[];
	readonly releases: readonly ReleaseEvent[];
	readonly dynamicContacts: readonly DynamicContactRecord[];
	readonly contactComponents: readonly ContactComponentRecord[];
	readonly componentEvents: readonly ComponentLifecycleEvent[];
	readonly diagnostics: RunDiagnostics;
}
