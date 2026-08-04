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
	readonly schedulerSteps?: readonly WorldSchedulerStepDiagnostic[];
	readonly entries: readonly DiagnosticEntry[];
}
