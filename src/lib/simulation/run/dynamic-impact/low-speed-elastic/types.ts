import type { Vec2 } from '../../../contracts';
import type { CoupledImpactBody, CoupledImpactContact, CoupledImpactTolerances } from '../types';

export interface LowSpeedElasticInput {
	readonly bodies: readonly CoupledImpactBody[];
	readonly contacts: readonly CoupledImpactContact[];
	readonly supportContactIds: readonly string[];
	readonly tolerances: CoupledImpactTolerances;
}

export interface AnchoredRestingComponentConstraint {
	readonly componentId: string;
	readonly bodyIds: readonly string[];
}

export interface AnchoredElasticFallbackInput extends LowSpeedElasticInput {
	readonly anchoredComponents: readonly AnchoredRestingComponentConstraint[];
}

export interface LowSpeedImpactImpulse {
	readonly contactId: string;
	readonly impulse: number;
}

export interface LowSpeedSupportReaction {
	readonly contactId: string;
	readonly multiplier: number;
}

export interface AnchoredCoordinateReaction {
	readonly componentId: string;
	readonly bodyId: string;
	readonly axis: 'x' | 'y';
	readonly multiplier: number;
}

export interface LowSpeedContactKinematics {
	readonly contactId: string;
	readonly role: 'support-constraint' | 'impact';
	readonly preImpactNormalVelocity: number;
	readonly postImpactNormalVelocity: number;
}

export interface LowSpeedElasticCertification {
	readonly impactSpeed: number;
	readonly maximumPreSupportViolation: number;
	readonly maximumPostSupportViolation: number;
	readonly maximumPostImpactViolation: number;
	readonly incomingProjectionCorrectionNorm: number;
	readonly kineticEnergyBefore: number;
	readonly kineticEnergyAfter: number;
	readonly energyError: number;
	readonly momentumResidualNorm: number;
	readonly reflectionCount: number;
}

export interface LowSpeedElasticResponse {
	readonly bodyVelocities: readonly {
		readonly bodyId: string;
		readonly velocity: Vec2;
	}[];
	readonly contacts: readonly LowSpeedContactKinematics[];
	readonly impactImpulses: readonly LowSpeedImpactImpulse[];
	readonly supportReactions: readonly LowSpeedSupportReaction[];
	readonly lockReactions: readonly AnchoredCoordinateReaction[];
	readonly preImpactVelocity: readonly number[];
	readonly finalVelocity: readonly number[];
	readonly certification: LowSpeedElasticCertification;
}

export type LowSpeedElasticResult =
	| { readonly type: 'response'; readonly response: LowSpeedElasticResponse }
	| { readonly type: 'rejected'; readonly reason: string };
