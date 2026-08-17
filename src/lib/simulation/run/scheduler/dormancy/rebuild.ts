import type { ContactComponentRecord } from '../../../contracts';
import { type ExactTimeContactState, type ResolvedContactState } from '../../contact-resolution';
import type { SchedulerState } from '../types';
import { planDormantComponents, type BodyVelocityResponse } from './planning';
import { futureEventTimes, restingComponentId, retainedDormantContactId } from './records';

export function rebuildDormantComponents(
	state: SchedulerState,
	resolvedContacts: ResolvedContactState,
	response: BodyVelocityResponse,
	tolerance: number
): ReadonlySet<string> {
	const component = resolvedContacts.eventState;
	const previous = retireOverlappingDormantComponents(state, component);
	const plans = planDormantComponents(state, resolvedContacts, response, tolerance);
	const created: ContactComponentRecord[] = [];
	for (const plan of plans) {
		const retainedContactIds = plan.support.contacts.map((contact, index) =>
			retainedDormantContactId(state, component, contact, plan.support.reactions[index]!)
		);
		const revision = previous.length
			? Math.max(...previous.map((record) => record.revision ?? 0)) + 1
			: 0;
		const id = restingComponentId(component.time, [...plan.bodyIds], plan.groupIndex + revision);
		const record: ContactComponentRecord = {
			id,
			type: 'resting-anchored',
			createdAtTime: component.time,
			dissolvedAtTime: null,
			bodyIds: [...plan.bodyIds].sort(),
			fixedColliderIds: [
				...new Set(
					plan.contacts
						.filter((contact) => contact.type === 'body-fixed')
						.map((contact) => contact.colliderId)
				)
			].sort(),
			activeContactIds: retainedContactIds,
			retainedSupportReactions: retainedContactIds.map((contactId, index) => ({
				contactId,
				impulsePerTime: plan.support.reactions[index]!
			})),
			revision,
			futureScheduledEventTimes: futureEventTimes(state, component.time)
		};
		state.contactComponents.push(record);
		created.push(record);
		for (const bodyId of plan.bodyIds) {
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
