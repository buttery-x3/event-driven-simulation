import type { EntityId, Vec2 } from '../../contracts';
import type { FixedWorldContactCandidate } from '../../collision';

/**
 * One positive-time physical event observation used for accumulation certification.
 * Solver-internal reflection iterations must never appear here.
 */
export interface AccumulationPhysicalEvent {
	readonly eventId: string;
	readonly time: number;
	readonly participantBodyIds: readonly EntityId[];
	readonly fixedColliderIds: readonly EntityId[];
	readonly dynamicPartnerBodyIds: readonly EntityId[];
	readonly contactEdgeKeys: readonly string[];
	readonly bodyStates: readonly AccumulationBodyState[];
	readonly maxRelativeNormalSpeed: number;
}

export interface AccumulationBodyState {
	readonly bodyId: EntityId;
	readonly mass: number;
	readonly radius: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
}

export type AccumulationCertificationMethod =
	'geometric-interval-contraction' | 'monotone-analytic-envelope' | 'conservative-interval-sum';

export interface AccumulationTemporalCertificate {
	readonly method: AccumulationCertificationMethod;
	readonly sourceEventIds: readonly string[];
	readonly eventTimes: readonly number[];
	readonly intervals: readonly number[];
	readonly contractionRatios: readonly number[];
	readonly currentCertifiedTime: number;
	readonly candidateLimitTime: number;
	readonly remainingTimeUpperBound: number;
	readonly contractionRatioBound: number;
}

export interface AccumulationLimitContact {
	readonly id: string;
	readonly type: 'body-fixed' | 'body-body';
	readonly bodyId: EntityId;
	readonly secondBodyId: EntityId | null;
	readonly colliderId: EntityId | null;
	readonly contactPoint: Vec2;
	readonly normal: Vec2;
	readonly separation: number;
	readonly feature: string;
	readonly retainedFromHistory: boolean;
	readonly addedAtLimit: boolean;
}

export interface AccumulationConnectedComponent {
	readonly id: string;
	readonly bodyIds: readonly EntityId[];
	readonly contactIds: readonly string[];
	readonly fixedColliderIds: readonly EntityId[];
}

/**
 * Certified accumulation limit: what was certified, not how it is classified physically.
 */
export interface AccumulationLimit {
	readonly sourceEventIds: readonly string[];
	readonly participantBodyIds: readonly EntityId[];
	readonly candidateFixedColliderIds: readonly EntityId[];
	readonly currentCertifiedTime: number;
	readonly candidateLimitTime: number;
	readonly remainingTimeUpperBound: number;
	readonly limitingBodyStates: readonly AccumulationBodyState[];
	readonly activeLimitContacts: readonly AccumulationLimitContact[];
	readonly connectedComponents: readonly AccumulationConnectedComponent[];
	readonly temporalResiduals: {
		readonly currentToLimitTime: number;
		readonly remainingTimeUpperBound: number;
	};
	readonly stateResiduals: readonly {
		readonly bodyId: EntityId;
		readonly positionDistance: number;
		readonly velocityDistance: number;
	}[];
	readonly geometricResiduals: readonly {
		readonly contactId: string;
		readonly separation: number;
	}[];
	readonly penetrationEvidence: readonly {
		readonly bodyId: EntityId;
		readonly otherId: string;
		readonly separation: number;
	}[];
	readonly certificationMethod: AccumulationCertificationMethod;
	readonly temporal: AccumulationTemporalCertificate;
	readonly fixedCandidates: readonly FixedWorldContactCandidate[];
	readonly maxRelativeNormalSpeed: number;
	readonly path: 'general-accumulation';
}

export type AccumulationRejectionReason =
	| 'insufficient-events'
	| 'non-positive-intervals'
	| 'unstable-participant-cluster'
	| 'uncertifiable-temporal-tail'
	| 'uncertifiable-limit-geometry'
	| 'penetration-beyond-tolerance'
	| 'non-finite-limit-state'
	| 'empty-limit-contacts'
	| 'state-residual-exceeds-tolerance';

export type AccumulationCertificationResult =
	| { readonly type: 'certified'; readonly limit: AccumulationLimit }
	| {
			readonly type: 'rejected';
			readonly reason: AccumulationRejectionReason;
			readonly detail: string;
			readonly temporal: AccumulationTemporalCertificate | null;
	  };
