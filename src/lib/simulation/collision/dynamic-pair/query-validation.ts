import type { DynamicPairContactQuery, DynamicPairContactTolerances } from './types';

export function validateDynamicPairContactQuery(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances
): string | null {
	if (query.first.bodyId.trim().length === 0 || query.second.bodyId.trim().length === 0)
		return 'Both body IDs must be non-empty.';
	if (query.first.bodyId === query.second.bodyId) return 'A body pair must contain two bodies.';
	for (const participant of [query.first, query.second]) {
		if (participant.path.bodyId !== participant.bodyId)
			return 'Each path body ID must match its participant.';
		if (!Number.isInteger(participant.revision) || participant.revision < 0)
			return 'Body revisions must be non-negative integers.';
		if (!Number.isFinite(participant.radius) || participant.radius <= 0)
			return 'Body radii must be positive finite numbers.';
		if (
			!Number.isFinite(participant.path.startTime) ||
			!Number.isFinite(participant.path.endTime) ||
			participant.path.endTime < participant.path.startTime
		)
			return 'Motion paths must have finite non-reversed intervals.';
		if (
			![
				...participant.path.startPosition,
				...participant.path.startVelocity,
				...(participant.path.type === 'stationary' ? [] : participant.path.acceleration)
			].every(Number.isFinite)
		)
			return 'Motion path state must contain finite numbers.';
	}
	if (!Number.isFinite(query.currentTime)) return 'Current world time must be finite.';
	if (
		[
			tolerances.contactDistance,
			tolerances.eventTime,
			tolerances.normalVelocity,
			tolerances.polynomialResidual
		].some((value) => !Number.isFinite(value) || value <= 0)
	)
		return 'Contact, time, velocity and polynomial tolerances must be positive finite numbers.';
	if (
		query.maximumRefinementIterations !== undefined &&
		(!Number.isInteger(query.maximumRefinementIterations) || query.maximumRefinementIterations < 1)
	)
		return 'The maximum refinement iteration count must be a positive integer.';
	return null;
}
