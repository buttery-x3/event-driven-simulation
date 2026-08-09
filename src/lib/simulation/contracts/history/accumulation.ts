import type { EntityId, Vec2 } from '../geometry';

export interface AccumulationBodyState {
	readonly bodyId: EntityId;
	readonly position: Vec2;
	readonly velocity: Vec2;
}

export type AccumulationLimitContact =
	| {
			readonly id: string;
			readonly type: 'body-fixed';
			readonly bodyId: EntityId;
			readonly colliderId: EntityId;
			readonly feature: string;
			readonly contactPoint: Vec2;
			readonly normal: Vec2;
			readonly separation: number;
	  }
	| {
			readonly id: string;
			readonly type: 'body-body';
			readonly firstBodyId: EntityId;
			readonly secondBodyId: EntityId;
			readonly contactPoint: Vec2;
			readonly normalFromFirstToSecond: Vec2;
			readonly separation: number;
	  };

export interface AccumulationConnectedComponent {
	readonly id: string;
	readonly bodyIds: readonly EntityId[];
	readonly fixedColliderIds: readonly EntityId[];
	readonly contactIds: readonly string[];
}

export interface AccumulationTemporalResiduals {
	readonly sourceEventTimes: readonly number[];
	readonly positiveIntervals: readonly number[];
	readonly contractionRatios: readonly number[];
	readonly certifiedRatioUpperBound: number;
	readonly latestInterval: number;
	readonly geometricTailEstimate: number;
	readonly eventTimeResolution: number;
}

export interface AccumulationStateResidual {
	readonly bodyId: EntityId;
	readonly currentToLimitPositionDistance: number;
	readonly positionTailUpperBound: number;
	readonly positionResolution: number;
	readonly currentToLimitVelocityDistance: number;
	readonly velocityTailUpperBound: number;
	readonly velocityResolution: number;
}

export interface AccumulationGeometricResidual {
	readonly contactId: string;
	readonly separation: number;
	readonly activeAtLimit: boolean;
}

export interface AccumulationPenetrationEvidence {
	readonly maximumPenetration: number;
	readonly contactDistanceTolerance: number;
	readonly testedPairCount: number;
}

export interface AccumulationLimit {
	readonly id: string;
	readonly sourceEventIds: readonly string[];
	readonly participantBodyIds: readonly EntityId[];
	readonly candidateFixedColliderIds: readonly EntityId[];
	readonly currentCertifiedTime: number;
	readonly candidateLimitTime: number;
	readonly remainingTimeUpperBound: number;
	readonly limitingBodyStates: readonly AccumulationBodyState[];
	readonly activeLimitContacts: readonly AccumulationLimitContact[];
	readonly connectedComponents: readonly AccumulationConnectedComponent[];
	readonly temporalResiduals: AccumulationTemporalResiduals;
	readonly stateResiduals: readonly AccumulationStateResidual[];
	readonly geometricResiduals: readonly AccumulationGeometricResidual[];
	readonly penetrationEvidence: AccumulationPenetrationEvidence;
	readonly certificationMethod: 'monotone-geometric-interval-envelope';
	readonly acquisitionTime: 'current-certified-time' | 'mathematical-limit';
}

export interface AccumulationDiagnostic {
	readonly limit: AccumulationLimit | null;
	readonly sourceEventIds: readonly string[];
	readonly participantBodyIds: readonly EntityId[];
	readonly candidateFixedColliderIds: readonly EntityId[];
	readonly status: 'certified' | 'rejected';
	readonly reason: string;
	readonly downstreamImpactComponentIds: readonly string[];
	readonly downstreamSupportComponentIds: readonly string[];
	readonly finalClassification:
		'pending' | 'separation' | 'release' | 'rest' | 'sustained' | 'unresolved';
	readonly mechanism: 'general-accumulation';
}
