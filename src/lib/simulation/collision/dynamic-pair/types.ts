import type { MotionSegment, Vec2 } from '../../contracts';
import type { CircleCircleRootTopology, CircleCircleRootTopologyEvidence } from '../circle-circle';

export type PolynomialDynamicCirclePath = Exclude<
	MotionSegment,
	{ readonly type: 'circular-contact' }
>;

export interface DynamicCirclePathParticipant {
	readonly bodyId: string;
	readonly revision: number;
	readonly radius: number;
	readonly path: PolynomialDynamicCirclePath;
}

export interface DynamicPairContactTolerances {
	readonly contactDistance: number;
	readonly eventTime: number;
	readonly normalVelocity: number;
	readonly polynomialResidual: number;
}

export interface DynamicPairContactQuery {
	readonly first: DynamicCirclePathParticipant;
	readonly second: DynamicCirclePathParticipant;
	readonly currentTime: number;
	readonly tolerances?: DynamicPairContactTolerances;
	readonly maximumRefinementIterations?: number;
}

export type DynamicPairCandidateClassification =
	| 'accepted-impact'
	| 'accepted-non-impulsive'
	| 'rejected-exiting'
	| 'rejected-grazing'
	| 'rejected-outside-contact-tolerance'
	| 'indeterminate';

export interface DynamicPairContactCandidateDiagnostic {
	readonly normalizedTime: number;
	readonly time: number;
	readonly polynomialResidual: number;
	readonly geometryResidual: number;
	readonly relativeNormalMotion: number | null;
	readonly source: 'boundary' | 'critical-point' | 'bracketed-root';
	readonly isolatingInterval: readonly [minimum: number, maximum: number];
	readonly refinementIterations: number;
	readonly topology: CircleCircleRootTopology;
	readonly beforeRegion: CircleCircleRootTopologyEvidence['before'];
	readonly afterRegion: CircleCircleRootTopologyEvidence['after'];
	readonly classification: DynamicPairCandidateClassification;
}

export interface DynamicPairContactDiagnostics {
	readonly bodyIds: readonly [string, string];
	readonly revisions: readonly [number, number];
	readonly pathTypes: readonly [
		PolynomialDynamicCirclePath['type'],
		PolynomialDynamicCirclePath['type']
	];
	readonly searchInterval: readonly [startTime: number, endTime: number];
	readonly localEventHorizons: readonly [number, number];
	readonly normalizedIntervalScale: number;
	readonly relativeCoefficients: readonly [Vec2, Vec2, Vec2] | null;
	readonly polynomialCoefficients: readonly number[];
	readonly normalizedPolynomialCoefficients: readonly number[];
	readonly polynomialScale: number | null;
	readonly polynomialDegree: number | null;
	readonly isolatedRoots: readonly number[];
	readonly refinementIterations: number;
	readonly candidates: readonly DynamicPairContactCandidateDiagnostic[];
}

export interface DynamicPairContactState {
	readonly time: number;
	readonly firstPosition: Vec2;
	readonly secondPosition: Vec2;
	readonly firstVelocity: Vec2;
	readonly secondVelocity: Vec2;
	readonly relativeVelocity: Vec2;
	readonly normalFromFirstToSecond: Vec2;
	readonly relativeNormalMotion: number;
	readonly contactPoint: Vec2;
	readonly response: 'impact' | 'non-impulsive-contact';
}

export type DynamicPairContactQueryResult =
	| {
			readonly type: 'contact';
			readonly state: DynamicPairContactState;
			readonly diagnostics: DynamicPairContactDiagnostics;
	  }
	| { readonly type: 'no-contact'; readonly diagnostics: DynamicPairContactDiagnostics }
	| {
			readonly type: 'invalid-input';
			readonly reason: string;
			readonly diagnostics: DynamicPairContactDiagnostics;
	  }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly diagnostics: DynamicPairContactDiagnostics;
	  };
