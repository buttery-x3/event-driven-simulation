import type { EntityId, Vec2 } from '../geometry';

export interface ContactManifoldMember {
	readonly colliderId: EntityId;
	readonly feature: string;
	readonly contactPoint: Vec2;
	readonly normal: Vec2;
	readonly preImpactNormalVelocity: number;
	readonly postImpactNormalVelocity: number;
	readonly impulse: number;
}

export interface ContactEvent {
	readonly type: 'contact';
	readonly time: number;
	readonly bodyId: EntityId;
	readonly colliderId: EntityId;
	readonly position: Vec2;
	readonly normal: Vec2;
	readonly contacts?: readonly ContactManifoldMember[];
	readonly preContactVelocity?: Vec2;
	readonly postContactVelocity?: Vec2;
}

export type ContactMode = 'free-flight' | 'impact' | 'resting' | 'sliding';

export interface ContactModeTransitionEvent {
	readonly type: 'contact-mode-transition';
	readonly time: number;
	readonly bodyId: EntityId;
	readonly colliderId: EntityId;
	readonly from: ContactMode;
	readonly to: ContactMode;
	readonly reason:
		| 'impact-collapse'
		| 'supported-initial-state'
		| 'resting'
		| 'sliding'
		| 'endpoint-reached'
		| 'support-lost'
		| 'collider-contact'
		| 'terminal-region'
		| 'unresolved';
	readonly position: Vec2;
	readonly normal: Vec2;
	readonly contacts?: readonly ContactManifoldMember[];
}

export type PhysicalEvent = ContactEvent | ContactModeTransitionEvent;

export interface ReleaseEvent {
	readonly type: 'body-release';
	readonly time: number;
	readonly bodyId: EntityId;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly status: 'released' | 'rejected';
	readonly reason: string | null;
}

export type ContactParticipant =
	| { readonly type: 'body'; readonly bodyId: EntityId }
	| { readonly type: 'fixed-collider'; readonly colliderId: EntityId };

export interface DynamicContactRecord {
	readonly id: string;
	readonly time: number;
	readonly participants: readonly [ContactParticipant, ContactParticipant];
	readonly contactPoint: Vec2;
	readonly normalFromFirstToSecond: Vec2;
	readonly preImpactNormalVelocity: number | null;
	readonly postImpactNormalVelocity: number | null;
	readonly impulse: number | null;
	readonly state: 'incoming' | 'retained' | 'released' | 'rejected';
}

export interface ContactComponentRecord {
	readonly id: string;
	readonly type: 'exact-time-impact' | 'resting-anchored';
	readonly createdAtTime: number;
	readonly dissolvedAtTime: number | null;
	readonly bodyIds: readonly EntityId[];
	readonly fixedColliderIds: readonly EntityId[];
	readonly activeContactIds: readonly string[];
	readonly retainedSupportReactions: readonly {
		readonly contactId: string;
		readonly impulsePerTime: number;
	}[];
}

export interface ComponentLifecycleEvent {
	readonly type: 'contact-component-lifecycle';
	readonly time: number;
	readonly change: 'created' | 'split' | 'merged' | 'dissolved';
	readonly componentIds: readonly string[];
	readonly resultingComponentIds: readonly string[];
}
