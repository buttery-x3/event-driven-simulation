import type {
	ExactTimeContactState,
	PostResponseContactEvidence,
	ResolvedContactState
} from './types';

export function classifyPostResponseContacts(
	eventState: ExactTimeContactState,
	evidence: readonly PostResponseContactEvidence[],
	tolerance: number
): ResolvedContactState | null {
	const evidenceById = new Map(evidence.map((item) => [item.contactId, item]));
	const contacts = eventState.contacts.map((contact) => {
		const result = evidenceById.get(contact.id);
		if (!result) return null;
		const retained = result.retentionEligible ?? result.postResponseNormalVelocity <= tolerance;
		return {
			contact,
			participation:
				result.preResponseNormalVelocity < -tolerance
					? ('impact' as const)
					: ('constraint' as const),
			disposition: retained ? ('retained' as const) : ('released' as const),
			preResponseNormalVelocity: result.preResponseNormalVelocity,
			postResponseNormalVelocity: result.postResponseNormalVelocity,
			impulse: result.impulse,
			supportReaction: result.supportReaction ?? null
		};
	});
	return contacts.some((contact) => contact === null)
		? null
		: { eventState, contacts: contacts as ResolvedContactState['contacts'] };
}
