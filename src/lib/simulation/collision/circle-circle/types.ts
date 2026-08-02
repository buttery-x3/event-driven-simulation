import type {
	ConstantAccelerationMotionSegment,
	ContactEvent,
	StaticCircleCollider,
	Vec2
} from '../../contracts';
import type { CircleCircleRootTopology, CircleCircleRootTopologyEvidence } from './root-topology';

export interface CircleCircleContactTolerances {
	readonly contactDistance: number;
	readonly eventTime: number;
	readonly normalVelocity: number;
	readonly polynomialResidual: number;
}

export interface CircleCircleContactQuery {
	readonly segment: ConstantAccelerationMotionSegment;
	readonly ballRadius: number;
	readonly circle: StaticCircleCollider;
	readonly searchUntilTime: number;
	readonly tolerances?: CircleCircleContactTolerances;
	readonly maximumRefinementIterations?: number;
	readonly releasedInitialContact?: boolean;
}

export type CircleCircleContactCandidateClassification =
	| 'accepted-impact'
	| 'accepted-non-impulsive'
	| 'rejected-exiting'
	| 'rejected-grazing'
	| 'rejected-release-owned'
	| 'rejected-outside-contact-tolerance'
	| 'indeterminate';

export interface CircleCircleContactCandidateDiagnostic {
	readonly time: number;
	readonly polynomialResidual: number;
	readonly surfaceSeparation: number;
	readonly normalVelocity: number | null;
	readonly source: 'boundary' | 'critical-point' | 'bracketed-root';
	readonly refinementIterations: number;
	readonly topology: CircleCircleRootTopology;
	readonly beforeRegion: CircleCircleRootTopologyEvidence['before'];
	readonly afterRegion: CircleCircleRootTopologyEvidence['after'];
	readonly classification: CircleCircleContactCandidateClassification;
}

export interface CircleCircleContactDiagnostics {
	readonly searchInterval: readonly [startTime: number, endTime: number];
	readonly normalizedPolynomialCoefficients: readonly number[];
	readonly polynomialScale: number | null;
	readonly refinementIterations: number;
	readonly candidates: readonly CircleCircleContactCandidateDiagnostic[];
}

export interface CircleCircleContactState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly normal: Vec2;
	readonly normalVelocity: number;
	readonly response: 'impact' | 'non-impulsive-contact';
}

export type CircleCircleContactQueryResult =
	| {
			readonly type: 'contact';
			readonly event: ContactEvent;
			readonly state: CircleCircleContactState;
			readonly diagnostics: CircleCircleContactDiagnostics;
	  }
	| { readonly type: 'no-contact'; readonly diagnostics: CircleCircleContactDiagnostics }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly diagnostics: CircleCircleContactDiagnostics;
	  }
	| {
			readonly type: 'invalid-input';
			readonly reason: string;
			readonly diagnostics: CircleCircleContactDiagnostics;
	  };
