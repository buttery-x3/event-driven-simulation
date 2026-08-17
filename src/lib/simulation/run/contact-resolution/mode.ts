import type { PostContactMode, ResolvedContactState, SupportReactionSolution } from './types';

export interface PostContactModeRequest {
	readonly contacts: ResolvedContactState;
	readonly stationaryBodyIds?: readonly string[];
	readonly support?: SupportReactionSolution | null;
	readonly dynamicSupport?: {
		readonly contactId: string;
		readonly movingBodyId: string;
		readonly supportBodyId: string;
	} | null;
	readonly preferredFixedContactId?: string | null;
	readonly unsupportedBodyContactId?: string | null;
	readonly unresolvedDetail?: string | null;
}

export function selectPostContactMode(request: PostContactModeRequest): PostContactMode {
	if (request.unresolvedDetail) {
		return { type: 'unresolved', detail: request.unresolvedDetail };
	}
	const retained = new Set(
		request.contacts.contacts
			.filter(({ disposition }) => disposition === 'retained')
			.map(({ contact }) => contact.id)
	);
	if (request.support && request.stationaryBodyIds?.length) {
		return {
			type: 'resting-anchored',
			bodyIds: [...request.stationaryBodyIds].sort(),
			support: request.support
		};
	}
	if (request.dynamicSupport && retained.has(request.dynamicSupport.contactId)) {
		return { type: 'dynamic-sustained-support', ...request.dynamicSupport };
	}
	if (request.preferredFixedContactId && retained.has(request.preferredFixedContactId)) {
		return { type: 'fixed-sustained-contact', contactId: request.preferredFixedContactId };
	}
	if (request.unsupportedBodyContactId && retained.has(request.unsupportedBodyContactId)) {
		const contact = request.contacts.eventState.contacts.find(
			({ id }) => id === request.unsupportedBodyContactId
		);
		if (contact?.type === 'body-body') {
			return {
				type: 'unsupported',
				contactId: contact.id,
				bodyIds: [contact.firstBodyId, contact.secondBodyId]
			};
		}
	}
	return { type: 'free-flight' };
}
