import {
	evaluatePolynomial,
	isolatePolynomialRoots,
	type IsolatedPolynomialRoot
} from '../../math';
import {
	classifyCircleCircleRootTopology,
	findToleranceContainedGrazingExit,
	initialContactMotion,
	type CircleCircleRootTopologyEvidence
} from '../circle-circle/root-topology';
import {
	buildDynamicPairContactPolynomial,
	dynamicPairSurfaceSeparation,
	evaluateDynamicPairCandidate
} from './contact-polynomial';
import { validateDynamicPairContactQuery } from './query-validation';
import type {
	DynamicPairCandidateClassification,
	DynamicPairContactCandidateDiagnostic,
	DynamicPairContactDiagnostics,
	DynamicPairContactQuery,
	DynamicPairContactQueryResult,
	DynamicPairContactState,
	DynamicPairContactTolerances
} from './types';

export const defaultDynamicPairContactTolerances = {
	contactDistance: 1e-9,
	eventTime: 1e-9,
	normalVelocity: 1e-9,
	polynomialResidual: 1e-12
} as const satisfies DynamicPairContactTolerances;

const defaultMaximumRefinementIterations = 128;

export function findEarliestDynamicPairContact(
	query: DynamicPairContactQuery
): DynamicPairContactQueryResult {
	const tolerances = query.tolerances ?? defaultDynamicPairContactTolerances;
	const searchStart = Math.max(
		query.currentTime,
		query.first.path.startTime,
		query.second.path.startTime
	);
	const searchEnd = Math.min(query.first.path.endTime, query.second.path.endTime);
	let diagnostics = emptyDiagnostics(query, searchStart, searchEnd);
	const invalidReason = validateDynamicPairContactQuery(query, tolerances);
	if (invalidReason) return invalid(invalidReason, diagnostics);
	if (![searchStart, searchEnd].every(Number.isFinite) || searchEnd < searchStart) {
		return invalid(
			'The shared path validity interval must be finite and non-reversed.',
			diagnostics
		);
	}

	const initialSeparation = dynamicPairSurfaceSeparation(query.first, query.second, searchStart);
	if (!Number.isFinite(initialSeparation)) {
		return unresolved('The synchronized pair geometry was not finite.', diagnostics);
	}
	if (initialSeparation < -tolerances.contactDistance) {
		return invalid('The shared path interval starts with the bodies penetrating.', diagnostics);
	}
	if (searchEnd === searchStart) {
		return resolveExactBoundary(query, tolerances, diagnostics, initialSeparation, searchStart);
	}

	const duration = searchEnd - searchStart;
	const polynomial = buildDynamicPairContactPolynomial(
		query.first,
		query.second,
		searchStart,
		duration
	);
	if (
		!polynomial.polynomialCoefficients.every(Number.isFinite) ||
		!polynomial.relativeCoefficients.flat().every(Number.isFinite)
	) {
		return unresolved('The relative contact polynomial could not be represented as finite.', {
			...diagnostics,
			relativeCoefficients: polynomial.relativeCoefficients
		});
	}
	const coefficients = trimLeadingDegeneracy(polynomial.polynomialCoefficients);
	const polynomialScale = Math.max(...coefficients.map(Math.abs));
	diagnostics = {
		...diagnostics,
		relativeCoefficients: polynomial.relativeCoefficients,
		polynomialCoefficients: coefficients,
		polynomialScale,
		polynomialDegree: coefficients.length - 1
	};
	if (!Number.isFinite(polynomialScale)) {
		return unresolved('The relative contact polynomial had a non-finite scale.', diagnostics);
	}
	if (polynomialScale === 0) {
		return resolveDegenerateInterval(query, tolerances, diagnostics, searchStart);
	}

	const normalizedCoefficients = coefficients.map((coefficient) => coefficient / polynomialScale);
	diagnostics = { ...diagnostics, normalizedPolynomialCoefficients: normalizedCoefficients };
	const isolation = isolatePolynomialRoots(
		normalizedCoefficients,
		0,
		1,
		tolerances.eventTime / duration,
		tolerances.polynomialResidual,
		query.maximumRefinementIterations ?? defaultMaximumRefinementIterations
	);
	diagnostics = {
		...diagnostics,
		refinementIterations: isolation.refinementIterations,
		isolatedRoots:
			isolation.type === 'roots' ? isolation.roots.map(({ normalizedTime }) => normalizedTime) : []
	};
	if (isolation.type === 'unresolved') return unresolved(isolation.reason, diagnostics);
	return selectEarliestEligibleRoot(
		query,
		tolerances,
		isolation.roots,
		normalizedCoefficients,
		searchStart,
		duration,
		diagnostics
	);
}

