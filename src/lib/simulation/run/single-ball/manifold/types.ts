import type { ContactManifoldMember, Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';

export interface ImpactManifoldSolution {
	readonly outgoingVelocity: Vec2;
	readonly contacts: readonly ContactManifoldMember[];
	readonly activeCandidates: readonly FixedWorldContactCandidate[];
}

export interface SupportReactionSolution {
	readonly reactions: readonly number[];
}
