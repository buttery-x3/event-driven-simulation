import type { ContactComponentRecord } from '../../../contracts';
import type { CoupledImpactResponse } from '../../dynamic-impact';
import type { ActiveComponentContact, ExactTimeComponent } from '../pairs/component';
import type { SchedulerState } from '../types';
import { certifySupportEquilibrium } from './support-equilibrium';
import { futureEventTimes, restingComponentId } from './records';

export function rebuildDormantComponents(
	state: SchedulerState,
	component: ExactTimeComponent,
	response: CoupledImpactResponse,
	tolerance: number
): ReadonlySet<string> {
	const previous = retireOverlappingDormantComponents(state, component);
	const velocityByBody = new Map(
		response.bodyVelocities.map((body) => [body.bodyId, body.velocity])
	);
	const resultByContact = new Map(response.contacts.map((contact) => [contact.contactId, contact]));
	const stationaryBodyIds = new Set(
		component.bodies
			.filter(({ id }) => Math.hypot(...velocityByBody.get(id)!) <= tolerance)
			.map(({ id }) => id)
	);
	const retained = component.contacts.filter((contact) => {
		if ((resultByContact.get(contact.id)?.postImpactNormalVelocity ?? Infinity) > tolerance)
			return false;
		return contact.type === 'body-fixed'
			? stationaryBodyIds.has(contact.bodyId)
			: stationaryBodyIds.has(contact.firstBodyId) && stationaryBodyIds.has(contact.secondBodyId);
	});
	const groups = connectedStationaryGroups(stationaryBodyIds, retained);
	const created: ContactComponentRecord[] = [];
	for (const [groupIndex, bodyIds] of groups.entries()) {
		const bodies = component.bodies.filter(({ id }) => bodyIds.has(id));
		const contacts = retained.filter((contact) => contactBelongsTo(contact, bodyIds));
		const support = certifySupportEquilibrium(
			bodies,
			contacts,
			state.input.settings.gravity,
			tolerance
		);
		if (!support) continue;
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
			activeContactIds: support.contacts.map(({ id: contactId }) => contactId),
			retainedSupportReactions: support.contacts.map(({ id: contactId }, index) => ({
				contactId,
				impulsePerTime: support.reactions[index]!
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
			const fixedContacts = support.contacts.filter(
				(contact): contact is Extract<ActiveComponentContact, { readonly type: 'body-fixed' }> =>
					contact.type === 'body-fixed' && contact.bodyId === bodyId
			);
			const representative = fixedContacts[0];
			runtime.terminalReason =
				bodyIds.size === 1 && representative
					? {
							type: 'resting-contact',
							time: component.time,
							colliderId: representative.colliderId,
							position: bodies[0]!.position,
							normal: representative.normal,
							contacts: fixedContacts.map((contact) => {
								const supportIndex = support.contacts.indexOf(contact);
								const impact = resultByContact.get(contact.id)!;
								return {
									colliderId: contact.colliderId,
									feature: contact.candidate.feature,
									contactPoint: contact.contactPoint,
									normal: contact.normal,
									preImpactNormalVelocity: impact.preImpactNormalVelocity,
									postImpactNormalVelocity: impact.postImpactNormalVelocity,
									impulse: impact.impulse,
									supportReaction: support.reactions[supportIndex]!
								};
							}),
							supportReactions: fixedContacts.map(
								(contact) => support.reactions[support.contacts.indexOf(contact)]!
							),
							reason: 'impact-collapse'
						}
					: {
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
	component: ExactTimeComponent
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

function connectedStationaryGroups(
	bodyIds: ReadonlySet<string>,
	contacts: readonly ActiveComponentContact[]
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

function contactBelongsTo(contact: ActiveComponentContact, bodyIds: ReadonlySet<string>): boolean {
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
