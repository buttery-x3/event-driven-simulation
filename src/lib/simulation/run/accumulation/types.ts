import type {
	AccumulationBodyState,
	AccumulationDiagnostic,
	AccumulationLimit,
	EntityId,
	Vec2
} from '../../contracts';

export interface AccumulationObservedBodyState extends AccumulationBodyState {
	readonly mass: number;
	readonly radius: number;
}

export type AccumulationObservedContact =
	| {
			readonly type: 'body-fixed';
			readonly bodyId: EntityId;
			readonly colliderId: EntityId;
			readonly feature: string;
			readonly normal: Vec2;
	  }
	| {
			readonly type: 'body-body';
			readonly firstBodyId: EntityId;
			readonly secondBodyId: EntityId;
			readonly normalFromFirstToSecond: Vec2;
	  };

export interface AccumulationObservation {
	readonly id: string;
	readonly time: number;
	readonly participantBodyIds: readonly EntityId[];
	readonly candidateFixedColliderIds: readonly EntityId[];
	readonly bodyStates: readonly AccumulationObservedBodyState[];
	readonly contacts: readonly AccumulationObservedContact[];
	readonly maximumRelativeNormalSpeed: number;
	readonly kind: 'physical-contact';
}

export type AccumulationCertificationResult =
	| {
			readonly type: 'certified';
			readonly limit: AccumulationLimit;
			readonly diagnostic: AccumulationDiagnostic;
	  }
	| {
			readonly type: 'rejected';
			readonly diagnostic: AccumulationDiagnostic;
	  };

export interface TemporalCertification {
	readonly eventTimes: readonly number[];
	readonly intervals: readonly number[];
	readonly ratios: readonly number[];
	readonly ratioUpperBound: number;
	readonly remainingTimeUpperBound: number;
	readonly estimatedRemainingTime: number;
	readonly candidateLimitTime: number;
}

export interface LimitBodyEstimate extends AccumulationObservedBodyState {
	readonly currentPosition: Vec2;
	readonly currentVelocity: Vec2;
	readonly positionTailUpperBound: number;
	readonly velocityTailUpperBound: number;
}
