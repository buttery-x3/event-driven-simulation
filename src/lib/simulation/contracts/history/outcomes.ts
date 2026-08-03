import type { ContactManifoldMember } from './events';
import type { EntityId, Vec2 } from '../geometry';

export type RunValidity = 'valid' | 'invalid';

export type WorldRunOutcome =
	| 'exited'
	| 'escaped'
	| 'settled'
	| 'no-future-event'
	| 'time-limit'
	| 'event-limit'
	| 'unresolved'
	| 'invalid';

/** Compatibility name for the world-level outcome. */
export type RunOutcome = WorldRunOutcome;

export type BodyLifecycleState =
	'scheduled' | 'active' | 'resting' | 'completed' | 'escaped' | 'invalid' | 'unresolved';

export type BodyTerminalOutcome = 'completed' | 'escaped' | 'invalid' | 'unresolved';

export interface BodyRunState {
	readonly bodyId: EntityId;
	readonly lifecycle: BodyLifecycleState;
	readonly releaseTime: number;
	readonly activeFromTime: number | null;
	readonly recordedUntilTime: number | null;
	readonly terminalOutcome: BodyTerminalOutcome | null;
}

export type RunTerminalReason =
	| {
			readonly type: 'world-complete';
			readonly time: number;
			readonly outcome: 'exited' | 'escaped' | 'settled' | 'no-future-event';
			readonly detail: string;
	  }
	| { readonly type: 'completion-region'; readonly regionId: EntityId; readonly time: number }
	| { readonly type: 'escape-region'; readonly regionId: EntityId; readonly time: number }
	| {
			readonly type: 'bounds-escape';
			readonly boundary: 'left' | 'right' | 'bottom' | 'top';
			readonly time: number;
	  }
	| { readonly type: 'no-future-event'; readonly time: number; readonly detail: string }
	| { readonly type: 'time-limit'; readonly time: number; readonly limit: number }
	| { readonly type: 'event-limit'; readonly time: number; readonly limit: number }
	| {
			readonly type: 'resting-contact';
			readonly time: number;
			readonly colliderId: EntityId;
			readonly position: Vec2;
			readonly normal: Vec2;
			readonly contacts?: readonly ContactManifoldMember[];
			readonly supportReactions?: readonly number[];
			readonly reason: 'impact-collapse' | 'zero-tangential-motion';
	  }
	| { readonly type: 'unresolved-collision-search'; readonly time: number; readonly detail: string }
	| {
			readonly type: 'zero-time-loop';
			readonly time: number;
			readonly colliderId: EntityId;
			readonly detail: string;
	  }
	| { readonly type: 'invalid-state'; readonly time: number | null; readonly detail: string }
	| { readonly type: 'numerical-failure'; readonly time: number; readonly detail: string };
