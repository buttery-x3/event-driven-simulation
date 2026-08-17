import type { Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import {
	certifySupportEquilibrium,
	classifyPostResponseContacts,
	fixedContactId,
	selectPostContactMode,
	type ExactTimeContactState,
	type PostContactMode,
	type ResolvedContactState,
	type SupportReactionSolution
} from '../../contact-resolution';
import type { ImpactResponse } from './response';

export interface FixedPostContactResolution {
	readonly contacts: ResolvedContactState;
	readonly retainedCandidates: readonly FixedWorldContactCandidate[];
	readonly support: SupportReactionSolution | null;
	readonly mode: PostContactMode;
}

export function resolveFixedPostContactState(
	eventState: ExactTimeContactState,
	response: ImpactResponse,
	gravity: Vec2,
	tolerance: number,
	initialSupport: SupportReactionSolution | null,
	acquiredAlternatingLimit: boolean
): FixedPostContactResolution | null {
	const active = new Set(response.activeCandidates.map(fixedContactId));
	const captureEvidence = new Map(
		response.contactCapture.contacts.map((contact) => [contact.contactId, contact])
	);
	const contacts = classifyPostResponseContacts(
		eventState,
		eventState.contacts.map((contact, index) => {
			const result = response.contacts[index]!;
			const candidate = contact.type === 'body-fixed' ? contact.candidate : null;
			return {
				contactId: contact.id,
				preResponseNormalVelocity: result.preImpactNormalVelocity,
				postResponseNormalVelocity: result.postImpactNormalVelocity,
				impulse: result.impulse,
				retentionEligible: Boolean(
					candidate &&
					active.has(contact.id) &&
					dot(gravity, candidate.normal) < 0 &&
					(response.collapseReason !== null ||
						Math.abs(result.postImpactNormalVelocity) <= tolerance)
				),
				supportReaction: captureEvidence.get(contact.id)?.supportReaction ?? null
			};
		}),
		tolerance
	);
	if (!contacts) return null;
	const retainedCandidates = contacts.contacts.flatMap(({ contact, disposition }) =>
		contact.type === 'body-fixed' && disposition === 'retained' ? [contact.candidate] : []
	);
	const mayRest = Math.hypot(...response.outgoingVelocity) <= tolerance;
	const support = mayRest
		? (initialSupport ??
			certifySupportEquilibrium(eventState.bodies, eventState.contacts, gravity, tolerance))
		: null;
	const mode = selectPostContactMode({
		contacts,
		stationaryBodyIds: support ? eventState.bodies.map(({ id }) => id) : [],
		support,
		preferredFixedContactId: retainedCandidates[0] ? fixedContactId(retainedCandidates[0]) : null,
		unresolvedDetail:
			acquiredAlternatingLimit && retainedCandidates.length > 0 && !support
				? 'The acquired alternating-contact manifold was pressing but had no certified resting support or common release.'
				: null
	});
	return { contacts, retainedCandidates, support, mode };
}

export function supportReactionsInCandidateOrder(
	support: SupportReactionSolution,
	candidates: readonly FixedWorldContactCandidate[]
): readonly number[] {
	const reactions = new Map(
		support.contacts.map((contact, index) => [contact.id, support.reactions[index]!])
	);
	return candidates.map((candidate) => reactions.get(fixedContactId(candidate)) ?? 0);
}

function dot(left: Vec2, right: Vec2): number {
	return left[0] * right[0] + left[1] * right[1];
}
