import type { DynamicContactRecord } from '../../../contracts';
import type { ExactContact, ExactTimeContactState } from '../../contact-resolution';
import type { SchedulerState } from '../types';

export function futureEventTimes(state: SchedulerState, time: number): readonly number[] {
	return [
		...new Set(
			state.scheduled.map(({ releaseTime }) => releaseTime).filter((value) => value >= time)
		)
	].sort((left, right) => left - right);
}

export function restingComponentId(
	time: number,
	bodyIds: readonly string[],
	revision: number
): string {
	return `resting-component:${time}:${[...bodyIds].sort().join('+')}:r${revision}`;
}

export function dormantContactRecord(
	component: ExactTimeContactState,
	contact: ExactContact,
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
