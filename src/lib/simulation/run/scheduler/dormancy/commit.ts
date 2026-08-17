import type { ContactComponentRecord } from '../../../contracts';
import {
	certifySupportEquilibrium,
	type ExactTimeContactState,
	type SupportReactionSolution
} from '../../contact-resolution';
import { invalidateLocalPrediction } from '../predictions';
import type { SchedulerState } from '../types';
import {
	dormantContactRecord,
	futureEventTimes,
	restingComponentId,
	upsertDynamicContacts
} from './records';

export function commitCertifiedRestingComponent(
	state: SchedulerState,
	component: ExactTimeContactState,
	support: SupportReactionSolution
): ContactComponentRecord {
	const bodyIds = component.bodies.map(({ id }) => id).sort();
	const previousRevision = Math.max(
		-1,
		...state.contactComponents
			.filter((record) => record.bodyIds.some((bodyId) => bodyIds.includes(bodyId)))
			.map((record) => record.revision ?? 0)
	);
	const revision = previousRevision + 1;
	const id = restingComponentId(component.time, bodyIds, revision);
	upsertDynamicContacts(
		state,
		support.contacts.map((contact, index) =>
			dormantContactRecord(component, contact, support.reactions[index]!)
		)
	);
	const record: ContactComponentRecord = {
		id,
		type: 'resting-anchored',
		createdAtTime: component.time,
		dissolvedAtTime: null,
		bodyIds,
		fixedColliderIds: [
			...new Set(
				support.contacts.flatMap((contact) =>
					contact.type === 'body-fixed' ? [contact.colliderId] : []
				)
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
	state.componentEvents.push({
		type: 'contact-component-lifecycle',
		time: component.time,
		change: 'created',
		componentIds: [],
		resultingComponentIds: [id]
	});
	for (const body of component.bodies) {
		const runtime = state.runtimes.get(body.id)!;
		runtime.dormantComponentId = id;
		runtime.state = {
			...runtime.state,
			time: component.time,
			position: body.position,
			velocity: [0, 0]
		};
		runtime.terminalReason = {
			type: 'no-future-event',
			time: component.time,
			detail: `Body belongs to certified dormant contact component ${id}.`
		};
		invalidateLocalPrediction(
			state,
			body.id,
			`Invalidated because ${id} became dormant at time ${component.time}.`
		);
	}
	return record;
}

export function restoreRestingComponent(
	state: SchedulerState,
	component: ExactTimeContactState
): ContactComponentRecord | null {
	const support = certifySupportEquilibrium(
		component.bodies,
		component.contacts,
		state.input.settings.gravity,
		Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256)
	);
	if (support) return commitCertifiedRestingComponent(state, component, support);
	for (const body of component.bodies) {
		state.runtimes.get(body.id)!.dormantComponentId = null;
	}
	return null;
}
