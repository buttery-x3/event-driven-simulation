import type { ContactComponentRecord, RunTerminalReason } from '../../../contracts';
import { invalidateLocalPrediction } from '../predictions';
import type { SchedulerState } from '../types';
import type { ActiveComponentContact } from '../pairs/component';
import { buildStationaryContactComponents } from '../pairs/component';
import { certifySupportEquilibrium } from './support-equilibrium';
import { dormantContactRecord, futureEventTimes, restingComponentId } from './records';

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
	const supportReactions = certifiedSingleBodyReactions(
		state,
		bodyId,
		reason,
		contacts,
		contactIds
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
			impulsePerTime: supportReactions[index] ?? 0
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

function certifiedSingleBodyReactions(
	state: SchedulerState,
	bodyId: string,
	reason: Extract<RunTerminalReason, { readonly type: 'resting-contact' }>,
	contacts: NonNullable<
		Extract<RunTerminalReason, { readonly type: 'resting-contact' }>['contacts']
	>,
	contactIds: readonly string[]
): readonly number[] {
	if (reason.supportReactions?.length === contacts.length) return reason.supportReactions;
	const body = state.input.initialDynamicBodies.find(({ id }) => id === bodyId)!;
	const componentContacts: ActiveComponentContact[] = contacts.map((contact, index) => ({
		type: 'body-fixed',
		id: contactIds[index]!,
		bodyId,
		colliderId: contact.colliderId,
		normal: contact.normal,
		contactPoint: contact.contactPoint,
		candidate: {
			type: 'contact-candidate',
			bodyId,
			colliderId: contact.colliderId,
			colliderKind:
				state.input.scene.staticColliders.find(({ id }) => id === contact.colliderId)?.physicalShape
					.type === 'circle'
					? 'circle'
					: 'boundary',
			feature: contact.feature as never,
			time: reason.time,
			position: reason.position,
			contactPoint: contact.contactPoint,
			normal: contact.normal,
			normalVelocity: 0,
			response: 'non-impulsive-contact'
		}
	}));
	return (
		certifySupportEquilibrium(
			[
				{
					id: body.id,
					mass: body.mass,
					radius: body.physicalShape.radius,
					position: reason.position,
					velocity: [0, 0],
					prefixSegment: null
				}
			],
			componentContacts,
			state.input.settings.gravity,
			Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256)
		)?.reactions ?? contacts.map(() => 0)
	);
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
			makeBodyDormant(state, time, id, body, support.contacts, support.reactions);
		}
	}
}

function makeBodyDormant(
	state: SchedulerState,
	time: number,
	componentId: string,
	body: ReturnType<typeof buildStationaryContactComponents>[number]['bodies'][number],
	contacts: readonly ActiveComponentContact[],
	reactions: readonly number[]
): void {
	const runtime = state.runtimes.get(body.id)!;
	runtime.dormantComponentId = componentId;
	const fixedContacts = contacts.filter(
		(contact): contact is Extract<ActiveComponentContact, { readonly type: 'body-fixed' }> =>
			contact.type === 'body-fixed' && contact.bodyId === body.id
	);
	const representative = fixedContacts[0];
	if (representative) {
		const contactDetails = fixedContacts.map((contact) => ({
			colliderId: contact.colliderId,
			feature: contact.candidate.feature,
			contactPoint: contact.contactPoint,
			normal: contact.normal,
			preImpactNormalVelocity: 0,
			postImpactNormalVelocity: 0,
			impulse: 0
		}));
		runtime.events.push({
			type: 'contact',
			time,
			bodyId: body.id,
			colliderId: representative.colliderId,
			position: body.position,
			normal: representative.normal,
			preContactVelocity: [0, 0],
			postContactVelocity: [0, 0],
			contacts: contactDetails
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
			contacts: contactDetails
		});
	}
	runtime.terminalReason = representative
		? {
				type: 'resting-contact',
				time,
				colliderId: representative.colliderId,
				position: body.position,
				normal: representative.normal,
				contacts: fixedContacts.map((contact) => ({
					colliderId: contact.colliderId,
					feature: contact.candidate.feature,
					contactPoint: contact.contactPoint,
					normal: contact.normal,
					preImpactNormalVelocity: 0,
					postImpactNormalVelocity: 0,
					impulse: 0,
					supportReaction: reactions[contacts.indexOf(contact)]!
				})),
				supportReactions: fixedContacts.map((contact) => reactions[contacts.indexOf(contact)]!),
				reason: 'zero-tangential-motion'
			}
		: {
				type: 'no-future-event',
				time,
				detail: `Body belongs to certified dormant contact component ${componentId}.`
			};
	runtime.state = { ...runtime.state, time, position: body.position, velocity: [0, 0] };
	invalidateLocalPrediction(
		state,
		body.id,
		`Invalidated because ${componentId} became dormant at time ${time}.`
	);
}
