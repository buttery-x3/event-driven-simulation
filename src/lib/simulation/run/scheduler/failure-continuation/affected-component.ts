import type { EntityId, RunTerminalReason } from '../../../contracts';
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
	seedBodyIds: readonly EntityId[],
	reason: RunTerminalReason
): readonly EntityId[] {
	const seed = reason.type === 'unsupported-body-body-response' ? reason.bodyIds : seedBodyIds;
	return expandAffectedBodies(state, seed);
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
