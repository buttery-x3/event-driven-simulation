import { evaluateDynamicPairCandidate } from './contact-polynomial';
import {
	earliestEnteringBracket,
	intervalCertifiesSeparation,
	intervalRelativeSpeedBound,
	laterSeparatedRemainder,
	pairSeparation,
	refineEnteringRoot,
	splitSearchInterval,
	type SearchInterval,
	type SeparationSample
} from './interval-bound';
import type {
	DynamicPairCandidateClassification,
	DynamicPairContactCandidateDiagnostic,
	DynamicPairContactDiagnostics,
	DynamicPairContactQuery,
	DynamicPairContactQueryResult,
	DynamicPairContactTolerances
} from './types';

type IntervalDecision =
	| { readonly type: 'discard'; readonly refinementIterations: number }
	| { readonly type: 'contact'; readonly result: DynamicPairContactQueryResult }
	| { readonly type: 'unresolved'; readonly reason: string; readonly refinementIterations: number }
	| {
			readonly type: 'subdivide';
			readonly earlier: SearchInterval;
			readonly later: SearchInterval;
			readonly refinementIterations: number;
	  }
	| {
			readonly type: 'search-after';
			readonly remainder: SearchInterval;
			readonly refinementIterations: number;
	  };

const defaultMaximumIsolationIntervals = 65_536;

/**
 * Isolates contacts involving a circular sustained path by recursively excluding
 * time intervals with a conservative relative-speed bound. Uncertain intervals
 * remain search work; eventTime is the selected-root accuracy, not an abort floor.
 */
export function findEarliestBoundedDynamicPairContact(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	initialDiagnostics: DynamicPairContactDiagnostics
): DynamicPairContactQueryResult {
	const searchStart = initialDiagnostics.searchInterval[0];
	const searchEnd = initialDiagnostics.searchInterval[1];
	const initialSeparation = pairSeparation(query, searchStart);
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

	const stack: SearchInterval[] = [
		{
			start: searchStart,
			end: searchEnd,
			startSeparation: initialSeparation,
			endSeparation: pairSeparation(query, searchEnd)
		}
	];
	const isolationBudget = query.maximumIsolationIntervals ?? defaultMaximumIsolationIntervals;
	let isolationIntervals = 0;
	let refinementIterations = 0;
	while (stack.length > 0) {
		if (isolationIntervals >= isolationBudget) {
			return unresolved('Circular pair root isolation exceeded its deterministic interval bound.', {
				...initialDiagnostics,
				refinementIterations,
				candidates
			});
		}
		isolationIntervals += 1;
		const decision = examineInterval(
			query,
			tolerances,
			initialDiagnostics,
			stack.pop()!,
			candidates,
			refinementIterations
		);
		if (decision.type === 'contact') return decision.result;
		refinementIterations = decision.refinementIterations;
		if (decision.type === 'unresolved') {
			return unresolved(decision.reason, {
				...initialDiagnostics,
				refinementIterations,
				candidates
			});
		}
		if (decision.type === 'discard') continue;
		if (decision.type === 'search-after') {
			stack.push(decision.remainder);
			continue;
		}
		stack.push(decision.later);
		stack.push(decision.earlier);
	}

	return noContactResult(initialDiagnostics, candidates, refinementIterations);
}

function examineInterval(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	diagnostics: DynamicPairContactDiagnostics,
	interval: SearchInterval,
	candidates: DynamicPairContactCandidateDiagnostic[],
	refinementIterations: number
): IntervalDecision {
	if (![interval.startSeparation, interval.endSeparation].every(Number.isFinite)) {
		return {
			type: 'unresolved',
			reason: 'Circular pair interval geometry was not finite.',
			refinementIterations
		};
	}
	if (interval.end <= interval.start) return { type: 'discard', refinementIterations };
	if (interval.startSeparation <= 0 && interval.endSeparation <= 0) {
		return { type: 'discard', refinementIterations };
	}

	const middleTime = (interval.start + interval.end) / 2;
	const middleSeparation = pairSeparation(query, middleTime);
	if (!Number.isFinite(middleSeparation)) {
		return {
			type: 'unresolved',
			reason: 'Circular pair midpoint geometry was not finite.',
			refinementIterations
		};
	}
	const relativeSpeedBound = intervalRelativeSpeedBound(
		query.first,
		query.second,
		interval.start,
		interval.end
	);
	if (!Number.isFinite(relativeSpeedBound)) {
		return {
			type: 'unresolved',
			reason: 'A finite circular-path relative-speed bound could not be established.',
			refinementIterations
		};
	}
	const halfWidth = (interval.end - interval.start) / 2;
	if (
		intervalCertifiesSeparation(
			middleSeparation,
			relativeSpeedBound,
			halfWidth,
			tolerances.contactDistance
		)
	) {
		return { type: 'discard', refinementIterations };
	}

	const start = { time: interval.start, separation: interval.startSeparation };
	const middle = { time: middleTime, separation: middleSeparation };
	const end = { time: interval.end, separation: interval.endSeparation };
	const bracket = earliestEnteringBracket(start, middle, end, tolerances.contactDistance);
	if (bracket) {
		return refineBracketedInterval(
			query,
			tolerances,
			diagnostics,
			interval,
			bracket,
			candidates,
			refinementIterations
		);
	}

	if (!(middleTime > interval.start && middleTime < interval.end)) {
		return terminalUncertainInterval(
			query,
			tolerances,
			diagnostics,
			interval,
			[start, middle, end],
			candidates,
			refinementIterations
		);
	}
	return splitIntervalDecision(interval, middleTime, middleSeparation, refinementIterations);
}

