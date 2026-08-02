import type { CircleCircleContactQuery, CircleCircleContactTolerances } from './types';

export function validateCircleCircleContactQuery(
	query: CircleCircleContactQuery,
	tolerances: CircleCircleContactTolerances
): string | null {
	const segment = query.segment;
	if (segment.bodyId.trim().length === 0 || query.circle.id.trim().length === 0)
		return 'Body and fixed-circle IDs must be non-empty.';
	if (
		!Number.isFinite(segment.startTime) ||
		!Number.isFinite(segment.endTime) ||
		segment.endTime <= segment.startTime
	)
		return 'The motion segment must have finite times and end after it starts.';
	if (
		![
			...segment.startPosition,
			...segment.startVelocity,
			...segment.acceleration,
			...query.circle.centre
		].every(Number.isFinite)
	)
		return 'Motion and fixed-circle coordinates must contain finite numbers.';
	if (!Number.isFinite(query.ballRadius) || query.ballRadius <= 0)
		return 'The ball radius must be a positive finite number.';
	if (
		query.circle.motionAuthority !== 'static' ||
		query.circle.physicalShape.type !== 'circle' ||
		!Number.isFinite(query.circle.physicalShape.radius) ||
		query.circle.physicalShape.radius <= 0
	)
		return 'The collider must be a fixed circle with a positive finite radius.';
	if (
		!Number.isFinite(query.searchUntilTime) ||
		query.searchUntilTime <= segment.startTime ||
		query.searchUntilTime > segment.endTime
	)
		return 'The search horizon must be after the segment start and no later than its end.';
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
