import type { DynamicSupportDiagnostic, Vec2 } from '../../../contracts';
import { certifySupportEquilibrium } from '../../contact-resolution';
import type { SchedulerState } from '../types';
import type {
	DynamicSupportPrediction,
	DynamicSupportReactionState,
	DynamicSupportRuntime
} from './types';

export function createRestingAnchor(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	time: number
): void {
	const solution = certifySupportEquilibrium(
		support.anchoredBodies,
		support.anchoredContacts,
		state.input.settings.gravity,
		supportTolerance(state)
	);
	if (!solution) {
		for (const bodyId of support.anchoredBodyIds)
			state.runtimes.get(bodyId)!.dormantComponentId = null;
		return;
	}
	const revision = nextDynamicSupportRevision(state, support);
	const id = `resting-component:${time}:${support.anchoredBodyIds.join('+')}:r${revision}`;
	state.contactComponents.push({
		id,
		type: 'resting-anchored',
		createdAtTime: time,
		dissolvedAtTime: null,
		bodyIds: support.anchoredBodyIds,
		fixedColliderIds: fixedColliderIds(support),
		activeContactIds: solution.contacts.map(({ id: contactId }) => contactId),
		retainedSupportReactions: reactionRecords(solution),
		revision,
		futureScheduledEventTimes: []
	});
	state.componentEvents.push({
		type: 'contact-component-lifecycle',
		time,
		change: 'created',
		componentIds: [],
		resultingComponentIds: [id]
	});
	for (const bodyId of support.anchoredBodyIds) state.runtimes.get(bodyId)!.dormantComponentId = id;
}

export function createDynamicComponent(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	reaction: DynamicSupportReactionState,
	revision: number
): void {
	const solution = reaction.support!;
	state.contactComponents.push({
		id: support.componentId,
		type: 'dynamic-sustained-support',
		createdAtTime: support.time,
		dissolvedAtTime: null,
		bodyIds: [...new Set([...support.anchoredBodyIds, support.movingBodyId])].sort(),
		fixedColliderIds: fixedColliderIds(support),
		activeContactIds: [support.contactId, ...solution.contacts.map(({ id }) => id)].sort(),
		retainedSupportReactions: reactionRecords(solution),
		revision,
		futureScheduledEventTimes: [],
		dynamicSupport: {
			movingBodyId: support.movingBodyId,
			supportBodyId: support.supportBodyId,
			anchoredBodyIds: support.anchoredBodyIds,
			bodyBodyContactId: support.contactId
		}
	});
	state.componentEvents.push({
		type: 'contact-component-lifecycle',
		time: support.time,
		change: 'created',
		componentIds: [],
		resultingComponentIds: [support.componentId]
	});
	for (const bodyId of support.anchoredBodyIds) {
		state.runtimes.get(bodyId)!.dormantComponentId = support.componentId;
	}
}

export function recordDynamicSupportDiagnostic(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	prediction: DynamicSupportPrediction,
	outcome: DynamicSupportDiagnostic['outcome'],
	releasedContactIds: readonly string[],
	retainedContactIds: readonly string[]
): void {
	state.dynamicSupportDiagnostics.push({
		id: `${support.id}:${prediction.segment.startTime}-${prediction.segment.endTime}`,
		contactId: support.contactId,
		movingBodyId: support.movingBodyId,
		supportBodyId: support.supportBodyId,
		anchoredComponentId: support.componentId,
		anchoredBodyIds: support.anchoredBodyIds,
		interval: [prediction.segment.startTime, prediction.segment.endTime],
		startNormal: prediction.startReaction.normal,
		endNormal: prediction.endReaction.normal,
		startTangentialSpeed: prediction.startReaction.tangentialSpeed,
		endTangentialSpeed: prediction.endReaction.tangentialSpeed,
		startBodyBodyReaction: prediction.startReaction.bodyBodyReaction,
		endBodyBodyReaction: prediction.endReaction.bodyBodyReaction,
		startLoadOnSupport: prediction.startReaction.loadOnSupport,
		endLoadOnSupport: prediction.endReaction.loadOnSupport,
		fixedSupportReactionsAtStart: fixedReactionRecords(prediction.startReaction),
		fixedSupportReactionsAtEnd: fixedReactionRecords(prediction.endReaction),
		outcome,
		retainedContactIds,
		releasedContactIds
	});
}

export function dynamicSupportTransition(
	support: DynamicSupportRuntime,
	time: number,
	position: Vec2,
	normal: Vec2,
	to: 'free-flight' | 'impact',
	reason: 'support-lost' | 'collider-contact' | 'terminal-region'
) {
	return {
		type: 'contact-mode-transition' as const,
		time,
		bodyId: support.movingBodyId,
		colliderId: support.supportBodyId,
		supportingBodyId: support.supportBodyId,
		from: 'sliding' as const,
		to,
		reason,
		position,
		normal
	};
}

