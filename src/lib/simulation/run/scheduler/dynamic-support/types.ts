import type { CircularContactMotionSegment, Vec2 } from '../../../contracts';
import type { SupportReactionSolution } from '../dormancy';
import type { ActiveComponentContact, ComponentBodyState } from '../pairs/component';
import type { AngularEvent, CircularContactSeed } from '../../single-ball/sustained-contact';

export interface DynamicSupportRuntime {
	readonly id: string;
	readonly contactId: string;
	readonly movingBodyId: string;
	readonly supportBodyId: string;
	componentId: string;
	readonly anchoredBodyIds: readonly string[];
	anchoredBodies: readonly ComponentBodyState[];
	anchoredContacts: readonly ActiveComponentContact[];
	time: number;
	position: Vec2;
	normal: Vec2;
	direction: -1 | 1;
	tangentialSpeed: number;
}

export type DynamicSupportBoundary =
	| AngularEvent
	| {
			readonly type: 'anchored-support-lost';
			readonly angle: number;
			readonly releasedContactIds: readonly string[];
	  }
	| { readonly type: 'unresolved'; readonly angle: number; readonly detail: string };

export interface DynamicSupportReactionState {
	readonly angle: number;
	readonly normal: Vec2;
	readonly tangentialSpeed: number;
	readonly bodyBodyReaction: number;
	readonly loadOnSupport: Vec2;
	readonly support: SupportReactionSolution | null;
}

export interface DynamicSupportPrediction {
	readonly supportId: string;
	readonly movingBodyId: string;
	readonly revision: number;
	readonly segment: CircularContactMotionSegment;
	readonly seed: CircularContactSeed;
	readonly boundary: DynamicSupportBoundary;
	readonly startReaction: DynamicSupportReactionState;
	readonly endReaction: DynamicSupportReactionState;
	readonly initialRequiredContactIds: readonly string[];
}

export type DynamicSupportCommitResult =
	| { readonly type: 'continued' }
	| { readonly type: 'terminal'; readonly reason: import('../../../contracts').RunTerminalReason };
