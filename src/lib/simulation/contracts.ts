export type EntityId = string;

export type Vec2 = readonly [x: number, y: number];

export interface CirclePhysicalShape {
	readonly type: 'circle';
	readonly radius: number;
}

export interface LineSegmentPhysicalShape {
	readonly type: 'line-segment';
	readonly start: Vec2;
	readonly end: Vec2;
}

export interface StaticCircleCollider {
	readonly id: EntityId;
	readonly motionAuthority: 'static';
	readonly physicalShape: CirclePhysicalShape;
	readonly centre: Vec2;
}

export interface StaticLineSegmentCollider {
	readonly id: EntityId;
	readonly motionAuthority: 'static';
	readonly physicalShape: LineSegmentPhysicalShape;
}

export type StaticCollider = StaticCircleCollider | StaticLineSegmentCollider;

export interface BoardCoordinateSystem {
	readonly origin: 'centre-bottom';
	readonly horizontalAxis: 'right';
	readonly verticalAxis: 'up';
	readonly lengthUnit: 'metre';
}

export interface BoardBounds {
	readonly width: number;
	readonly height: number;
}

export interface AxisAlignedTerminationRegion {
	readonly id: EntityId;
	readonly type: 'axis-aligned-box';
	readonly purpose: 'complete' | 'escape';
	readonly minimum: Vec2;
	readonly maximum: Vec2;
}

export interface SceneDefinition {
	readonly id: string;
	readonly coordinateSystem: BoardCoordinateSystem;
	readonly bounds: BoardBounds;
	readonly staticColliders: readonly StaticCollider[];
	readonly terminationRegions: readonly AxisAlignedTerminationRegion[];
}

export interface InitialDynamicCircleBodyState {
	readonly id: EntityId;
	readonly motionAuthority: 'dynamic';
	readonly physicalShape: CirclePhysicalShape;
	readonly position: Vec2;
	readonly velocity: Vec2;
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
	readonly initialDynamicBodies: readonly InitialDynamicCircleBodyState[];
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
	readonly contractVersion: 3;
	readonly input: SimulationInput;
	readonly status: RunStatus;
	readonly trajectories: readonly BodyTrajectory[];
	readonly events: readonly PhysicalEvent[];
	readonly diagnostics: RunDiagnostics;
}

export interface RendererPlaybackInput {
	readonly contractVersion: 3;
	readonly scene: SceneDefinition;
	readonly initialDynamicBodies: readonly InitialDynamicCircleBodyState[];
	readonly status: RunStatus;
	readonly playableUntilTime: number;
	readonly trajectories: readonly BodyTrajectory[];
	readonly events: readonly PhysicalEvent[];
	readonly diagnostics: RunDiagnostics;
}
