import type { EntityId, RunTerminalReason } from '../../../contracts';
import type { LocalBodyPrediction } from '../../single-ball/local-events';
import type { DynamicSupportPrediction } from '../dynamic-support/types';
import type { PairContactSelection } from '../pairs/selection';
import type { SchedulerState } from '../types';
import type { SelectedEventIdentity } from './types';

export function pairEventIdentity(
	_state: SchedulerState,
	selection: PairContactSelection & {
		readonly simultaneousContacts: readonly PairContactSelection[];
	}
): SelectedEventIdentity {
	const bodyIds = connectedBodyIds(selection);
	return {
		time: selection.time,
		source: 'body-pair',
		bodyIds,
		topology: `component:${bodyIds.join('+')}`
	};
}

function connectedBodyIds(
	selection: PairContactSelection & {
		readonly simultaneousContacts: readonly PairContactSelection[];
	}
): readonly string[] {
	const pairs = [selection, ...selection.simultaneousContacts].map((contact) => [
		contact.first.bodyId,
		contact.second.bodyId
	]);
	const ids = new Set([selection.first.bodyId, selection.second.bodyId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const [first, second] of pairs) {
			if (!ids.has(first) && !ids.has(second)) continue;
			if (!ids.has(first)) {
				ids.add(first);
				changed = true;
			}
			if (!ids.has(second)) {
				ids.add(second);
				changed = true;
			}
		}
	}
	return [...ids].sort();
}

export function localEventIdentity(
	_state: SchedulerState,
	selected: readonly LocalBodyPrediction[]
): SelectedEventIdentity {
	const bodyIds = uniqueSorted(selected.map(({ bodyId }) => bodyId));
	return {
		time: selected[0]?.time ?? _state.worldTime,
		source: 'local',
		bodyIds,
		topology: selected
			.map((prediction) => `${prediction.bodyId}:${prediction.eventType}:${prediction.kind}`)
			.sort()
			.join('|')
	};
}

export function dynamicSupportEventIdentity(
	state: SchedulerState,
	prediction: DynamicSupportPrediction
): SelectedEventIdentity {
	const support = state.dynamicSupports.get(prediction.supportId);
	const bodyIds = uniqueSorted(
		support ? [support.movingBodyId, support.supportBodyId, ...support.anchoredBodyIds] : []
	);
	return {
		time: prediction.segment.endTime,
		source: 'dynamic-support',
		bodyIds,
		topology: prediction.supportId
	};
}

export function eventIdentityKey(identity: SelectedEventIdentity): string {
	return `${identity.source}|${identity.time}|${identity.bodyIds.join(',')}|${identity.topology}`;
}

export function isEquivalentEvent(
	left: SelectedEventIdentity | null,
	right: SelectedEventIdentity | null
): boolean {
	if (!left || !right) return false;
	return (
		left.time === right.time &&
		left.source === right.source &&
		left.topology === right.topology &&
		sameList(left.bodyIds, right.bodyIds)
	);
}

export function zeroTimeLoopReason(time: number, colliderId: EntityId): RunTerminalReason {
	return {
		type: 'zero-time-loop',
		time,
		colliderId,
		detail: 'The scheduler selected an equivalent event without intervening state progression.'
	};
}

function uniqueSorted(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort();
}

function sameList(
	left: readonly number[] | readonly string[],
	right: readonly number[] | readonly string[]
): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
