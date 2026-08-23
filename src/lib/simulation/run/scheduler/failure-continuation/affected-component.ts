import type { EntityId } from '../../../contracts';
import type { SchedulerState } from '../types';

export function expandAffectedBodies(
	state: SchedulerState,
	seedBodyIds: readonly EntityId[]
): readonly EntityId[] {
	const affected = new Set(seedBodyIds);
	let changed = true;
	while (changed) {
		changed = false;
		for (const support of state.dynamicSupports.values()) {
			const members = [support.movingBodyId, support.supportBodyId, ...support.anchoredBodyIds];
			if (!members.some((bodyId) => affected.has(bodyId))) continue;
			for (const bodyId of members) {
				if (affected.has(bodyId)) continue;
				affected.add(bodyId);
				changed = true;
			}
		}
		for (const component of state.contactComponents) {
			if (component.dissolvedAtTime !== null) continue;
			if (!component.bodyIds.some((bodyId) => affected.has(bodyId))) continue;
			if (
				component.type === 'resting-anchored' &&
				component.bodyIds.every((id) => !seedBodyIds.includes(id))
			) {
				continue;
			}
			for (const bodyId of component.bodyIds) {
				if (affected.has(bodyId)) continue;
				affected.add(bodyId);
				changed = true;
			}
		}
	}
	return [...affected].sort();
}

export function coupledFreezeBodies(
	state: SchedulerState,
	invalidatedBodyIds: readonly EntityId[]
): readonly EntityId[] {
	return expandAffectedBodies(state, invalidatedBodyIds).filter(
		(bodyId) => !hasRepresentedContinuation(state, bodyId)
	);
}

export function hasRepresentedContinuation(state: SchedulerState, bodyId: EntityId): boolean {
	const runtime = state.runtimes.get(bodyId);
	if (!runtime) return false;
	if (runtime.dormantComponentId) return true;
	return [...state.dynamicSupports.values()].some(({ movingBodyId }) => movingBodyId === bodyId);
}

export function pairFailureBodies(
	state: SchedulerState,
	bodyIds: readonly [EntityId, EntityId]
): readonly EntityId[] {
	return expandAffectedBodies(state, bodyIds);
}

export function localFailureBodies(state: SchedulerState, bodyId: EntityId): readonly EntityId[] {
	return expandAffectedBodies(state, [bodyId]);
}
