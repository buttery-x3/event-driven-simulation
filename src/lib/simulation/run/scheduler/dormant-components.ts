import type {
	ContactComponentRecord,
	DynamicContactRecord,
	RunTerminalReason
} from '../../contracts';
import type { SchedulerState } from './types';
import { invalidateLocalPrediction } from './predictions';
import type { ActiveComponentContact, ExactTimeComponent } from './pairs/component';
import { buildStationaryContactComponents } from './pairs/component';
import type { CoupledImpactResponse } from '../dynamic-impact';
import { certifySupportEquilibrium } from './support-equilibrium';

export function registerSingleBodyDormancy(
	state: SchedulerState,
	bodyId: string,
	reason: Extract<RunTerminalReason, { readonly type: 'resting-contact' }>
): void {
	const runtime = state.runtimes.get(bodyId)!;
	if (runtime.dormantComponentId) return;
	const contacts = reason.contacts ?? [
		{
			colliderId: reason.colliderId,
			feature: 'resting-contact',
			contactPoint: reason.position,
			normal: reason.normal,
			preImpactNormalVelocity: 0,
			postImpactNormalVelocity: 0,
			impulse: 0
		}
	];
	const componentId = restingComponentId(reason.time, [bodyId], 0);
	const contactIds = contacts.map(
		(contact, index) => `support-contact:${bodyId}:${contact.colliderId}:${reason.time}:${index}`
	);
	for (let index = 0; index < contacts.length; index += 1) {
		const contact = contacts[index]!;
		state.dynamicContacts.push({
			id: contactIds[index]!,
			time: reason.time,
			participants: [
				{ type: 'fixed-collider', colliderId: contact.colliderId },
				{ type: 'body', bodyId }
			],
			contactPoint: contact.contactPoint,
			normalFromFirstToSecond: contact.normal,
			preImpactNormalVelocity: contact.preImpactNormalVelocity,
			postImpactNormalVelocity: contact.postImpactNormalVelocity,
			impulse: contact.impulse,
			state: 'retained'
		});
	}
	const record: ContactComponentRecord = {
		id: componentId,
		type: 'resting-anchored',
		createdAtTime: reason.time,
		dissolvedAtTime: null,
		bodyIds: [bodyId],
		fixedColliderIds: [...new Set(contacts.map(({ colliderId }) => colliderId))].sort(),
		activeContactIds: contactIds,
		retainedSupportReactions: contactIds.map((contactId, index) => ({
			contactId,
			impulsePerTime: reason.supportReactions?.[index] ?? 0
		})),
		revision: 0,
		futureScheduledEventTimes: futureEventTimes(state, reason.time)
	};
	state.contactComponents.push(record);
	state.componentEvents.push({
		type: 'contact-component-lifecycle',
		time: reason.time,
		change: 'created',
		componentIds: [],
		resultingComponentIds: [componentId]
	});
	runtime.dormantComponentId = componentId;
}

