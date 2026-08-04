import type { EntityId, Vec2 } from '../geometry';

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
	readonly activeInManifold?: boolean;
	readonly eventContactSetMember?: boolean;
	readonly positiveImpulseContributor?: boolean;
	readonly retainedSupportAfterImpact?: boolean;
	readonly releasedAfterImpact?: boolean;
	readonly impulse?: number;
	readonly postImpactNormalVelocity?: number;
}

export interface RunContactSearchDiagnostic {
	readonly bodyId?: EntityId;
	readonly searchInterval: readonly [startTime: number, endTime: number];
	readonly eventTimeTolerance?: number;
	readonly outcome: 'contact' | 'no-event' | 'unresolved' | 'invalid-input';
	readonly reason: string | null;
	readonly selectedColliderId: EntityId | null;
	readonly activeColliderIds?: readonly EntityId[];
	readonly preContactVelocity?: Vec2;
	readonly postContactVelocity?: Vec2;
	readonly candidates: readonly RunContactCandidateDiagnostic[];
}

export interface PredictionRevision {
	readonly bodyId: EntityId;
	readonly revision: number;
}

export type PredictionDecision = 'selected' | 'retained' | 'invalidated' | 'discarded-stale';

export interface BodyEventHorizonDiagnostic {
	readonly bodyId: EntityId;
	readonly interval: readonly [startTime: number, endTime: number];
	readonly revision: PredictionRevision;
	readonly eventType:
		| 'release'
		| 'fixed-contact'
		| 'body-contact'
		| 'motion-transition'
		| 'termination'
		| 'none'
		| 'unresolved';
	readonly decision?: PredictionDecision;
	readonly decisionWorldTime?: number;
	readonly reason?: string;
}

export interface WorldSchedulerStepDiagnostic {
	readonly worldTime: number;
	readonly bodyId: EntityId;
	readonly revision: number;
	readonly eventType: BodyEventHorizonDiagnostic['eventType'];
	readonly retainedBodyIds: readonly EntityId[];
}

export interface PairPredictionDiagnostic {
	readonly id: string;
	readonly bodyIds: readonly [EntityId, EntityId];
	readonly predictedTime: number | null;
	readonly validInterval: readonly [startTime: number, endTime: number];
	readonly revisions: readonly [PredictionRevision, PredictionRevision];
	readonly decision: PredictionDecision;
	readonly decisionWorldTime?: number;
	readonly reason: string;
	readonly retainedThroughWorldTimes?: readonly number[];
	readonly queryOutcome?: 'contact' | 'no-contact' | 'invalid-input' | 'unresolved' | 'unsupported';
	readonly pathTypes?: readonly [string, string];
	readonly localEventHorizons?: readonly [number, number];
	readonly normalizedIntervalScale?: number;
	readonly relativeCoefficients?: readonly [Vec2, Vec2, Vec2] | null;
	readonly polynomialCoefficients?: readonly number[];
	readonly normalizedPolynomialCoefficients?: readonly number[];
	readonly polynomialScale?: number | null;
	readonly polynomialDegree?: number | null;
	readonly isolatedRoots?: readonly number[];
	readonly candidateWorldTimes?: readonly number[];
	readonly candidates?: readonly {
		readonly normalizedTime: number;
		readonly time: number;
		readonly topology: string;
		readonly classification: string;
		readonly geometryResidual: number;
		readonly relativeNormalMotion: number | null;
	}[];
}

export interface ImpactReflectionDiagnostic {
	readonly iteration: number;
	readonly violatingContactIds: readonly string[];
	readonly impulse: readonly number[];
	readonly velocityBefore: readonly number[];
	readonly tentativeVelocity: readonly number[];
	readonly velocityAfter: readonly number[];
	readonly energyBefore: number;
	readonly energyAfterTentative: number;
	readonly energyAfterRenormalisation: number;
	readonly energyRenormalisationFactor: number;
	readonly maximumSignificantViolationBefore: number;
	readonly maximumSignificantViolationAfter: number;
	readonly checks: {
		readonly norm: boolean;
		readonly kin: boolean;
		readonly one: boolean;
		readonly vio: boolean;
		readonly mod: boolean;
	};
}

export interface ImpactSolveDiagnostic {
	readonly componentId?: string;
	readonly candidateEvidence?: readonly {
		readonly id: string;
		readonly type: 'body-body' | 'body-fixed';
		readonly separation: number;
		readonly active: boolean;
		readonly reason: string;
	}[];
	readonly bodyIds: readonly string[];
	readonly contactIds: readonly string[];
	readonly masses: readonly number[];
	readonly preImpactVelocity: readonly number[];
	readonly preImpactMomentum: readonly number[];
	readonly contactGradients: readonly (readonly number[])[];
	readonly linealityDimension: number;
	readonly linealityContactIds: readonly string[];
	readonly equalityBasis: readonly (readonly number[])[];
	readonly projectedVelocity: readonly number[];
	readonly projectedContactGradients: readonly (readonly number[])[];
	readonly projectedContactIds: readonly string[];
	readonly removedContactIds: readonly string[];
	readonly violationThreshold: number;
	readonly relativeViolationEpsilon: number;
	readonly absoluteNormalVelocityFloor: number;
	readonly reflections: readonly ImpactReflectionDiagnostic[];
	readonly inelasticVelocity: readonly number[];
	readonly elasticVelocity: readonly number[];
	readonly finalVelocity: readonly number[];
	readonly restitution: number;
	readonly completion: 'complete' | 'impact-termination-certification-failed';
	readonly failureReason: string | null;
}

export interface DynamicSupportReactionEvidence {
	readonly contactId: string;
	readonly reaction: number;
}

export interface DynamicSupportDiagnostic {
	readonly id: string;
	readonly contactId: string;
	readonly movingBodyId: EntityId;
	readonly supportBodyId: EntityId;
	readonly anchoredComponentId: string;
	readonly anchoredBodyIds: readonly EntityId[];
	readonly interval: readonly [startTime: number, endTime: number];
	readonly startNormal: Vec2;
	readonly endNormal: Vec2;
	readonly startTangentialSpeed: number;
	readonly endTangentialSpeed: number;
	readonly startBodyBodyReaction: number;
	readonly endBodyBodyReaction: number;
	readonly startLoadOnSupport: Vec2;
	readonly endLoadOnSupport: Vec2;
	readonly fixedSupportReactionsAtStart: readonly DynamicSupportReactionEvidence[];
	readonly fixedSupportReactionsAtEnd: readonly DynamicSupportReactionEvidence[];
	readonly outcome:
		| 'retained'
		| 'turning-point'
		| 'detached'
		| 'support-contact-released'
		| 'fixed-contact'
		| 'terminal'
		| 'interrupted'
		| 'unresolved';
	readonly retainedContactIds: readonly string[];
	readonly releasedContactIds: readonly string[];
}

export interface RunDiagnostics {
	readonly iterations: number;
	readonly simulatedUntilTime: number;
	readonly eventCount: number;
	readonly candidateCount: number;
	readonly segmentCount: number;
	readonly simulationWallTimeMilliseconds: number;
	readonly contactSearches: readonly RunContactSearchDiagnostic[];
	readonly bodyEventHorizons: readonly BodyEventHorizonDiagnostic[];
	readonly pairPredictions: readonly PairPredictionDiagnostic[];
	readonly impactSolves?: readonly ImpactSolveDiagnostic[];
	readonly dynamicSupports?: readonly DynamicSupportDiagnostic[];
	readonly schedulerSteps?: readonly WorldSchedulerStepDiagnostic[];
	readonly entries: readonly DiagnosticEntry[];
}
