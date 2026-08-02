import type {
	AxisAlignedTerminationRegion,
	BoardBounds,
	MotionSegment,
	RunTerminalReason,
	Vec2
} from '../../contracts';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';

interface TerminationEntry {
	readonly time: number;
	readonly reason: Extract<
		RunTerminalReason,
		{ type: 'completion-region' | 'escape-region' | 'bounds-escape' }
	>;
}

export type TerminationSearchResult =
	| { readonly type: 'entry'; readonly entry: TerminationEntry }
	| { readonly type: 'none' }
	| { readonly type: 'numerical-failure'; readonly detail: string };

export function findEarliestTerminationEntry(
	segment: MotionSegment,
	regions: readonly AxisAlignedTerminationRegion[],
	bounds: BoardBounds,
	searchUntilTime: number,
	tolerance: number,
	eventTimeTolerance: number
): TerminationSearchResult {
	const candidates: TerminationEntry[] = [];
	const duration = searchUntilTime - segment.startTime;

	for (const region of regions) {
		if (contains(region, segment.startPosition, tolerance)) {
			candidates.push({
				time: segment.startTime,
				reason: terminationReason(region, segment.startTime)
			});
			continue;
		}

		const boundaries = [
			{ axis: 0 as const, value: region.minimum[0] },
			{ axis: 0 as const, value: region.maximum[0] },
			{ axis: 1 as const, value: region.minimum[1] },
			{ axis: 1 as const, value: region.maximum[1] }
		];

		for (const boundary of boundaries) {
			const roots = solveCoordinateCrossings(
				0.5 * segment.acceleration[boundary.axis],
				segment.startVelocity[boundary.axis],
				segment.startPosition[boundary.axis] - boundary.value
			);
			if (roots === null) {
				return {
					type: 'numerical-failure',
					detail: `Termination-region crossing for ${region.id} could not be solved numerically.`
				};
			}

			for (const elapsed of roots) {
				if (elapsed < 0 || elapsed > duration) continue;
				const time = segment.startTime + elapsed;
				const position = evaluateMotionSegmentPosition(segment, time);
				if (!isFiniteVec2(position)) {
					return {
						type: 'numerical-failure',
						detail: `Termination-region crossing state for ${region.id} was not finite.`
					};
				}
				if (contains(region, position, tolerance)) {
					candidates.push({ time, reason: terminationReason(region, time) });
				}
			}
		}
	}

	const boundsCandidates = findBoundsExitCandidates(
		segment,
		bounds,
		searchUntilTime,
		eventTimeTolerance
	);
	if (boundsCandidates === null) {
		return {
			type: 'numerical-failure',
			detail: 'Supported-bounds crossings could not be solved numerically.'
		};
	}
	candidates.push(...boundsCandidates);

	candidates.sort(
		(left, right) =>
			left.time - right.time ||
			Number(left.reason.type !== 'completion-region') -
				Number(right.reason.type !== 'completion-region') ||
			terminationKey(left.reason).localeCompare(terminationKey(right.reason))
	);

	return candidates[0] ? { type: 'entry', entry: candidates[0] } : { type: 'none' };
}

export function findContainingRegion(
	regions: readonly AxisAlignedTerminationRegion[],
	position: Vec2,
	tolerance: number
): AxisAlignedTerminationRegion | null {
	return (
		[...regions]
			.filter((region) => contains(region, position, tolerance))
			.sort(
				(left, right) =>
					Number(left.purpose === 'escape') - Number(right.purpose === 'escape') ||
					left.id.localeCompare(right.id)
			)[0] ?? null
	);
}

export function terminationReason(
	region: AxisAlignedTerminationRegion,
	time: number
): Extract<RunTerminalReason, { type: 'completion-region' | 'escape-region' }> {
	return region.purpose === 'complete'
		? { type: 'completion-region', regionId: region.id, time }
		: { type: 'escape-region', regionId: region.id, time };
}

function solveCoordinateCrossings(a: number, b: number, c: number): readonly number[] | null {
	if (![a, b, c].every(Number.isFinite)) return null;
	if (a === 0) {
		if (b === 0) return [];
		const root = -c / b;
		return Number.isFinite(root) ? [root] : null;
	}

	const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
	if (scale === 0) return [];
	const normalizedA = a / scale;
	const normalizedB = b / scale;
	const normalizedC = c / scale;
	const discriminant = normalizedB * normalizedB - 4 * normalizedA * normalizedC;
	if (!Number.isFinite(discriminant)) return null;
	if (discriminant < 0) return [];

	const squareRoot = Math.sqrt(discriminant);
	const q = -0.5 * (normalizedB + (normalizedB < 0 ? -squareRoot : squareRoot));
	if (q === 0) {
		const root = -normalizedB / (2 * normalizedA);
		return Number.isFinite(root) ? [root] : null;
	}

	const first = q / normalizedA;
	const second = normalizedC / q;
	return [first, second].filter(Number.isFinite).sort((left, right) => left - right);
}

function findBoundsExitCandidates(
	segment: MotionSegment,
	bounds: BoardBounds,
	searchUntilTime: number,
	eventTimeTolerance: number
): readonly TerminationEntry[] | null {
	const duration = searchUntilTime - segment.startTime;
	const boundaries = [
		{ axis: 0 as const, value: -bounds.width / 2, boundary: 'left' as const, direction: -1 },
		{ axis: 0 as const, value: bounds.width / 2, boundary: 'right' as const, direction: 1 },
		{ axis: 1 as const, value: 0, boundary: 'bottom' as const, direction: -1 },
		{ axis: 1 as const, value: bounds.height, boundary: 'top' as const, direction: 1 }
	];
	const candidates: TerminationEntry[] = [];

	for (const boundary of boundaries) {
		const roots = solveCoordinateCrossings(
			0.5 * segment.acceleration[boundary.axis],
			segment.startVelocity[boundary.axis],
			segment.startPosition[boundary.axis] - boundary.value
		);
		if (roots === null) return null;

		for (const elapsed of roots) {
			if (elapsed <= eventTimeTolerance || elapsed > duration) continue;
			const time = segment.startTime + elapsed;
			const velocity = evaluateMotionSegmentVelocity(segment, time);
			const outwardSpeed = velocity[boundary.axis] * boundary.direction;
			const outwardAcceleration = segment.acceleration[boundary.axis] * boundary.direction;
			if (
				!isFiniteVec2(velocity) ||
				(outwardSpeed <= eventTimeTolerance && outwardAcceleration <= 0)
			) {
				continue;
			}
			candidates.push({
				time,
				reason: { type: 'bounds-escape', boundary: boundary.boundary, time }
			});
		}
	}

	return candidates;
}

function contains(
	region: AxisAlignedTerminationRegion,
	position: Vec2,
	tolerance: number
): boolean {
	return (
		position[0] >= region.minimum[0] - tolerance &&
		position[0] <= region.maximum[0] + tolerance &&
		position[1] >= region.minimum[1] - tolerance &&
		position[1] <= region.maximum[1] + tolerance
	);
}

function terminationKey(reason: TerminationEntry['reason']): string {
	switch (reason.type) {
		case 'completion-region':
		case 'escape-region':
			return `${reason.type}:${reason.regionId}`;
		case 'bounds-escape':
			return `${reason.type}:${reason.boundary}`;
	}
}

function isFiniteVec2(vector: Vec2): boolean {
	return vector.every(Number.isFinite);
}
