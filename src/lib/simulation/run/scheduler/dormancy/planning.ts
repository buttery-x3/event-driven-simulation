import {
	certifySupportEquilibrium,
	isRepresentedRestCandidate,
	selectPostContactMode,
	type ExactContact,
	type ResolvedContactState,
	type SupportReactionSolution
} from '../../contact-resolution';
import type { SchedulerState } from '../types';

export interface BodyVelocityResponse {
	readonly bodyVelocities: readonly {
		readonly bodyId: string;
		readonly velocity: readonly [number, number];
	}[];
}

export interface DormantComponentPlan {
	readonly groupIndex: number;
	readonly bodyIds: ReadonlySet<string>;
	readonly contacts: readonly ExactContact[];
	readonly support: SupportReactionSolution;
}

export function planDormantComponents(
	state: SchedulerState,
	resolvedContacts: ResolvedContactState,
	response: BodyVelocityResponse,
	tolerance: number
): readonly DormantComponentPlan[] {
	const component = resolvedContacts.eventState;
	const velocityByBody = new Map(
		response.bodyVelocities.map((body) => [body.bodyId, body.velocity])
	);
	const candidateBodyIds = new Set(
		component.bodies
			.filter(({ id }) => isRepresentedRestCandidate([velocityByBody.get(id)!]))
			.map(({ id }) => id)
	);
	const currentCandidateContacts = component.contacts.filter((contact) =>
		contact.type === 'body-fixed'
			? candidateBodyIds.has(contact.bodyId)
			: candidateBodyIds.has(contact.firstBodyId) && candidateBodyIds.has(contact.secondBodyId)
	);
	return connectedCandidateGroups(candidateBodyIds, currentCandidateContacts).flatMap(
		(bodyIds, groupIndex) => {
			const bodies = component.bodies.filter(({ id }) => bodyIds.has(id));
			const contacts = currentCandidateContacts.filter((contact) =>
				contactBelongsTo(contact, bodyIds)
			);
			const support = certifySupportEquilibrium(
				bodies,
				contacts,
				state.input.settings.gravity,
				tolerance
			);
			if (!support) return [];
			const contactIds = new Set(contacts.map(({ id }) => id));
			const groupResolvedContacts: ResolvedContactState = {
				eventState: {
					...component,
					id: `${component.id}:stationary:${groupIndex}`,
					bodies,
					contacts
				},
				contacts: resolvedContacts.contacts.filter(({ contact }) => contactIds.has(contact.id))
			};
			const mode = selectPostContactMode({
				contacts: groupResolvedContacts,
				resting: {
					bodyIds: [...bodyIds],
					motion: { velocities: bodies.map(({ id }) => velocityByBody.get(id)!), tolerance },
					support: () => support
				}
			});
			return mode.type === 'resting-anchored'
				? [{ groupIndex, bodyIds, contacts, support: mode.support }]
				: [];
		}
	);
}

function connectedCandidateGroups(
	bodyIds: ReadonlySet<string>,
	contacts: readonly ExactContact[]
): readonly ReadonlySet<string>[] {
	const remaining = new Set(bodyIds);
	const groups: Set<string>[] = [];
	while (remaining.size > 0) {
		const seed = [...remaining].sort()[0]!;
		const group = new Set([seed]);
		remaining.delete(seed);
		let changed = true;
		while (changed) {
			changed = false;
			for (const contact of contacts) {
				if (contact.type !== 'body-body') continue;
				if (!group.has(contact.firstBodyId) && !group.has(contact.secondBodyId)) continue;
				for (const id of [contact.firstBodyId, contact.secondBodyId]) {
					if (!remaining.delete(id)) continue;
					group.add(id);
					changed = true;
				}
			}
		}
		groups.push(group);
	}
	return groups;
}

function contactBelongsTo(contact: ExactContact, bodyIds: ReadonlySet<string>): boolean {
	return contact.type === 'body-fixed'
		? bodyIds.has(contact.bodyId)
		: bodyIds.has(contact.firstBodyId) && bodyIds.has(contact.secondBodyId);
}
