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
		'release' | 'fixed-contact' | 'body-contact' | 'termination' | 'none' | 'unresolved';
}

export interface PairPredictionDiagnostic {
	readonly id: string;
	readonly bodyIds: readonly [EntityId, EntityId];
	readonly predictedTime: number | null;
	readonly validInterval: readonly [startTime: number, endTime: number];
	readonly revisions: readonly [PredictionRevision, PredictionRevision];
	readonly decision: PredictionDecision;
	readonly reason: string;
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
	readonly entries: readonly DiagnosticEntry[];
}
