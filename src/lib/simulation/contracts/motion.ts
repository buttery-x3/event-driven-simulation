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

export type MotionSegment =
	| FreeFlightMotionSegment
	| LinearContactMotionSegment
	| CircularContactMotionSegment
	| StationaryMotionSegment;

export type ConstantAccelerationMotionSegment =
	FreeFlightMotionSegment | LinearContactMotionSegment;

export interface BodyTrajectory {
	readonly bodyId: EntityId;
	readonly segments: readonly MotionSegment[];
}
