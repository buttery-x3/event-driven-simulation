import type {
	ConstantAccelerationMotionSegment,
	ContactEvent,
	StaticCollider,
	Vec2
} from '../../contracts';
import type { BoundaryContactFeature, BoundaryContactTolerances } from '../boundary-contact';
import type { CircleCircleContactTolerances } from '../circle-circle';

export interface FixedWorldContactTolerances
	extends CircleCircleContactTolerances, BoundaryContactTolerances {}

export interface FixedWorldContactQuery {
	readonly segment: ConstantAccelerationMotionSegment;
	readonly ballRadius: number;
	readonly colliders: readonly StaticCollider[];
	readonly searchUntilTime: number;
	readonly tolerances?: FixedWorldContactTolerances;
	readonly maximumRefinementIterations?: number;
	readonly releasedContactColliderId?: string | null;
	readonly releasedContactColliderIds?: readonly string[];
	readonly toleranceContainedReleaseColliderIds?: readonly string[];
}

export type FixedWorldContactFeature = 'circle' | BoundaryContactFeature;

export interface FixedWorldContactCandidate {
	readonly type: 'contact-candidate';
	readonly bodyId: string;
	readonly colliderId: string;
	readonly colliderKind: 'circle' | 'boundary';
	readonly feature: FixedWorldContactFeature;
	readonly time: number;
	readonly position: Vec2;
	readonly contactPoint: Vec2;
	readonly normal: Vec2;
	readonly normalVelocity: number;
	readonly response: 'impact' | 'non-impulsive-contact';
}

export interface FixedWorldRejectedCandidateDiagnostic {
	readonly time: number;
	readonly feature: FixedWorldContactFeature;
	readonly classification: string;
}

export interface FixedWorldColliderDiagnostic {
	readonly colliderId: string;
	readonly colliderKind: 'circle' | 'boundary';
	readonly outcome: 'contact' | 'no-contact' | 'unresolved' | 'invalid-input';
	readonly reason: string | null;
	readonly eventTime: number | null;
	readonly contactPoint: Vec2 | null;
	readonly normal: Vec2 | null;
	readonly rejectedCandidates: readonly FixedWorldRejectedCandidateDiagnostic[];
}

export interface FixedWorldContactDiagnostics {
	readonly searchInterval: readonly [startTime: number, endTime: number];
	readonly eventTimeTolerance: number;
	readonly colliderEvaluations: readonly FixedWorldColliderDiagnostic[];
	readonly orderedCandidates: readonly FixedWorldContactCandidate[];
	readonly nearSimultaneousCandidates: readonly FixedWorldContactCandidate[];
	readonly activeCandidates: readonly FixedWorldContactCandidate[];
}

export type FixedWorldContactQueryResult =
	| {
			readonly type: 'contact';
			readonly event: ContactEvent;
			readonly candidate: FixedWorldContactCandidate;
			readonly activeCandidates: readonly FixedWorldContactCandidate[];
			readonly diagnostics: FixedWorldContactDiagnostics;
	  }
	| { readonly type: 'no-event'; readonly diagnostics: FixedWorldContactDiagnostics }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly diagnostics: FixedWorldContactDiagnostics;
	  }
	| {
			readonly type: 'invalid-input';
			readonly reason: string;
			readonly diagnostics: FixedWorldContactDiagnostics;
	  };