export function promoteStationaryContactComponents(state: SchedulerState, time: number): void {
	const tolerance = Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256);
	for (const component of buildStationaryContactComponents(state, time)) {
		const support = certifySupportEquilibrium(
			component.bodies,
			component.contacts,
			state.input.settings.gravity,
			tolerance
		);
		if (!support) continue;
		const id = restingComponentId(
			time,
			component.bodies.map(({ id: bodyId }) => bodyId),
			0
		);
		for (const contact of support.contacts) {
			state.dynamicContacts.push(dormantContactRecord(component, contact, 0));
		}
		const record: ContactComponentRecord = {
			id,
			type: 'resting-anchored',
			createdAtTime: time,
			dissolvedAtTime: null,
			bodyIds: component.bodies.map(({ id: bodyId }) => bodyId).sort(),
			fixedColliderIds: [
				...new Set(
					support.contacts
						.filter((contact) => contact.type === 'body-fixed')
						.map((contact) => contact.colliderId)
				)
			].sort(),
			activeContactIds: support.contacts.map(({ id: contactId }) => contactId),
			retainedSupportReactions: support.contacts.map(({ id: contactId }, index) => ({
				contactId,
				impulsePerTime: support.reactions[index]!
			})),
			revision: 0,
			futureScheduledEventTimes: futureEventTimes(state, time)
		};
		state.contactComponents.push(record);
		state.componentEvents.push({
			type: 'contact-component-lifecycle',
			time,
			change: 'created',
			componentIds: [],
			resultingComponentIds: [id]
		});
		for (const body of component.bodies) {
			const runtime = state.runtimes.get(body.id)!;
			runtime.dormantComponentId = id;
			const fixedContacts = support.contacts.filter(
				(contact): contact is Extract<ActiveComponentContact, { readonly type: 'body-fixed' }> =>
					contact.type === 'body-fixed' && contact.bodyId === body.id
			);
			const representative = fixedContacts[0];
			if (representative) {
				runtime.events.push({
					type: 'contact',
					time,
					bodyId: body.id,
					colliderId: representative.colliderId,
					position: body.position,
					normal: representative.normal,
					preContactVelocity: [0, 0],
					postContactVelocity: [0, 0],
					contacts: fixedContacts.map((contact) => ({
						colliderId: contact.colliderId,
						feature: contact.candidate.feature,
						contactPoint: contact.contactPoint,
						normal: contact.normal,
						preImpactNormalVelocity: 0,
						postImpactNormalVelocity: 0,
						impulse: 0
					}))
				});
				runtime.events.push({
					type: 'contact-mode-transition',
					time,
					bodyId: body.id,
					colliderId: representative.colliderId,
					from: 'free-flight',
					to: 'resting',
					reason: 'supported-initial-state',
					position: body.position,
					normal: representative.normal,
					contacts: fixedContacts.map((contact) => ({
						colliderId: contact.colliderId,
						feature: contact.candidate.feature,
						contactPoint: contact.contactPoint,
						normal: contact.normal,
						preImpactNormalVelocity: 0,
						postImpactNormalVelocity: 0,
						impulse: 0
					}))
				});
			}
			runtime.terminalReason = representative
				? {
						type: 'resting-contact',
						time,
						colliderId: representative.colliderId,
						position: body.position,
						normal: representative.normal,
						contacts: fixedContacts.map((contact) => {
							const reactionIndex = support.contacts.indexOf(contact);
							return {
								colliderId: contact.colliderId,
								feature: contact.candidate.feature,
								contactPoint: contact.contactPoint,
								normal: contact.normal,
								preImpactNormalVelocity: 0,
								postImpactNormalVelocity: 0,
								impulse: 0,
								supportReaction: support.reactions[reactionIndex]!
							};
						}),
						supportReactions: fixedContacts.map(
							(contact) => support.reactions[support.contacts.indexOf(contact)]!
						),
						reason: 'zero-tangential-motion'
					}
				: {
						type: 'no-future-event',
						time,
						detail: `Body belongs to certified dormant contact component ${id}.`
					};
			runtime.state = { ...runtime.state, time, position: body.position, velocity: [0, 0] };
			invalidateLocalPrediction(
				state,
				body.id,
				`Invalidated because ${id} became dormant at time ${time}.`
			);
		}
	}
}

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
			.filter(({ id }) => {
				const velocity = velocityByBody.get(id)!;
				return Math.hypot(...velocity) <= tolerance;
			})
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

function futureEventTimes(state: SchedulerState, time: number): readonly number[] {
	return [
		...new Set(
			state.scheduled.map(({ releaseTime }) => releaseTime).filter((value) => value >= time)
		)
	].sort((left, right) => left - right);
}

function restingComponentId(time: number, bodyIds: readonly string[], revision: number): string {
	return `resting-component:${time}:${[...bodyIds].sort().join('+')}:r${revision}`;
}

export function dormantContactRecord(
	component: ExactTimeComponent,
	contact: ActiveComponentContact,
	reaction: number
): DynamicContactRecord {
	const normal = contact.type === 'body-body' ? contact.normalFromFirstToSecond : contact.normal;
	return {
		id: contact.id,
		time: component.time,
		participants:
			contact.type === 'body-body'
				? [
						{ type: 'body', bodyId: contact.firstBodyId },
						{ type: 'body', bodyId: contact.secondBodyId }
					]
				: [
						{ type: 'fixed-collider', colliderId: contact.colliderId },
						{ type: 'body', bodyId: contact.bodyId }
					],
		contactPoint: contact.contactPoint,
		normalFromFirstToSecond: normal,
		preImpactNormalVelocity: 0,
		postImpactNormalVelocity: 0,
		impulse: reaction,
		state: 'retained'
	};
}

export function upsertDynamicContacts(
	state: SchedulerState,
	contacts: readonly DynamicContactRecord[]
): void {
	for (const contact of contacts) {
		const index = state.dynamicContacts.findIndex(({ id }) => id === contact.id);
		if (index >= 0) state.dynamicContacts[index] = contact;
		else state.dynamicContacts.push(contact);
	}
}