function refineBracketedInterval(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	diagnostics: DynamicPairContactDiagnostics,
	interval: SearchInterval,
	bracket: readonly [SeparationSample, SeparationSample],
	candidates: DynamicPairContactCandidateDiagnostic[],
	refinementIterations: number
): IntervalDecision {
	const refined = refineEnteringRoot(
		query,
		bracket[0],
		bracket[1],
		tolerances,
		query.maximumRefinementIterations ?? 128
	);
	const totalRefinement = refinementIterations + refined.iterations;
	const rootState = stateAt(query, refined.time, tolerances);
	if (!rootState || Math.abs(refined.separation) > tolerances.contactDistance) {
		const middleTime = (interval.start + interval.end) / 2;
		if (!(middleTime > interval.start && middleTime < interval.end)) {
			return {
				type: 'unresolved',
				reason: 'A bounded circular root could not be refined within geometry tolerance.',
				refinementIterations: totalRefinement
			};
		}
		return splitIntervalDecision(
			interval,
			middleTime,
			pairSeparation(query, middleTime),
			totalRefinement
		);
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
	if (classification === 'accepted-impact') {
		return {
			type: 'contact',
			result: contactResult(rootState, candidates, diagnostics, totalRefinement)
		};
	}
	if (classification === 'accepted-non-impulsive') {
		return {
			type: 'unresolved',
			reason: 'Circular pair contact had indeterminate persistent zero-normal motion.',
			refinementIterations: totalRefinement
		};
	}
	const remainder = laterSeparatedRemainder(
		query,
		interval,
		refined.time,
		bracket[1].time,
		tolerances
	);
	if (!remainder) return { type: 'discard', refinementIterations: totalRefinement };
	return {
		type: 'search-after',
		remainder,
		refinementIterations: totalRefinement
	};
}

function terminalUncertainInterval(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	diagnostics: DynamicPairContactDiagnostics,
	interval: SearchInterval,
	samples: readonly SeparationSample[],
	candidates: DynamicPairContactCandidateDiagnostic[],
	refinementIterations: number
): IntervalDecision {
	const closest = [...samples].sort(
		(left, right) => Math.abs(left.separation) - Math.abs(right.separation)
	)[0]!;
	if (Math.abs(closest.separation) > tolerances.contactDistance) {
		return {
			type: 'unresolved',
			reason: 'A bounded circular interval could not make further numerical progress.',
			refinementIterations
		};
	}
	const closestState = stateAt(query, closest.time, tolerances);
	if (!closestState) {
		return {
			type: 'unresolved',
			reason: 'A bounded circular candidate had indeterminate geometry.',
			refinementIterations
		};
	}
	const classification = classifyVelocity(closestState.relativeNormalMotion, tolerances);
	candidates.push(
		candidate(
			query,
			closest.time,
			closest.separation,
			closestState.relativeNormalMotion,
			classification,
			[interval.start, interval.end],
			0,
			classification === 'accepted-impact' ? 'entering' : 'indeterminate'
		)
	);
	if (classification === 'accepted-impact') {
		return {
			type: 'contact',
			result: contactResult(closestState, candidates, diagnostics, refinementIterations)
		};
	}
	return {
		type: 'unresolved',
		reason: 'A bounded circular interval could not make further numerical progress.',
		refinementIterations
	};
}

function splitIntervalDecision(
	interval: SearchInterval,
	middleTime: number,
	middleSeparation: number,
	refinementIterations: number
): IntervalDecision {
	return {
		type: 'subdivide',
		...splitSearchInterval(interval, middleTime, middleSeparation),
		refinementIterations
	};
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
