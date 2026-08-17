import type { ContactComponentRecord } from '../../../contracts';
import {
	certifySupportEquilibrium,
	isRepresentedRestCandidate,
	selectPostContactMode,
	type ExactContact,
	type ExactTimeContactState,
	type ResolvedContactState
} from '../../contact-resolution';
import type { CoupledImpactResponse } from '../../dynamic-impact';
import type { SchedulerState } from '../types';
import { futureEventTimes, restingComponentId, retainedDormantContactId } from './records';

export function rebuildDormantComponents(
	state: SchedulerState,
	resolvedContacts: ResolvedContactState,
	response: CoupledImpactResponse,
	tolerance: number
): ReadonlySet<string> {
	const component = resolvedContacts.eventState;
	const previous = retireOverlappingDormantComponents(state, component);
	const velocityByBody = new Map(
		response.bodyVelocities.map((body) => [body.bodyId, body.velocity])
	);
	const candidateBodyIds = new Set(
		component.bodies
			.filter(({ id }) => isRepresentedRestCandidate([velocityByBody.get(id)!]))
			.map(({ id }) => id)
	);
	const currentCandidateContacts = component.contacts.filter((contact) => {
		return contact.type === 'body-fixed'
			? candidateBodyIds.has(contact.bodyId)
			: candidateBodyIds.has(contact.firstBodyId) && candidateBodyIds.has(contact.secondBodyId);
	});
	const groups = connectedCandidateGroups(candidateBodyIds, currentCandidateContacts);
	const created: ContactComponentRecord[] = [];
	for (const [groupIndex, bodyIds] of groups.entries()) {
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
		if (!support) continue;
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
		if (mode.type !== 'resting-anchored') continue;
		const retainedContactIds = mode.support.contacts.map((contact, index) =>
			retainedDormantContactId(state, component, contact, mode.support.reactions[index]!)
		);
		const revision = previous.length
			? Math.max(...previous.map((record) => record.revision ?? 0)) + 1
			: 0;
		const id = restingComponentId(component.time, [...bodyIds], groupIndex + revision);
		const record: ContactComponentRecord = {
			id,
			type: 'resting-anchored',
			createdAtTime: component.time,
			dissolvedAtTime: null,
			bodyIds: [...bodyIds].sort(),
			fixedColliderIds: [
				...new Set(
					contacts
						.filter((contact) => contact.type === 'body-fixed')
						.map((contact) => contact.colliderId)
				)
			].sort(),
			activeContactIds: retainedContactIds,
			retainedSupportReactions: retainedContactIds.map((contactId, index) => ({
				contactId,
				impulsePerTime: mode.support.reactions[index]!
			})),
			revision,
			futureScheduledEventTimes: futureEventTimes(state, component.time)
		};
		state.contactComponents.push(record);
		created.push(record);
		for (const bodyId of bodyIds) {
			const runtime = state.runtimes.get(bodyId)!;
			runtime.dormantComponentId = id;
			runtime.state = { ...runtime.state, velocity: [0, 0] };
			runtime.terminalReason = {
				type: 'no-future-event',
				time: component.time,
				detail: `Body belongs to certified dormant contact component ${id}.`
			};
			state.predictions.delete(bodyId);
		}
	}
	const reactivatedBodyIds = reactivatedBodies(previous, created);
	recordLifecycle(state, component.time, previous, created, reactivatedBodyIds);
	return new Set(created.flatMap(({ bodyIds }) => bodyIds));
}

function retireOverlappingDormantComponents(
	state: SchedulerState,
	component: ExactTimeContactState
): ContactComponentRecord[] {
	const bodyIds = new Set(component.bodies.map(({ id }) => id));
	const previous = state.contactComponents.filter(
		(record) =>
			record.type === 'resting-anchored' &&
			record.dissolvedAtTime === null &&
			record.bodyIds.some((id) => bodyIds.has(id))
	);
	for (const record of previous) {
		const index = state.contactComponents.indexOf(record);
		state.contactComponents[index] = { ...record, dissolvedAtTime: component.time };
		for (const bodyId of record.bodyIds) {
			const runtime = state.runtimes.get(bodyId);
			if (runtime?.dormantComponentId === record.id) runtime.dormantComponentId = null;
		}
	}
	return previous;
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

function recordLifecycle(
	state: SchedulerState,
	time: number,
	previous: readonly ContactComponentRecord[],
	created: readonly ContactComponentRecord[],
	reactivatedBodyIds: readonly string[] = []
): void {
	const oldIds = previous.map(({ id }) => id).sort();
	const newIds = created.map(({ id }) => id).sort();
	const previousBodies = new Set(previous.flatMap(({ bodyIds }) => bodyIds));
	const createdBodies = new Set(created.flatMap(({ bodyIds }) => bodyIds));
	const membershipExpanded =
		previousBodies.size > 0 &&
		createdBodies.size > previousBodies.size &&
		[...previousBodies].every((bodyId) => createdBodies.has(bodyId));
	if ((oldIds.length > 1 || membershipExpanded) && newIds.length === 1) {
		state.componentEvents.push({
			type: 'contact-component-lifecycle',
			time,
			change: 'merged',
			componentIds: oldIds,
			resultingComponentIds: newIds,
			reactivatedBodyIds
		});
		return;
	}
	const membershipContracted =
		createdBodies.size > 0 &&
		createdBodies.size < previousBodies.size &&
		[...createdBodies].every((bodyId) => previousBodies.has(bodyId));
	if (oldIds.length === 1 && (newIds.length > 1 || membershipContracted)) {
		state.componentEvents.push({
			type: 'contact-component-lifecycle',
			time,
			change: 'split',
			componentIds: oldIds,
			resultingComponentIds: newIds,
			reactivatedBodyIds
		});
		return;
	}
	if (oldIds.length > 0) {
		state.componentEvents.push({
			type: 'contact-component-lifecycle',
			time,
			change: 'dissolved',
			componentIds: oldIds,
			resultingComponentIds: [],
			reactivatedBodyIds
		});
	}
	for (const record of created) {
		state.componentEvents.push({
			type: 'contact-component-lifecycle',
			time,
			change: 'created',
			componentIds: [],
			resultingComponentIds: [record.id]
		});
	}
}

function reactivatedBodies(
	previous: readonly ContactComponentRecord[],
	created: readonly ContactComponentRecord[]
): readonly string[] {
	const previouslyDormant = new Set(previous.flatMap(({ bodyIds }) => bodyIds));
	const stillDormant = new Set(created.flatMap(({ bodyIds }) => bodyIds));
	return [...previouslyDormant].filter((id) => !stillDormant.has(id)).sort();
}
