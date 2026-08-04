import type { ContactComponentRecord, Vec2 } from '../../../contracts';
import { dotVec2 } from '../../../math';
import type { CoupledImpactResponse } from '../../dynamic-impact';
import type { ActiveComponentContact, ExactTimeComponent } from '../pairs/component';
import type { SchedulerState } from '../types';
import { refreshDynamicSupportPrediction } from './prediction';
import type { DynamicSupportRuntime } from './types';

export function admitCertifiedDynamicSupports(
	state: SchedulerState,
	component: ExactTimeComponent,
	response: CoupledImpactResponse,
	tolerance: number
): ReadonlySet<string> {
	const admitted = new Set<string>();
	const results = new Map(response.contacts.map((contact) => [contact.contactId, contact]));
	const velocityByBody = new Map(
		response.bodyVelocities.map((body) => [body.bodyId, body.velocity])
	);
	const candidates = component.contacts.filter(
		(contact): contact is Extract<ActiveComponentContact, { readonly type: 'body-body' }> =>
			contact.type === 'body-body' &&
			(results.get(contact.id)?.postImpactNormalVelocity ?? Number.POSITIVE_INFINITY) <= tolerance
	);
	for (const contact of candidates) {
		const firstDormant = activeAnchoredComponent(state, contact.firstBodyId);
		const secondDormant = activeAnchoredComponent(state, contact.secondBodyId);
		if (Boolean(firstDormant) === Boolean(secondDormant)) continue;
		const anchor = firstDormant ?? secondDormant!;
		const supportBodyId = firstDormant ? contact.firstBodyId : contact.secondBodyId;
		const movingBodyId = firstDormant ? contact.secondBodyId : contact.firstBodyId;
		if ([...state.dynamicSupports.values()].some((item) => item.movingBodyId === movingBodyId))
			continue;
		const movingVelocity = velocityByBody.get(movingBodyId)!;
		if (Math.hypot(...movingVelocity) <= tolerance) continue;
		const normal = normalFromSupport(contact, supportBodyId);
		const tangent: Vec2 = [-normal[1], normal[0]];
		const signedSpeed = dotVec2(movingVelocity, tangent);
		if (Math.abs(signedSpeed) <= tolerance) continue;
		const anchoredBodyIds = anchor.bodyIds;
		const anchoredBodies = component.bodies.filter(({ id }) => anchoredBodyIds.includes(id));
		const anchoredContacts = component.contacts.filter(
			(candidate) =>
				anchor.activeContactIds.includes(candidate.id) &&
				(candidate.type === 'body-fixed'
					? anchoredBodyIds.includes(candidate.bodyId)
					: anchoredBodyIds.includes(candidate.firstBodyId) &&
						anchoredBodyIds.includes(candidate.secondBodyId))
		);
		if (anchoredBodies.length !== anchoredBodyIds.length || anchoredContacts.length === 0) continue;
		const id = `dynamic-support:${component.time}:${movingBodyId}->${supportBodyId}`;
		const runtime: DynamicSupportRuntime = {
			id,
			contactId: contact.id,
			movingBodyId,
			supportBodyId,
			componentId: id,
			anchoredBodyIds: [...anchoredBodyIds].sort(),
			anchoredBodies,
			anchoredContacts,
			time: component.time,
			position: component.bodies.find(({ id: bodyId }) => bodyId === movingBodyId)!.position,
			normal,
			direction: signedSpeed > 0 ? 1 : -1,
			tangentialSpeed: Math.abs(signedSpeed)
		};
		state.dynamicSupports.set(id, runtime);
		const prediction = refreshDynamicSupportPrediction(state, runtime);
		if (!prediction) {
			state.dynamicSupports.delete(id);
			continue;
		}
		retireAnchoredComponent(state, anchor, component.time);
		const supportSolution = prediction.startReaction.support!;
		const record: ContactComponentRecord = {
			id,
			type: 'dynamic-sustained-support',
			createdAtTime: component.time,
			dissolvedAtTime: null,
			bodyIds: [...new Set([...anchoredBodyIds, movingBodyId])].sort(),
			fixedColliderIds: anchor.fixedColliderIds,
			activeContactIds: [
				contact.id,
				...supportSolution.contacts.map(({ id: contactId }) => contactId)
			].sort(),
			retainedSupportReactions: supportSolution.contacts.map(({ id: contactId }, index) => ({
				contactId,
				impulsePerTime: supportSolution.reactions[index]!
			})),
			revision: (anchor.revision ?? 0) + 1,
			futureScheduledEventTimes: anchor.futureScheduledEventTimes,
			dynamicSupport: {
				movingBodyId,
				supportBodyId,
				anchoredBodyIds: [...anchoredBodyIds].sort(),
				bodyBodyContactId: contact.id
			}
		};
		state.contactComponents.push(record);
		state.componentEvents.push({
			type: 'contact-component-lifecycle',
			time: component.time,
			change: 'created',
			componentIds: [],
			resultingComponentIds: [id]
		});
		for (const bodyId of anchoredBodyIds) {
			const bodyRuntime = state.runtimes.get(bodyId)!;
			bodyRuntime.dormantComponentId = id;
		}
		const movingRuntime = state.runtimes.get(movingBodyId)!;
		movingRuntime.state = {
			...movingRuntime.state,
			velocity: [tangent[0] * signedSpeed, tangent[1] * signedSpeed]
		};
		movingRuntime.terminalReason = null;
		movingRuntime.events.push({
			type: 'contact-mode-transition',
			time: component.time,
			bodyId: movingBodyId,
			colliderId: supportBodyId,
			supportingBodyId: supportBodyId,
			from: 'impact',
			to: 'sliding',
			reason: 'impact-collapse',
			position: runtime.position,
			normal
		});
		state.predictions.delete(movingBodyId);
		admitted.add(contact.id);
	}
	return admitted;
}

function activeAnchoredComponent(
	state: SchedulerState,
	bodyId: string
): ContactComponentRecord | null {
	return (
		state.contactComponents.find(
			(record) =>
				record.type === 'resting-anchored' &&
				record.dissolvedAtTime === null &&
				record.bodyIds.includes(bodyId)
		) ?? null
	);
}

function normalFromSupport(
	contact: Extract<ActiveComponentContact, { readonly type: 'body-body' }>,
	supportBodyId: string
): Vec2 {
	return supportBodyId === contact.firstBodyId
		? contact.normalFromFirstToSecond
		: [-contact.normalFromFirstToSecond[0], -contact.normalFromFirstToSecond[1]];
}

function retireAnchoredComponent(
	state: SchedulerState,
	record: ContactComponentRecord,
	time: number
): void {
	const index = state.contactComponents.indexOf(record);
	state.contactComponents[index] = { ...record, dissolvedAtTime: time };
	state.componentEvents.push({
		type: 'contact-component-lifecycle',
		time,
		change: 'dissolved',
		componentIds: [record.id],
		resultingComponentIds: []
	});
}
