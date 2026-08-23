import type { EntityId, RunTerminalReason, Vec2 } from '../../../contracts';

export interface FrozenBodyRecord {
	readonly bodyId: EntityId;
	readonly freezeTime: number;
	readonly position: Vec2;
	readonly velocityBeforeFreeze: Vec2;
}

export type SelectedEventSource = 'body-pair' | 'local' | 'dynamic-support';

export interface SelectedEventIdentity {
	readonly time: number;
	readonly source: SelectedEventSource;
	readonly bodyIds: readonly EntityId[];
	readonly topology: string;
}

export interface FreezeRequest {
	readonly freezeTime: number;
	readonly originalFailure: RunTerminalReason;
	readonly affectedBodyIds: readonly EntityId[];
	readonly triggeringPairOrContactId?: string;
}

export type RecoveryResult =
	| { readonly type: 'continued' }
	| { readonly type: 'terminal'; readonly reason: RunTerminalReason };
