import type { BoundaryContactQuery, BoundaryContactTolerances } from './boundary-contact';

export function validateBoundaryContactQuery(
	query: BoundaryContactQuery,
	tolerances: BoundaryContactTolerances
): string | null {
	const segment = query.segment;
	const boundaryShape = query.boundary.physicalShape;
	const finiteVectors = [
		...segment.startPosition,
		...segment.startVelocity,
		...segment.acceleration,
		...boundaryShape.start,
		...boundaryShape.end
	].every(Number.isFinite);

	if (segment.bodyId.trim().length === 0 || query.boundary.id.trim().length === 0) {
		return 'Body and boundary IDs must be non-empty.';
	}
	if (
		!Number.isFinite(segment.startTime) ||
		!Number.isFinite(segment.endTime) ||
		segment.endTime <= segment.startTime
	) {
		return 'The motion segment must have finite times and end after it starts.';
	}
	if (!finiteVectors) {
		return 'Motion and boundary coordinates must contain finite numbers.';
	}
	if (!Number.isFinite(query.ballRadius) || query.ballRadius <= 0) {
		return 'The ball radius must be a positive finite number.';
	}
	if (
		query.boundary.motionAuthority !== 'static' ||
		query.boundary.physicalShape.type !== 'line-segment' ||
		Math.hypot(
			boundaryShape.end[0] - boundaryShape.start[0],
			boundaryShape.end[1] - boundaryShape.start[1]
		) <= tolerances.contactDistance
	) {
		return 'The boundary must be a fixed, non-degenerate line segment.';
	}
	if (
		!Number.isFinite(query.searchUntilTime) ||
		query.searchUntilTime <= segment.startTime ||
		query.searchUntilTime > segment.endTime
	) {
		return 'The search horizon must be after the segment start and no later than its end.';
	}
	if (
		[
			tolerances.contactDistance,
			tolerances.eventTime,
			tolerances.normalVelocity,
			tolerances.polynomialResidual
		].some((tolerance) => !Number.isFinite(tolerance) || tolerance <= 0)
	) {
		return 'Contact, time, velocity and polynomial tolerances must be positive finite numbers.';
	}
	if (
		query.maximumRefinementIterations !== undefined &&
		(!Number.isInteger(query.maximumRefinementIterations) || query.maximumRefinementIterations < 1)
	) {
		return 'The maximum refinement iteration count must be a positive integer.';
	}

	return null;
}
