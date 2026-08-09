import type { EntityId, Vec2 } from './geometry';

export interface FreeFlightMotionSegment {
	readonly type: 'free-flight';
	readonly bodyId: EntityId;
	readonly startTime: number;
	readonly endTime: number;
	readonly startPosition: Vec2;
	readonly startVelocity: Vec2;
	readonly acceleration: Vec2;
}

export interface LinearContactMotionSegment {
	readonly type: 'linear-contact';
	readonly bodyId: EntityId;
	readonly startTime: number;
	readonly endTime: number;
	readonly startPosition: Vec2;
	readonly startVelocity: Vec2;
	readonly acceleration: Vec2;
	readonly supportingColliderId: EntityId;
	readonly contactNormal: Vec2;
}

export interface CircularContactMotionSegment {
	readonly type: 'circular-contact';
	readonly bodyId: EntityId;
	readonly startTime: number;
	readonly endTime: number;
	readonly startPosition: Vec2;
	readonly startVelocity: Vec2;
	readonly supportingColliderId: EntityId;
	/** Present when the circular boundary is supplied by a certified stationary dynamic body. */
	readonly supportingBodyId?: EntityId;
	/** Identifies the anchored component that certifies a dynamic supporting body as stationary. */
	readonly supportingComponentId?: string;
	readonly centre: Vec2;
	readonly contactRadius: number;
	readonly startAngle: number;
	readonly endAngle: number;
	readonly direction: -1 | 1;
	readonly startTangentialSpeed: number;
	readonly gravity: Vec2;
}

export interface StationaryMotionSegment {
	readonly type: 'stationary';
	readonly bodyId: EntityId;
	readonly startTime: number;
	readonly endTime: number;
	readonly startPosition: Vec2;
	readonly startVelocity: readonly [0, 0];
	readonly reason: 'resting-contact' | 'dormant-component';
	readonly componentId: string | null;
}

/**
 * A certified continuous summary of an unresolved contracting event tail. It is not a timestep or
 * impact law: the source physical events and finite state/time enclosure live in the referenced
 * accumulation diagnostic.
 */
export interface AccumulationTailMotionSegment {
	readonly type: 'accumulation-tail';
	readonly bodyId: EntityId;
	readonly startTime: number;
	readonly endTime: number;
	readonly startPosition: Vec2;
	readonly startVelocity: Vec2;
	readonly endPosition: Vec2;
	readonly endVelocity: Vec2;
	readonly accumulationLimitId: string;
	readonly positionTailUpperBound: number;
	readonly velocityTailUpperBound: number;
}

export type MotionSegment =
	| FreeFlightMotionSegment
	| LinearContactMotionSegment
	| CircularContactMotionSegment
	| StationaryMotionSegment
	| AccumulationTailMotionSegment;

export type ConstantAccelerationMotionSegment =
	FreeFlightMotionSegment | LinearContactMotionSegment;

export interface BodyTrajectory {
	readonly bodyId: EntityId;
	readonly segments: readonly MotionSegment[];
}
