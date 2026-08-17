import type { Vec2 } from '../../contracts';
import type { FixedWorldContactCandidate } from '../../collision';

export interface ExactContactBodyState {
	readonly id: string;
	readonly mass: number;
	readonly radius: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
}

export type ExactContact =
	| {
			readonly type: 'body-body';
			readonly id: string;
			readonly firstBodyId: string;
			readonly secondBodyId: string;
			readonly normalFromFirstToSecond: Vec2;
			readonly contactPoint: Vec2;
	  }
	| {
			readonly type: 'body-fixed';
			readonly id: string;
			readonly bodyId: string;
			readonly colliderId: string;
			readonly normal: Vec2;
			readonly contactPoint: Vec2;
			readonly candidate: FixedWorldContactCandidate;
	  };

export interface ExactTimeContactState {
	readonly id: string;
	readonly time: number;
	readonly bodies: readonly ExactContactBodyState[];
	readonly contacts: readonly ExactContact[];
}

export interface PostResponseContactEvidence {
	readonly contactId: string;
	readonly preResponseNormalVelocity: number;
	readonly postResponseNormalVelocity: number;
	readonly impulse: number;
	readonly retentionEligible?: boolean;
	readonly supportReaction?: number | null;
}

export interface ResolvedContactRole {
	readonly contact: ExactContact;
	readonly participation: 'impact' | 'constraint';
	readonly disposition: 'retained' | 'released';
	readonly preResponseNormalVelocity: number;
	readonly postResponseNormalVelocity: number;
	readonly impulse: number;
	readonly supportReaction: number | null;
}

export interface ResolvedContactState {
	readonly eventState: ExactTimeContactState;
	readonly contacts: readonly ResolvedContactRole[];
}

export interface SupportReactionSolution {
	readonly contacts: readonly ExactContact[];
	readonly reactions: readonly number[];
	readonly residualNorm: number;
}

export type PostContactMode =
	| { readonly type: 'free-flight' }
	| { readonly type: 'fixed-sustained-contact'; readonly contactId: string }
	| {
			readonly type: 'resting-anchored';
			readonly bodyIds: readonly string[];
			readonly support: SupportReactionSolution;
	  }
	| {
			readonly type: 'dynamic-sustained-support';
			readonly contactId: string;
			readonly movingBodyId: string;
			readonly supportBodyId: string;
	  }
	| {
			readonly type: 'unsupported';
			readonly contactId: string;
			readonly bodyIds: readonly [string, string];
	  }
	| { readonly type: 'unresolved'; readonly detail: string };