function selectEarliestEligibleRoot(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	roots: readonly IsolatedPolynomialRoot[],
	normalizedCoefficients: readonly number[],
	searchStart: number,
	duration: number,
	diagnostics: DynamicPairContactDiagnostics
): DynamicPairContactQueryResult {
	const candidates: DynamicPairContactCandidateDiagnostic[] = [];
	let toleranceContainedGrazingThrough: number | null = null;
	for (const [rootIndex, root] of roots.entries()) {
		const time = searchStart + root.normalizedTime * duration;
		const state = evaluateDynamicPairCandidate(
			query.first,
			query.second,
			time,
			tolerances.contactDistance
		);
		if (!state) {
			return unresolved('A pair root did not produce finite stable contact geometry.', {
				...diagnostics,
				candidates
			});
		}
		const geometryResidual = Math.abs(
			dynamicPairSurfaceSeparation(query.first, query.second, time)
		);
		const polynomialResidual = Math.abs(
			evaluatePolynomial(normalizedCoefficients, root.normalizedTime)
		);
		if (geometryResidual > tolerances.contactDistance) {
			candidates.push(
				candidateDiagnostic(
					state,
					root,
					polynomialResidual,
					geometryResidual,
					{ topology: 'indeterminate', before: null, after: null },
					'rejected-outside-contact-tolerance'
				)
			);
			return unresolved(
				'A mathematical pair root could not be verified within contact-distance tolerance.',
				{ ...diagnostics, candidates }
			);
		}
		const topology = classifyCircleCircleRootTopology(
			root,
			state.relativeNormalMotion,
			tolerances.normalVelocity,
			tolerances.contactDistance,
			(normalizedTime) =>
				dynamicPairSurfaceSeparation(
					query.first,
					query.second,
					searchStart + normalizedTime * duration
				)
		);
		const inheritedToleranceContainedGrazing: boolean =
			toleranceContainedGrazingThrough !== null &&
			root.normalizedTime <= toleranceContainedGrazingThrough;
		const toleranceContainedGrazingExit: number | null = inheritedToleranceContainedGrazing
			? toleranceContainedGrazingThrough
			: topology.before !== null &&
				  (topology.before === 'ambiguous' ||
						topology.after === 'ambiguous' ||
						topology.after === null)
				? findToleranceContainedGrazingExit(
						roots,
						rootIndex,
						normalizedCoefficients,
						tolerances.eventTime / duration,
						tolerances.polynomialResidual,
						query.maximumRefinementIterations ?? defaultMaximumRefinementIterations,
						tolerances.contactDistance,
						(normalizedTime) =>
							dynamicPairSurfaceSeparation(
								query.first,
								query.second,
								searchStart + normalizedTime * duration
							)
					)
				: null;
		if (toleranceContainedGrazingExit !== null) {
			toleranceContainedGrazingThrough = toleranceContainedGrazingExit;
		}
		const toleranceContainedGrazing =
			inheritedToleranceContainedGrazing || toleranceContainedGrazingExit !== null;
		const physicalTopology = toleranceContainedGrazing
			? 'grazing'
			: topology.topology === 'initial-contact'
				? initialContactMotion(topology, state.relativeNormalMotion, tolerances.normalVelocity)
				: topology.topology;
		if (physicalTopology === 'exiting') {
			candidates.push(
				candidateDiagnostic(
					state,
					root,
					polynomialResidual,
					geometryResidual,
					topology,
					'rejected-exiting'
				)
			);
			continue;
		}
		if (physicalTopology === 'grazing') {
			const grazingTopology: CircleCircleRootTopologyEvidence = {
				...topology,
				topology: 'grazing'
			};
			candidates.push(
				candidateDiagnostic(
					state,
					root,
					polynomialResidual,
					geometryResidual,
					grazingTopology,
					'rejected-grazing'
				)
			);
			continue;
		}
		if (physicalTopology === 'indeterminate') {
			candidates.push(
				candidateDiagnostic(
					state,
					root,
					polynomialResidual,
					geometryResidual,
					topology,
					'indeterminate'
				)
			);
			return unresolved('A dynamic pair root had indeterminate local topology.', {
				...diagnostics,
				candidates
			});
		}
		const response =
			state.relativeNormalMotion < -tolerances.normalVelocity ? 'impact' : 'non-impulsive-contact';
		candidates.push(
			candidateDiagnostic(
				state,
				root,
				polynomialResidual,
				geometryResidual,
				topology,
				response === 'impact' ? 'accepted-impact' : 'accepted-non-impulsive'
			)
		);
		return {
			type: 'contact',
			state: { ...state, response },
			diagnostics: { ...diagnostics, candidates }
		};
	}
	return { type: 'no-contact', diagnostics: { ...diagnostics, candidates } };
}

