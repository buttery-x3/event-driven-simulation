import { evaluateCircularContactState } from '../../../motion';
import type { ExactTimeContactState } from '../../contact-resolution';
import type { SchedulerState } from '../types';
import { evaluateDynamicSupportReaction, invalidateDynamicSupportPrediction } from './prediction';
import { releaseDynamicContact, updateTerminalDynamicContact } from './records';

export function interruptDynamicSupports(
	state: SchedulerState,
	component: ExactTimeContactState
): void {
	const affected = new Set(component.bodies.map(({ id }) => id));
	for (const support of [...state.dynamicSupports.values()]) {
		if (
			!affected.has(support.movingBodyId) &&
			!support.anchoredBodyIds.some((bodyId) => affected.has(bodyId))
		)
			continue;
		const prediction = state.dynamicSupportPredictions.get(support.id);
		if (prediction) {
			const endState = evaluateCircularContactState(prediction.segment, component.time);
			const endReaction = evaluateDynamicSupportReaction(
				state,
				support,
				prediction.seed,
				endState.angle
			);
			state.dynamicSupportDiagnostics.push({
				id: `${support.id}:${prediction.segment.startTime}-${component.time}:interrupted`,
				contactId: support.contactId,
				movingBodyId: support.movingBodyId,
				supportBodyId: support.supportBodyId,
				anchoredComponentId: support.componentId,
				anchoredBodyIds: support.anchoredBodyIds,
				interval: [prediction.segment.startTime, component.time],
				startNormal: prediction.startReaction.normal,
				endNormal: endReaction.normal,
				startTangentialSpeed: prediction.startReaction.tangentialSpeed,
				endTangentialSpeed: endReaction.tangentialSpeed,
				startBodyBodyReaction: prediction.startReaction.bodyBodyReaction,
				endBodyBodyReaction: endReaction.bodyBodyReaction,
				startLoadOnSupport: prediction.startReaction.loadOnSupport,
				endLoadOnSupport: endReaction.loadOnSupport,
				fixedSupportReactionsAtStart: fixedReactions(prediction.startReaction),
				fixedSupportReactionsAtEnd: fixedReactions(endReaction),
				outcome: 'interrupted',
				retainedContactIds: [],
				releasedContactIds: [support.contactId]
			});
			updateTerminalDynamicContact(
				state,
				support,
				prediction,
				endState.position,
				component.time,
				endReaction
			);
		}
		invalidateDynamicSupportPrediction(
			state,
			support.id,
			`Invalidated by exact-time component ${component.id}.`
		);
		releaseDynamicContact(state, support.contactId, component.time, 'interrupted');
		retireComponent(state, support.componentId, component.time);
		for (const bodyId of support.anchoredBodyIds) {
			const runtime = state.runtimes.get(bodyId);
			if (runtime?.dormantComponentId === support.componentId) runtime.dormantComponentId = null;
		}
		state.dynamicSupports.delete(support.id);
	}
}

function fixedReactions(reaction: ReturnType<typeof evaluateDynamicSupportReaction>) {
	return reaction.support
		? reaction.support.contacts.flatMap((contact, index) =>
				contact.type === 'body-fixed'
					? [{ contactId: contact.id, reaction: reaction.support!.reactions[index]! }]
					: []
			)
		: [];
}

function retireComponent(state: SchedulerState, componentId: string, time: number): void {
	const index = state.contactComponents.findIndex(({ id }) => id === componentId);
	if (index >= 0)
		state.contactComponents[index] = { ...state.contactComponents[index]!, dissolvedAtTime: time };
	state.componentEvents.push({
		type: 'contact-component-lifecycle',
		time,
		change: 'dissolved',
		componentIds: [componentId],
		resultingComponentIds: []
	});
}
