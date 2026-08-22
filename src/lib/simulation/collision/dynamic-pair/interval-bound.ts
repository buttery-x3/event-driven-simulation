import type { MotionSegment } from '../../contracts';
import { evaluateMotionSegmentVelocity } from '../../motion';
import { dynamicPairSurfaceSeparation } from './contact-polynomial';
import type {
	DynamicCirclePathParticipant,
	DynamicPairContactQuery,
	DynamicPairContactTolerances
} from './types';

export interface SearchInterval {
	readonly start: number;
	readonly end: number;
	readonly startSeparation: number;
	readonly endSeparation: number;
}

export interface SeparationSample {
	readonly time: number;
	readonly separation: number;
}

/**
 * Conservative Lipschitz speed bound for one synchronized pair over a sub-interval.
 * Circular energy and local kinematic caps are both valid; the tighter one is used.
 */
export function intervalRelativeSpeedBound(
	first: DynamicCirclePathParticipant,
	second: DynamicCirclePathParticipant,
	start: number,
	end: number
): number {
	return pathSpeedBound(first.path, start, end) + pathSpeedBound(second.path, start, end);
}

export function intervalCertifiesSeparation(
	middleSeparation: number,
	relativeSpeedBound: number,
	halfWidth: number,
	contactDistance: number
): boolean {
	return middleSeparation - relativeSpeedBound * halfWidth > contactDistance;
}

export function splitSearchInterval(
	interval: SearchInterval,
	middleTime: number,
	middleSeparation: number
): { readonly earlier: SearchInterval; readonly later: SearchInterval } {
	return {
		earlier: {
			start: interval.start,
			end: middleTime,
			startSeparation: interval.startSeparation,
			endSeparation: middleSeparation
		},
		later: {
			start: middleTime,
			end: interval.end,
			startSeparation: middleSeparation,
			endSeparation: interval.endSeparation
		}
	};
}

export function earliestEnteringBracket(
	start: SeparationSample,
	middle: SeparationSample,
	end: SeparationSample,
	contactDistance: number
): readonly [SeparationSample, SeparationSample] | null {
	if (start.separation > contactDistance && middle.separation <= 0) return [start, middle];
	if (middle.separation > contactDistance && end.separation <= 0) return [middle, end];
	return null;
}

export function refineEnteringRoot(
	query: DynamicPairContactQuery,
	leftSeed: SeparationSample,
	rightSeed: SeparationSample,
	tolerances: DynamicPairContactTolerances,
	maximumIterations: number
): SeparationSample & { readonly iterations: number } {
	let left = leftSeed;
	let right = rightSeed;
	let iterations = 0;
	while (
		iterations < maximumIterations &&
		right.time - left.time > tolerances.eventTime &&
		Math.abs(right.separation) > tolerances.contactDistance
	) {
		const time = (left.time + right.time) / 2;
		const separation = pairSeparation(query, time);
		if (separation > 0) left = { time, separation };
		else right = { time, separation };
		iterations += 1;
	}
	return Math.abs(left.separation) < Math.abs(right.separation)
		? { ...left, iterations }
		: { ...right, iterations };
}

export function pairSeparation(query: DynamicPairContactQuery, time: number): number {
	return dynamicPairSurfaceSeparation(query.first, query.second, time);
}

export function laterSeparatedRemainder(
	query: DynamicPairContactQuery,
	interval: SearchInterval,
	rootTime: number,
	bracketRightTime: number,
	tolerances: DynamicPairContactTolerances
): SearchInterval | null {
	let start = Math.min(interval.end, Math.max(rootTime + tolerances.eventTime, bracketRightTime));
	if (start >= interval.end) return null;
	let startSeparation = pairSeparation(query, start);
	for (
		let probe = 0;
		probe < 8 && start < interval.end && startSeparation <= tolerances.contactDistance;
		probe += 1
	) {
		start = (start + interval.end) / 2;
		startSeparation = pairSeparation(query, start);
	}
	if (!(start < interval.end) || startSeparation <= tolerances.contactDistance) return null;
	return {
		start,
		end: interval.end,
		startSeparation,
		endSeparation: interval.endSeparation
	};
}

function pathSpeedBound(path: MotionSegment, start: number, end: number): number {
	if (path.type === 'stationary') return 0;
	const duration = Math.max(0, end - start);
	if (path.type === 'circular-contact') {
		const gravity = Math.hypot(...path.gravity);
		const kinematic =
			Math.abs(path.startTangentialSpeed) + gravity * Math.max(0, end - path.startTime);
		const energy = Math.sqrt(
			Math.max(0, path.startTangentialSpeed ** 2 + 4 * gravity * path.contactRadius)
		);
		return Math.min(kinematic, energy);
	}
	return (
		Math.hypot(...evaluateMotionSegmentVelocity(path, start)) +
		Math.hypot(...path.acceleration) * duration
	);
}
