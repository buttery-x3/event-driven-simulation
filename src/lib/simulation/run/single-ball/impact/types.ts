import type { RunTerminalReason, Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';

export interface ImpactNextState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly releasedContactColliderId: string | null;
	readonly releasedContactColliderIds: readonly string[];
	readonly retainedSupportCandidates: readonly FixedWorldContactCandidate[];
	readonly pendingContactCandidates: readonly FixedWorldContactCandidate[];
	readonly acceptInitialContact: boolean;
	readonly toleranceContainedReleaseColliderIds?: readonly string[];
}

export type ImpactResolution =
	| { readonly type: 'terminal'; readonly reason: RunTerminalReason; readonly time: number }
	| { readonly type: 'continue'; readonly nextState: ImpactNextState };
