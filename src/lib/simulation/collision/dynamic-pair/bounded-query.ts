import type { MotionSegment } from '../../contracts';
import { evaluateMotionSegmentVelocity } from '../../motion';
import { dynamicPairSurfaceSeparation, evaluateDynamicPairCandidate } from './contact-polynomial';
import type {
	DynamicPairCandidateClassification,
	DynamicPairContactCandidateDiagnostic,
	DynamicPairContactDiagnostics,
	DynamicPairContactQuery,
	DynamicPairContactQueryResult,
	DynamicPairContactTolerances
} from './types';

interface SearchInterval {
	readonly start: number;
	readonly end: number;
	readonly startSeparation: number;
	readonly endSeparation: number;
}

const maximumIsolationIntervals = 65_536;

/**
 * Isolates contacts involving a circular sustained path by recursively excluding
 * time intervals with a conservative relative-speed bound. This is a bounded
 * continuous query: render frames and temporal advancement never participate.
 */
export function findEarliestBoundedDynamicPairContact(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	initialDiagnostics: DynamicPairContactDiagnostics
): DynamicPairContactQueryResult {
	const searchStart = initialDiagnostics.searchInterval[0];
	const searchEnd = initialDiagnostics.searchInterval[1];
	const initialSeparation = separationAt(query, searchStart);
	if (!Number.isFinite(initialSeparation)) {
		return unresolved(
			'The synchronized circular pair geometry was not finite.',
			initialDiagnostics
		);
	}
	if (initialSeparation < -tolerances.contactDistance) {
		return invalid(
			'The shared path interval starts with the bodies penetrating.',
			initialDiagnostics
		);
	}

	const candidates: DynamicPairContactCandidateDiagnostic[] = [];
	const initialResult = resolveInitialBoundary(
		query,
		tolerances,
		initialDiagnostics,
		initialSeparation,
		candidates
	);
	if (initialResult) return initialResult;
	if (searchEnd === searchStart) {
		return { type: 'no-contact', diagnostics: { ...initialDiagnostics, candidates } };
	}

	const relativeSpeedBound =
		pathSpeedBound(query.first.path, searchStart, searchEnd) +
		pathSpeedBound(query.second.path, searchStart, searchEnd);
	if (!Number.isFinite(relativeSpeedBound)) {
		return unresolved('A finite circular-path relative-speed bound could not be established.', {
			...initialDiagnostics,
			candidates
		});
	}
	const isolationTimeTolerance = Math.min(
		tolerances.eventTime,
		tolerances.contactDistance / Math.max(relativeSpeedBound, Number.EPSILON)
	);

	const stack: SearchInterval[] = [
		{
			start: searchStart,
			end: searchEnd,
			startSeparation: initialSeparation,
			endSeparation: separationAt(query, searchEnd)
		}
	];
	let isolationIntervals = 0;
	let refinementIterations = 0;
	let lastCandidateTime = Number.NEGATIVE_INFINITY;
	while (stack.length > 0) {
		if (isolationIntervals >= maximumIsolationIntervals) {
			return unresolved('Circular pair root isolation exceeded its deterministic interval bound.', {
				...initialDiagnostics,
				refinementIterations,
				candidates
			});
		}
		isolationIntervals += 1;
		const interval = stack.pop()!;
		if (![interval.startSeparation, interval.endSeparation].every(Number.isFinite)) {
			return unresolved('Circular pair interval geometry was not finite.', {
				...initialDiagnostics,
				refinementIterations,
				candidates
			});
		}
		const middle = (interval.start + interval.end) / 2;
		const middleSeparation = separationAt(query, middle);
		if (!Number.isFinite(middleSeparation)) {
			return unresolved('Circular pair midpoint geometry was not finite.', {
				...initialDiagnostics,
				refinementIterations,
				candidates
			});
		}
		const halfWidth = (interval.end - interval.start) / 2;
		if (middleSeparation - relativeSpeedBound * halfWidth > tolerances.contactDistance) continue;

		if (interval.end - interval.start > isolationTimeTolerance) {
			stack.push({
				start: middle,
				end: interval.end,
				startSeparation: middleSeparation,
				endSeparation: interval.endSeparation
			});
			stack.push({
				start: interval.start,
				end: middle,
				startSeparation: interval.startSeparation,
				endSeparation: middleSeparation
			});
			continue;
		}

		const samples = [
			{ time: interval.start, separation: interval.startSeparation },
			{ time: middle, separation: middleSeparation },
			{ time: interval.end, separation: interval.endSeparation }
		];
		const bracketIndex = samples.findIndex(
			(sample, index) =>
				index < samples.length - 1 && sample.separation > 0 && samples[index + 1]!.separation <= 0
		);
		if (bracketIndex < 0) {
			const closest = [...samples].sort(
				(left, right) => Math.abs(left.separation) - Math.abs(right.separation)
			)[0]!;
			if (Math.abs(closest.separation) > tolerances.contactDistance) {
				return unresolved('A bounded circular interval could not certify contact or separation.', {
					...initialDiagnostics,
					refinementIterations,
					candidates
				});
			}
			const closestState = stateAt(query, closest.time, tolerances);
			if (!closestState) {
				return unresolved('A bounded circular candidate had indeterminate geometry.', {
					...initialDiagnostics,
					refinementIterations,
					candidates
				});
			}
			const classification = classifyVelocity(closestState.relativeNormalMotion, tolerances);
			if (closest.time - lastCandidateTime > tolerances.eventTime) {
				candidates.push(
					candidate(
						query,
						closest.time,
						closest.separation,
						closestState.relativeNormalMotion,
						classification,
						[interval.start, interval.end],
						0,
						classification === 'rejected-grazing' ? 'grazing' : 'indeterminate'
					)
				);
				lastCandidateTime = closest.time;
			}
			if (classification === 'accepted-impact') {
				return contactResult(closestState, candidates, initialDiagnostics, refinementIterations);
			}
			if (classification === 'accepted-non-impulsive') {
				return unresolved(
					'Circular pair contact had indeterminate persistent zero-normal motion.',
					{
						...initialDiagnostics,
						refinementIterations,
						candidates
					}
				);
			}
			continue;
		}

		const refined = refineEnteringRoot(
			query,
			samples[bracketIndex]!,
			samples[bracketIndex + 1]!,
			tolerances,
			query.maximumRefinementIterations ?? 128
		);
		refinementIterations += refined.iterations;
		const rootState = stateAt(query, refined.time, tolerances);
		if (!rootState || Math.abs(refined.separation) > tolerances.contactDistance) {
			return unresolved('A bounded circular root could not be refined within geometry tolerance.', {
				...initialDiagnostics,
				refinementIterations,
				candidates
			});
		}
		const classification = classifyVelocity(rootState.relativeNormalMotion, tolerances);
		candidates.push(
			candidate(
				query,
				refined.time,
				refined.separation,
				rootState.relativeNormalMotion,
				classification,
				[interval.start, interval.end],
				refined.iterations,
				classification === 'accepted-impact' ? 'entering' : 'indeterminate'
			)
		);
		lastCandidateTime = refined.time;
		if (classification === 'accepted-impact') {
			return contactResult(rootState, candidates, initialDiagnostics, refinementIterations);
		}
	}

	return noContactResult(initialDiagnostics, candidates, refinementIterations);
}

