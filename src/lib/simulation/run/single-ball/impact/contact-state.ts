import type { Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import {
	certifySupportEquilibrium,
	classifyPostResponseContacts,
	fixedContactId,
	isSubResolutionPostNormalMotion,
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
	readonly outgoingVelocity: Vec2;
}

export function resolveFixedPostContactState(
	eventState: ExactTimeContactState,
	response: ImpactResponse,
	gravity: Vec2,
	tolerance: number,
	initialSupport: SupportReactionSolution | null,
	acquiredAlternatingLimit: boolean,
	priorRetainedIds: ReadonlySet<string> = new Set()
): FixedPostContactResolution | null {
	const active = new Set(response.activeCandidates.map(fixedContactId));
	const captureEvidence = new Map(
		response.contactCapture.contacts.map((contact) => [contact.contactId, contact])
	);
	const hasMeaningfulPostSeparation = eventState.contacts.some((_, index) => {
		const result = response.contacts[index];
		return result != null && !isSubResolutionPostNormalMotion(result.postImpactNormalVelocity);
	});
	const contacts = classifyPostResponseContacts(
		eventState,
		eventState.contacts.map((contact, index) => {
			const result = response.contacts[index]!;
			const candidate = contact.type === 'body-fixed' ? contact.candidate : null;
			const subResolution = isSubResolutionPostNormalMotion(result.postImpactNormalVelocity);
			return {
				contactId: contact.id,
				preResponseNormalVelocity: result.preImpactNormalVelocity,
				postResponseNormalVelocity: result.postImpactNormalVelocity,
				impulse: result.impulse,
				retentionEligible: Boolean(
					candidate &&
					((!acquiredAlternatingLimit &&
						subResolution &&
						(!hasMeaningfulPostSeparation || priorRetainedIds.has(contact.id))) ||
						(response.collapseReason !== null && active.has(contact.id)))
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
	const mode = selectPostContactMode({
		contacts,
		resting: {
			bodyIds: eventState.bodies.map(({ id }) => id),
			motion: { velocities: [response.outgoingVelocity], tolerance },
			support: () =>
				initialSupport ??
				certifySupportEquilibrium(eventState.bodies, eventState.contacts, gravity, tolerance)
		},
		preferredFixedContactId: retainedCandidates[0] ? fixedContactId(retainedCandidates[0]) : null,
		unresolvedWithoutRestingMode:
			acquiredAlternatingLimit && retainedCandidates.length > 0
				? 'The acquired alternating-contact manifold was pressing but had no certified resting support or common release.'
				: null
	});
	const support = mode.type === 'resting-anchored' ? mode.support : null;
	return {
		contacts,
		retainedCandidates,
		support,
		mode,
		outgoingVelocity: mode.type === 'resting-anchored' ? [0, 0] : response.outgoingVelocity
	};
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
