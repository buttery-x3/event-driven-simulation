export type EntityId = string;

export type Vec2 = readonly [x: number, y: number];

export interface FixedCircle {
	readonly id: EntityId;
	readonly centre: Vec2;
	readonly radius: number;
}

export interface SceneDefinition {
	readonly id: string;
	readonly fixedCircles: readonly FixedCircle[];
}

export interface InitialBodyState {
	readonly id: EntityId;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly radius: number;
}

export interface SimulationTolerances {
	readonly contactDistance: number;
	readonly eventTime: number;
}

export interface SimulationSettings {
	readonly gravity: Vec2;
	readonly restitution: number;
	readonly maximumEvents: number;
	readonly maximumSimulationTime: number;
	readonly tolerances: SimulationTolerances;
}

export interface SimulationInput {
	readonly scene: SceneDefinition;
	readonly initialBodies: readonly InitialBodyState[];
	readonly settings: SimulationSettings;
}

export interface MotionSegment {
	readonly bodyId: EntityId;
	readonly startTime: number;
	readonly endTime: number;
	readonly startPosition: Vec2;
	readonly startVelocity: Vec2;
	readonly acceleration: Vec2;
}

export interface BodyTrajectory {
	readonly bodyId: EntityId;
	readonly segments: readonly MotionSegment[];
}

export interface ContactEvent {
	readonly type: 'contact';
	readonly time: number;
	readonly bodyId: EntityId;
	readonly colliderId: EntityId;
	readonly position: Vec2;
	readonly normal: Vec2;
}

export type PhysicalEvent = ContactEvent;

export type RunStatus =
	| { readonly type: 'complete' }
	| { readonly type: 'unresolved'; readonly reason: string }
	| { readonly type: 'iteration-limited'; readonly reason: string }
	| { readonly type: 'invalid'; readonly reason: string };

export interface DiagnosticEntry {
	readonly severity: 'info' | 'warning' | 'error';
	readonly code: string;
	readonly message: string;
	readonly time: number | null;
	readonly bodyId: EntityId | null;
}

export interface RunDiagnostics {
	readonly iterations: number;
	readonly simulatedUntilTime: number;
	readonly entries: readonly DiagnosticEntry[];
}

export interface SimulationRunRecord {
	readonly contractVersion: 1;
	readonly input: SimulationInput;
	readonly status: RunStatus;
	readonly trajectories: readonly BodyTrajectory[];
	readonly events: readonly PhysicalEvent[];
	readonly diagnostics: RunDiagnostics;
}

export interface RendererPlaybackInput {
	readonly contractVersion: 1;
	readonly scene: SceneDefinition;
	readonly initialBodies: readonly InitialBodyState[];
	readonly status: RunStatus;
	readonly playableUntilTime: number;
	readonly trajectories: readonly BodyTrajectory[];
	readonly events: readonly PhysicalEvent[];
	readonly diagnostics: RunDiagnostics;
}
