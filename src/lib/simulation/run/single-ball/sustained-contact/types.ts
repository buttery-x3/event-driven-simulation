import type {
	ContactModeTransitionEvent,
	InitialDynamicCircleBodyState,
	MotionSegment,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	SimulationInput,
	Vec2
} from '../../../contracts';

export interface SustainedNextState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly releasedContactColliderId: string | null;
	readonly acceptInitialContact: boolean;
}

export interface SustainedContactResult {
	readonly segments: readonly MotionSegment[];
	readonly events: readonly ContactModeTransitionEvent[];
	readonly contactSearches: readonly RunContactSearchDiagnostic[];
	readonly terminalReason: RunTerminalReason | null;
	readonly nextState: SustainedNextState | null;
}

export interface SustainedContactRequest {
	readonly input: SimulationInput;
	readonly body: InitialDynamicCircleBodyState;
	readonly colliderId: string;
	readonly time: number;
	readonly position: Vec2;
	readonly normal: Vec2;
	readonly outgoingVelocity: Vec2;
	readonly entryFrom: 'free-flight' | 'impact';
	readonly entryReason: 'impact-collapse' | 'supported-initial-state';
}