export function recordDynamicSupportStep(
	state: SchedulerState,
	prediction: DynamicSupportPrediction
): void {
	state.steps.push({
		worldTime: prediction.segment.endTime,
		bodyId: prediction.movingBodyId,
		revision: prediction.revision,
		eventType:
			prediction.boundary.type === 'contact'
				? 'fixed-contact'
				: prediction.boundary.type === 'terminal'
					? 'termination'
					: prediction.boundary.type === 'unresolved'
						? 'unresolved'
						: 'motion-transition',
		retainedBodyIds: [...state.predictions.keys()].sort()
	});
}

export function retireDynamicSupportComponent(
	state: SchedulerState,
	componentId: string,
	time: number
): void {
	const index = state.contactComponents.findIndex(({ id }) => id === componentId);
	if (index >= 0) {
		state.contactComponents[index] = { ...state.contactComponents[index]!, dissolvedAtTime: time };
	}
	state.componentEvents.push({
		type: 'contact-component-lifecycle',
		time,
		change: 'dissolved',
		componentIds: [componentId],
		resultingComponentIds: []
	});
}

export function releaseDynamicContact(
	state: SchedulerState,
	contactId: string,
	time: number,
	releaseReason: 'impact-separation' | 'support-reaction-zero' | 'interrupted' = 'impact-separation'
): void {
	const index = state.dynamicContacts.findIndex(({ id }) => id === contactId);
	if (index < 0) return;
	state.dynamicContacts[index] = {
		...state.dynamicContacts[index]!,
		time,
		state: 'released',
		releaseReason
	};
}

export function updateTerminalDynamicContact(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	prediction: DynamicSupportPrediction,
	position: Vec2,
	time = prediction.segment.endTime,
	reaction = prediction.endReaction
): void {
	const contactIndex = state.dynamicContacts.findIndex(({ id }) => id === support.contactId);
	if (contactIndex < 0) return;
	const contact = state.dynamicContacts[contactIndex]!;
	const firstParticipant = contact.participants[0];
	const supportIsFirst =
		firstParticipant.type === 'body' && firstParticipant.bodyId === support.supportBodyId;
	const normalFromFirstToSecond: Vec2 = supportIsFirst
		? reaction.normal
		: [-reaction.normal[0], -reaction.normal[1]];
	const movingRuntime = state.runtimes.get(support.movingBodyId)!;
	const movingRadius = movingRuntime.body.physicalShape.radius;
	const participantVelocities: readonly [Vec2, Vec2] = supportIsFirst
		? [[0, 0], movingRuntime.state.velocity]
		: [movingRuntime.state.velocity, [0, 0]];
	state.dynamicContacts[contactIndex] = {
		...contact,
		time,
		contactPoint: [
			position[0] - reaction.normal[0] * movingRadius,
			position[1] - reaction.normal[1] * movingRadius
		],
		normalFromFirstToSecond,
		preImpactNormalVelocity: 0,
		postImpactNormalVelocity: 0,
		preImpactVelocities: participantVelocities,
		postImpactVelocities: participantVelocities,
		impulseOnFirst: [0, 0],
		impulseOnSecond: [0, 0],
		state: 'retained'
	};
}

export function activeDynamicSupportContactIds(
	state: SchedulerState,
	support: DynamicSupportRuntime
): readonly string[] {
	return (
		state.contactComponents.find(({ id }) => id === support.componentId)?.activeContactIds ?? []
	);
}

export function nextDynamicSupportRevision(
	state: SchedulerState,
	support: DynamicSupportRuntime
): number {
	return (
		Math.max(
			0,
			...state.contactComponents
				.filter((record) => record.bodyIds.some((id) => support.anchoredBodyIds.includes(id)))
				.map((record) => record.revision ?? 0)
		) + 1
	);
}

function fixedReactionRecords(reaction: DynamicSupportReactionState) {
	return reaction.support
		? reaction.support.contacts.flatMap((contact, index) =>
				contact.type === 'body-fixed'
					? [{ contactId: contact.id, reaction: reaction.support!.reactions[index]! }]
					: []
			)
		: [];
}

function reactionRecords(solution: NonNullable<DynamicSupportReactionState['support']>) {
	return solution.contacts.map(({ id: contactId }, index) => ({
		contactId,
		impulsePerTime: solution.reactions[index]!
	}));
}

function fixedColliderIds(support: DynamicSupportRuntime): readonly string[] {
	return [
		...new Set(
			support.anchoredContacts.flatMap((contact) =>
				contact.type === 'body-fixed' ? [contact.colliderId] : []
			)
		)
	].sort();
}

function supportTolerance(state: SchedulerState): number {
	return Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256);
}
