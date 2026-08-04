import type { AccumulationConnectedComponent, AccumulationLimitContact } from './types';

/**
 * Decompose the limiting contact graph into connected components through shared dynamic bodies.
 */
export function decomposeLimitComponents(
	bodyIds: readonly string[],
	contacts: readonly AccumulationLimitContact[],
	time: number
): readonly AccumulationConnectedComponent[] {
	const adjacency = new Map<string, Set<string>>();
	for (const bodyId of bodyIds) adjacency.set(bodyId, new Set());
	for (const contact of contacts) {
		if (contact.type === 'body-body' && contact.secondBodyId) {
			adjacency.get(contact.bodyId)?.add(contact.secondBodyId);
			adjacency.get(contact.secondBodyId)?.add(contact.bodyId);
		}
	}
	const remaining = new Set(bodyIds);
	const components: AccumulationConnectedComponent[] = [];
	let index = 0;
	while (remaining.size > 0) {
		const seed = [...remaining].sort()[0]!;
		const group = new Set<string>([seed]);
		remaining.delete(seed);
		const queue = [seed];
		while (queue.length > 0) {
			const current = queue.pop()!;
			for (const neighbour of adjacency.get(current) ?? []) {
				if (!remaining.delete(neighbour)) continue;
				group.add(neighbour);
				queue.push(neighbour);
			}
		}
		// Attach singleton bodies that share only fixed contacts as their own components.
		const groupContacts = contacts.filter(
			(contact) =>
				group.has(contact.bodyId) ||
				(contact.secondBodyId !== null && group.has(contact.secondBodyId))
		);
		const fixedColliderIds = [
			...new Set(
				groupContacts.map(({ colliderId }) => colliderId).filter((id): id is string => id !== null)
			)
		].sort();
		components.push({
			id: `accumulation-component:${time}:${index}:${[...group].sort().join('+')}`,
			bodyIds: [...group].sort(),
			contactIds: groupContacts.map(({ id }) => id).sort(),
			fixedColliderIds
		});
		index += 1;
	}
	return components;
}
