import type { ImpactReflectionDiagnostic, ImpactSolveDiagnostic, Vec2 } from '../../contracts';

export interface CoupledImpactBody {
	readonly id: string;
	readonly mass: number;
	readonly velocity: Vec2;
}

export type CoupledImpactContact =
	| {
			readonly id: string;
			readonly type: 'body-body';
			readonly firstBodyId: string;
			readonly secondBodyId: string;
			readonly normalFromFirstToSecond: Vec2;
	  }
	| {
			readonly id: string;
			readonly type: 'body-fixed';
			readonly bodyId: string;
			readonly colliderId: string;
			readonly normal: Vec2;
	  };

export interface CoupledImpactTolerances {
	readonly numerical: number;
	readonly absoluteNormalVelocityFloor: number;
	readonly relativeViolationEpsilon: number;
	readonly maximumReflections: number;
}

export interface CoupledImpactInput {
	readonly bodies: readonly CoupledImpactBody[];
	readonly contacts: readonly CoupledImpactContact[];
	readonly restitution: number;
	readonly tolerances: CoupledImpactTolerances;
}

export interface CoupledImpactContactResult {
	readonly contactId: string;
	readonly impulse: number;
	readonly preImpactNormalVelocity: number;
	readonly postImpactNormalVelocity: number;
}

export type ReflectionDiagnostic = ImpactReflectionDiagnostic;
export type CoupledImpactDiagnostic = ImpactSolveDiagnostic;

export interface CoupledImpactResponse {
	readonly bodyVelocities: readonly { readonly bodyId: string; readonly velocity: Vec2 }[];
	readonly contacts: readonly CoupledImpactContactResult[];
	readonly inelasticVelocity: readonly number[];
	readonly elasticVelocity: readonly number[];
	readonly finalVelocity: readonly number[];
	readonly diagnostic: CoupledImpactDiagnostic;
}

export type CoupledImpactResult =
	| { readonly type: 'response'; readonly response: CoupledImpactResponse }
	| {
			readonly type: 'rejected';
			readonly reason: string;
			readonly diagnostic?: CoupledImpactDiagnostic;
	  };
