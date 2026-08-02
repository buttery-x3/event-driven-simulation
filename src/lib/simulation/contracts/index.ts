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
	readonly surfaceRole?: 'supporting-flat';
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

export interface NarrowSettlementPolicy {
	readonly maximumNormalSeparationSpeed: number;
	readonly maximumTangentialSpeed: number;
	readonly contactDistance: number;
	readonly minimumPressingAcceleration: number;
}

export interface SimulationSettings {
	readonly gravity: Vec2;
	readonly restitution: number;
	readonly maximumEvents: number;
	readonly maximumSimulationTime: number;
	readonly tolerances: SimulationTolerances;
	readonly settlement?: NarrowSettlementPolicy;
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

export type RunValidity = 'valid' | 'invalid';

export type RunOutcome =
	| 'exited'
	| 'escaped'
	| 'settled'
	| 'no-future-event'
	| 'time-limit'
	| 'event-limit'
	| 'unresolved'
	| 'invalid';

export type RunTerminalReason =
	| {
			readonly type: 'completion-region';
			readonly regionId: EntityId;
			readonly time: number;
	  }
	| {
			readonly type: 'escape-region';
			readonly regionId: EntityId;
			readonly time: number;
	  }
	| {
			readonly type: 'bounds-escape';
			readonly boundary: 'left' | 'right' | 'bottom' | 'top';
			readonly time: number;
	  }
	| { readonly type: 'no-future-event'; readonly time: number; readonly detail: string }
	| {
			readonly type: 'time-limit';
			readonly time: number;
			readonly limit: number;
	  }
	| {
			readonly type: 'event-limit';
			readonly time: number;
			readonly limit: number;
	  }
	| {
			readonly type: 'settled-supporting-surface';
			readonly time: number;
			readonly colliderId: EntityId;
			readonly position: Vec2;
			readonly normalSeparationSpeed: number;
			readonly tangentialSpeed: number;
	  }
	| {
			readonly type: 'unresolved-collision-search';
			readonly time: number;
			readonly detail: string;
	  }
	| {
			readonly type: 'zero-time-loop';
			readonly time: number;
			readonly colliderId: EntityId;
			readonly detail: string;
	  }
	| {
			readonly type: 'invalid-state';
			readonly time: number | null;
			readonly detail: string;
	  }
	| {
			readonly type: 'numerical-failure';
			readonly time: number;
			readonly detail: string;
	  };

export interface DiagnosticEntry {
	readonly severity: 'info' | 'warning' | 'error';
	readonly code: string;
	readonly message: string;
	readonly time: number | null;
	readonly bodyId: EntityId | null;
}

export interface RunContactCandidateDiagnostic {
	readonly colliderId: EntityId;
	readonly feature: string;
	readonly time: number;
	readonly classification: string;
	readonly timeDelta?: number;
	readonly position?: Vec2;
	readonly contactPoint?: Vec2;
	readonly normal?: Vec2;
	readonly normalVelocity?: number;
	readonly preContactVelocity?: Vec2;
	readonly postContactVelocity?: Vec2;
	readonly nearSimultaneous?: boolean;
}

export interface RunContactSearchDiagnostic {
	readonly searchInterval: readonly [startTime: number, endTime: number];
	readonly eventTimeTolerance?: number;
	readonly outcome: 'contact' | 'no-event' | 'unresolved' | 'invalid-input';
	readonly reason: string | null;
	readonly selectedColliderId: EntityId | null;
	readonly candidates: readonly RunContactCandidateDiagnostic[];
}

export interface RunDiagnostics {
	readonly iterations: number;
	readonly simulatedUntilTime: number;
	readonly eventCount: number;
	readonly candidateCount: number;
	readonly segmentCount: number;
	readonly simulationWallTimeMilliseconds: number;
	readonly contactSearches: readonly RunContactSearchDiagnostic[];
	readonly entries: readonly DiagnosticEntry[];
}

export interface SimulationRunRecord {
	readonly contractVersion: 5;
	readonly input: SimulationInput;
	readonly validity: RunValidity;
	readonly outcome: RunOutcome;
	readonly terminalReason: RunTerminalReason;
	readonly trajectories: readonly BodyTrajectory[];
	readonly events: readonly PhysicalEvent[];
	readonly diagnostics: RunDiagnostics;
}

export interface RendererPlaybackInput {
	readonly contractVersion: 5;
	readonly scene: SceneDefinition;
	readonly initialDynamicBodies: readonly InitialDynamicCircleBodyState[];
	readonly validity: RunValidity;
	readonly outcome: RunOutcome;
	readonly terminalReason: RunTerminalReason;
	readonly playableUntilTime: number;
	readonly trajectories: readonly BodyTrajectory[];
	readonly events: readonly PhysicalEvent[];
	readonly diagnostics: RunDiagnostics;
}