function resolveInitialBoundary(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	diagnostics: DynamicPairContactDiagnostics,
	initialSeparation: number,
	candidates: DynamicPairContactCandidateDiagnostic[]
): DynamicPairContactQueryResult | null {
	if (initialSeparation > tolerances.contactDistance) return null;
	const searchStart = diagnostics.searchInterval[0];
	const boundary = stateAt(query, searchStart, tolerances);
	if (!boundary)
		return unresolved('Initial circular pair geometry was indeterminate.', diagnostics);
	const classification = classifyVelocity(boundary.relativeNormalMotion, tolerances);
	candidates.push(
		candidate(
			query,
			searchStart,
			initialSeparation,
			boundary.relativeNormalMotion,
			classification,
			[searchStart, searchStart],
			0,
			'initial-contact'
		)
	);
	if (classification !== 'accepted-impact' && classification !== 'accepted-non-impulsive') {
		return null;
	}
	return {
		type: 'contact',
		state: {
			...boundary,
			response: classification === 'accepted-impact' ? 'impact' : 'non-impulsive-contact'
		},
		diagnostics: { ...diagnostics, candidates }
	};
}

function noContactResult(
	diagnostics: DynamicPairContactDiagnostics,
	candidates: readonly DynamicPairContactCandidateDiagnostic[],
	refinementIterations: number
): DynamicPairContactQueryResult {
	return {
		type: 'no-contact',
		diagnostics: {
			...diagnostics,
			refinementIterations,
			isolatedRoots: candidates.map(({ normalizedTime }) => normalizedTime),
			candidates
		}
	};
}

