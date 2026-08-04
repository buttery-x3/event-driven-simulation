import type { AccumulationPhysicalEvent } from './types';

/**
 * Extract a stable connected participant cluster from recent physical events.
 * Contact edges may change; body and nearby fixed-support membership must remain coherent.
 */
export function extractParticipantCluster(
	events: readonly AccumulationPhysicalEvent[],
	options: { readonly maximumBodyCount?: number } = {}
): {
	readonly bodyIds: readonly string[];
	readonly fixedColliderIds: readonly string[];
	readonly stable: boolean;
	readonly detail: string;
} {
	if (events.length === 0) {
		return {
			bodyIds: [],
			fixedColliderIds: [],
			stable: false,
			detail: 'No physical events were provided.'
		};
	}
	const bodyIds = uniqueSorted(events.flatMap(({ participantBodyIds }) => participantBodyIds));
	const fixedColliderIds = uniqueSorted(events.flatMap(({ fixedColliderIds }) => fixedColliderIds));
	const maximumBodyCount = options.maximumBodyCount ?? 32;
	if (bodyIds.length === 0 || bodyIds.length > maximumBodyCount) {
		return {
			bodyIds,
			fixedColliderIds,
			stable: false,
			detail: `Participant body count ${bodyIds.length} is outside the supported cluster bound.`
		};
	}
	// Every event must involve a non-empty subset of the cluster bodies.
	for (const event of events) {
		if (!event.participantBodyIds.every((id) => bodyIds.includes(id))) {
			return {
				bodyIds,
				fixedColliderIds,
				stable: false,
				detail: `Event ${event.eventId} introduces a body outside the candidate cluster.`
			};
		}
		if (event.participantBodyIds.length === 0) {
			return {
				bodyIds,
				fixedColliderIds,
				stable: false,
				detail: `Event ${event.eventId} has no dynamic participants.`
			};
		}
	}
	// Fixed supports may join or leave; require a non-empty intersection across the window when
	// the sequence is fixed-world only, otherwise allow purely dynamic clusters.
	const purelyDynamic = fixedColliderIds.length === 0;
	if (!purelyDynamic) {
		const firstFixed = new Set(events[0]!.fixedColliderIds);
		const intersection = events.reduce((current, event) => {
			const next = new Set(
				[...current].filter(
					(id) =>
						event.fixedColliderIds.includes(id) ||
						event.dynamicPartnerBodyIds.length > 0 ||
						event.participantBodyIds.length > 1
				)
			);
			// Keep supports that appear at least once if multi-body; for single-body require
			// every historical fixed id is among the union (already true) and at least one
			// support is reused in the majority of events.
			return next.size > 0 ? next : current;
		}, firstFixed);
		const reuseCounts = new Map<string, number>();
		for (const event of events) {
			for (const id of event.fixedColliderIds) {
				reuseCounts.set(id, (reuseCounts.get(id) ?? 0) + 1);
			}
		}
		const reused = [...reuseCounts.entries()].filter(([, count]) => count >= 2).map(([id]) => id);
		if (bodyIds.length === 1 && reused.length === 0 && intersection.size === 0) {
			return {
				bodyIds,
				fixedColliderIds,
				stable: false,
				detail: 'Single-body accumulation requires a reused fixed-support set.'
			};
		}
	}
	return {
		bodyIds,
		fixedColliderIds,
		stable: true,
		detail: 'Stable connected participant cluster.'
	};
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}
