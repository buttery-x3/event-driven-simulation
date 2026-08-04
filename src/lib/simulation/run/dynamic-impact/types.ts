import type { Vec2 } from '../../contracts';

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

export interface ReflectionDiagnostic {
	readonly iteration: number;
	readonly violatingContactIds: readonly string[];
	readonly impulse: readonly number[];
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

export interface CoupledImpactDiagnostic {
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
	readonly removedContactIds: readonly string[];
	readonly violationThreshold: number;
	readonly relativeViolationEpsilon: number;
	readonly absoluteNormalVelocityFloor: number;
	readonly reflections: readonly ReflectionDiagnostic[];
	readonly inelasticVelocity: readonly number[];
	readonly elasticVelocity: readonly number[];
	readonly finalVelocity: readonly number[];
	readonly restitution: number;
	readonly completion: 'complete' | 'impact-termination-certification-failed';
	readonly failureReason: string | null;
}

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