function resolveExactBoundary(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	diagnostics: DynamicPairContactDiagnostics,
	separation: number,
	time: number
): DynamicPairContactQueryResult {
	if (separation > tolerances.contactDistance) return { type: 'no-contact', diagnostics };
	const state = evaluateDynamicPairCandidate(
		query.first,
		query.second,
		time,
		tolerances.contactDistance
	);
	if (!state) return unresolved('Exact-boundary pair geometry was indeterminate.', diagnostics);
	if (state.relativeNormalMotion > tolerances.normalVelocity) {
		return {
			type: 'no-contact',
			diagnostics: {
				...diagnostics,
				candidates: [boundaryDiagnostic(state, separation, 'rejected-exiting')]
			}
		};
	}
	const response =
		state.relativeNormalMotion < -tolerances.normalVelocity ? 'impact' : 'non-impulsive-contact';
	return {
		type: 'contact',
		state: { ...state, response },
		diagnostics: {
			...diagnostics,
			candidates: [
				boundaryDiagnostic(
					state,
					separation,
					response === 'impact' ? 'accepted-impact' : 'accepted-non-impulsive'
				)
			]
		}
	};
}

function resolveDegenerateInterval(
	query: DynamicPairContactQuery,
	tolerances: DynamicPairContactTolerances,
	diagnostics: DynamicPairContactDiagnostics,
	searchStart: number
): DynamicPairContactQueryResult {
	const separation = dynamicPairSurfaceSeparation(query.first, query.second, searchStart);
	return resolveExactBoundary(query, tolerances, diagnostics, separation, searchStart);
}

function candidateDiagnostic(
	state: DynamicPairContactState,
	root: IsolatedPolynomialRoot,
	polynomialResidual: number,
	geometryResidual: number,
	topology: CircleCircleRootTopologyEvidence,
	classification: DynamicPairCandidateClassification
): DynamicPairContactCandidateDiagnostic {
	return {
		normalizedTime: root.normalizedTime,
		time: state.time,
		polynomialResidual,
		geometryResidual,
		relativeNormalMotion: state.relativeNormalMotion,
		source: root.source,
		isolatingInterval: root.isolatingInterval,
		refinementIterations: root.refinementIterations,
		topology: topology.topology,
		beforeRegion: topology.before,
		afterRegion: topology.after,
		classification
	};
}

function boundaryDiagnostic(
	state: DynamicPairContactState,
	separation: number,
	classification: DynamicPairCandidateClassification
): DynamicPairContactCandidateDiagnostic {
	return {
		normalizedTime: 0,
		time: state.time,
		polynomialResidual: 0,
		geometryResidual: Math.abs(separation),
		relativeNormalMotion: state.relativeNormalMotion,
		source: 'boundary',
		isolatingInterval: [0, 0],
		refinementIterations: 0,
		topology: 'initial-contact',
		beforeRegion: null,
		afterRegion: null,
		classification
	};
}

function trimLeadingDegeneracy(coefficients: readonly number[]): number[] {
	const trimmed = [...coefficients];
	while (trimmed.length > 1 && trimmed.at(-1) === 0) trimmed.pop();
	return trimmed;
}

function emptyDiagnostics(
	query: DynamicPairContactQuery,
	searchStart: number,
	searchEnd: number
): DynamicPairContactDiagnostics {
	return {
		bodyIds: [query.first.bodyId, query.second.bodyId],
		revisions: [query.first.revision, query.second.revision],
		pathTypes: [query.first.path.type, query.second.path.type],
		searchInterval: [searchStart, searchEnd],
		localEventHorizons: [query.first.path.endTime, query.second.path.endTime],
		normalizedIntervalScale: searchEnd - searchStart,
		relativeCoefficients: null,
		polynomialCoefficients: [],
		normalizedPolynomialCoefficients: [],
		polynomialScale: null,
		polynomialDegree: null,
		isolatedRoots: [],
		refinementIterations: 0,
		candidates: []
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
