import type { ContactComponentRecord, RunTerminalReason } from '../../../contracts';
import {
	certifySupportEquilibrium,
	classifyPostResponseContacts,
	selectPostContactMode,
	type ExactContact
} from '../../contact-resolution';
import { invalidateLocalPrediction } from '../predictions';
import type { SchedulerState } from '../types';
import { buildStationaryContactComponents } from '../pairs/component';
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
		const resolvedContacts = classifyPostResponseContacts(
			component,
			component.contacts.map((contact) => ({
				contactId: contact.id,
				preResponseNormalVelocity: 0,
				postResponseNormalVelocity: 0,
				impulse: 0,
				retentionEligible: true
			})),
			tolerance
		);
		if (!resolvedContacts) continue;
		const support = certifySupportEquilibrium(
			component.bodies,
			component.contacts,
			state.input.settings.gravity,
			tolerance
		);
		if (!support) continue;
		const mode = selectPostContactMode({
			contacts: resolvedContacts,
			stationaryBodyIds: component.bodies.map(({ id }) => id),
			support
		});
		if (mode.type !== 'resting-anchored') continue;
		const id = restingComponentId(
			time,
			component.bodies.map(({ id: bodyId }) => bodyId),
			0
		);
		for (const contact of mode.support.contacts) {
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
			activeContactIds: mode.support.contacts.map(({ id: contactId }) => contactId),
			retainedSupportReactions: mode.support.contacts.map(({ id: contactId }, index) => ({
				contactId,
				impulsePerTime: mode.support.reactions[index]!
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
			makeBodyDormant(state, time, id, body, mode.support.contacts, mode.support.reactions);
		}
	}
}

function makeBodyDormant(
	state: SchedulerState,
	time: number,
	componentId: string,
	body: ReturnType<typeof buildStationaryContactComponents>[number]['bodies'][number],
	contacts: readonly ExactContact[],
	reactions: readonly number[]
): void {
	const runtime = state.runtimes.get(body.id)!;
	runtime.dormantComponentId = componentId;
	const fixedContacts = contacts.filter(
		(contact): contact is Extract<ExactContact, { readonly type: 'body-fixed' }> =>
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