function refineEnteringRoot(
	query: DynamicPairContactQuery,
	leftSeed: { readonly time: number; readonly separation: number },
	rightSeed: { readonly time: number; readonly separation: number },
	tolerances: DynamicPairContactTolerances,
	maximumIterations: number
): { readonly time: number; readonly separation: number; readonly iterations: number } {
	let left = leftSeed;
	let right = rightSeed;
	let iterations = 0;
	while (
		iterations < maximumIterations &&
		right.time - left.time > tolerances.eventTime &&
		Math.abs(right.separation) > tolerances.contactDistance
	) {
		const time = (left.time + right.time) / 2;
		const separation = separationAt(query, time);
		if (separation > 0) left = { time, separation };
		else right = { time, separation };
		iterations += 1;
	}
	return Math.abs(left.separation) < Math.abs(right.separation)
		? { ...left, iterations }
		: { ...right, iterations };
}

function pathSpeedBound(path: MotionSegment, start: number, end: number): number {
	if (path.type === 'stationary') return 0;
	if (path.type === 'circular-contact') {
		return Math.sqrt(
			Math.max(
				0,
				path.startTangentialSpeed ** 2 + 4 * Math.hypot(...path.gravity) * path.contactRadius
			)
		);
	}
	if (path.type === 'accumulation-tail') {
		const duration = path.endTime - path.startTime;
		const chordSpeed =
			duration > 0
				? (3 *
						Math.hypot(
							path.endPosition[0] - path.startPosition[0],
							path.endPosition[1] - path.startPosition[1]
						)) /
					duration
				: 0;
		return chordSpeed + 2 * Math.hypot(...path.startVelocity) + 2 * Math.hypot(...path.endVelocity);
	}
	return (
		Math.hypot(...evaluateMotionSegmentVelocity(path, start)) +
		Math.hypot(...path.acceleration) * (end - start)
	);
}

function classifyVelocity(
	relativeNormalMotion: number,
	tolerances: DynamicPairContactTolerances
): DynamicPairCandidateClassification {
	if (relativeNormalMotion < -tolerances.normalVelocity) return 'accepted-impact';
	if (relativeNormalMotion > tolerances.normalVelocity) return 'rejected-exiting';
	return 'rejected-grazing';
}

function candidate(
	query: DynamicPairContactQuery,
	time: number,
	separation: number,
	relativeNormalMotion: number,
	classification: DynamicPairCandidateClassification,
	interval: readonly [number, number],
	refinementIterations: number,
	topology: DynamicPairContactCandidateDiagnostic['topology']
): DynamicPairContactCandidateDiagnostic {
	const [searchStart, searchEnd] = [
		Math.max(query.currentTime, query.first.path.startTime, query.second.path.startTime),
		Math.min(query.first.path.endTime, query.second.path.endTime)
	];
	const duration = searchEnd - searchStart;
	return {
		normalizedTime: duration === 0 ? 0 : (time - searchStart) / duration,
		time,
		polynomialResidual: 0,
		geometryResidual: Math.abs(separation),
		relativeNormalMotion,
		source: interval[0] === interval[1] ? 'boundary' : 'bounded-interval',
		isolatingInterval:
			duration === 0
				? [0, 0]
				: [(interval[0] - searchStart) / duration, (interval[1] - searchStart) / duration],
		refinementIterations,
		topology,
		beforeRegion: topology === 'entering' ? 'separated' : null,
		afterRegion: topology === 'entering' ? 'overlapping' : null,
		classification
	};
}

function stateAt(
	query: DynamicPairContactQuery,
	time: number,
	tolerances: DynamicPairContactTolerances
) {
	return evaluateDynamicPairCandidate(query.first, query.second, time, tolerances.contactDistance);
}

function separationAt(query: DynamicPairContactQuery, time: number): number {
	return dynamicPairSurfaceSeparation(query.first, query.second, time);
}

function contactResult(
	state: NonNullable<ReturnType<typeof stateAt>>,
	candidates: readonly DynamicPairContactCandidateDiagnostic[],
	diagnostics: DynamicPairContactDiagnostics,
	refinementIterations: number
): DynamicPairContactQueryResult {
	return {
		type: 'contact',
		state: { ...state, response: 'impact' },
		diagnostics: {
			...diagnostics,
			refinementIterations,
			isolatedRoots: candidates.map(({ normalizedTime }) => normalizedTime),
			candidates
		}
	};
}

function invalid(
	reason: string,
	diagnostics: DynamicPairContactDiagnostics
): DynamicPairContactQueryResult {
	return { type: 'invalid-input', reason, diagnostics };
}

function unresolved(
	reason: string,
	diagnostics: DynamicPairContactDiagnostics
): DynamicPairContactQueryResult {
	return { type: 'unresolved', reason, diagnostics };
}
