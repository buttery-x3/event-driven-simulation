import type { ContactEvent } from '../../contracts';
import {
	evaluatePolynomial,
	isolatePolynomialRoots,
	type IsolatedPolynomialRoot
} from '../../math';
import {
	buildCircleCircleContactPolynomial,
	circleCircleSurfaceSeparation,
	evaluateCircleCircleCandidate,
	type CircleCircleCandidateState
} from './contact-polynomial';
import {
	certifiesToleranceContainedPassage,
	classifyCircleCircleRootTopology,
	findToleranceContainedGrazingExit,
	initialContactMotion,
	type CircleCircleRootTopology,
	type CircleCircleRootTopologyEvidence
} from './root-topology';
import { validateCircleCircleContactQuery } from './query-validation';
import type {
	CircleCircleContactCandidateClassification,
	CircleCircleContactCandidateDiagnostic,
	CircleCircleContactDiagnostics,
	CircleCircleContactQuery,
	CircleCircleContactQueryResult,
	CircleCircleContactState,
	CircleCircleContactTolerances
} from './types';

export const defaultCircleCircleContactTolerances = {
	contactDistance: 1e-9,
	eventTime: 1e-9,
	normalVelocity: 1e-9,
	polynomialResidual: 1e-12
} as const satisfies CircleCircleContactTolerances;

const defaultMaximumRefinementIterations = 128;

export function findEarliestCircleCircleContact(
	query: CircleCircleContactQuery
): CircleCircleContactQueryResult {
	const tolerances = query.tolerances ?? defaultCircleCircleContactTolerances;
	const invalidReason = validateCircleCircleContactQuery(query, tolerances);
	let diagnostics = emptyDiagnostics(query);
	if (invalidReason) return { type: 'invalid-input', reason: invalidReason, diagnostics };

	const searchDuration = query.searchUntilTime - query.segment.startTime;
	const combinedRadius = query.ballRadius + query.circle.physicalShape.radius;
	const initialSeparation = circleCircleSurfaceSeparation(query, combinedRadius, 0, searchDuration);
	if (initialSeparation < -tolerances.contactDistance) {
		return {
			type: 'invalid-input',
			reason: 'The motion segment starts with the ball penetrating the fixed circle.',
			diagnostics
		};
	}

	const coefficients = buildCircleCircleContactPolynomial(query, searchDuration, combinedRadius);
	if (!coefficients.every(Number.isFinite)) {
		return unresolved(
			'The contact polynomial could not be represented with finite coefficients.',
			diagnostics
		);
	}
	const polynomialScale = Math.max(...coefficients.map(Math.abs));
	if (!Number.isFinite(polynomialScale)) {
		return unresolved('The contact polynomial is degenerate across the supported interval.', {
			...diagnostics,
			polynomialScale
		});
	}
	if (polynomialScale === 0) {
		return resolveDegenerateContact(query, tolerances, diagnostics, combinedRadius);
	}

	const normalizedCoefficients = coefficients.map((coefficient) => coefficient / polynomialScale);
	diagnostics = {
		...diagnostics,
		normalizedPolynomialCoefficients: normalizedCoefficients,
		polynomialScale
	};
	const rootIsolation = isolatePolynomialRoots(
		normalizedCoefficients,
		0,
		1,
		tolerances.eventTime / searchDuration,
		tolerances.polynomialResidual,
		query.maximumRefinementIterations ?? defaultMaximumRefinementIterations
	);
	diagnostics = { ...diagnostics, refinementIterations: rootIsolation.refinementIterations };
	if (rootIsolation.type === 'unresolved') return unresolved(rootIsolation.reason, diagnostics);
	return selectEarliestEligibleRoot(
		query,
		tolerances,
		rootIsolation.roots,
		normalizedCoefficients,
		searchDuration,
		combinedRadius,
		diagnostics
	);
}

function selectEarliestEligibleRoot(
	query: CircleCircleContactQuery,
	tolerances: CircleCircleContactTolerances,
	roots: readonly IsolatedPolynomialRoot[],
	normalizedCoefficients: readonly number[],
	searchDuration: number,
	combinedRadius: number,
	diagnostics: CircleCircleContactDiagnostics
): CircleCircleContactQueryResult {
	const candidates: CircleCircleContactCandidateDiagnostic[] = [];
	let releaseOwned = query.releasedInitialContact ?? false;
	let toleranceContainedGrazingThrough: number | null = null;
	for (const [rootIndex, root] of roots.entries()) {
		const evaluated = evaluateCircleCircleCandidate(
			query,
			tolerances.contactDistance,
			root.normalizedTime,
			searchDuration,
			combinedRadius
		);
		if (evaluated.type === 'unresolved') {
			return unresolved(evaluated.reason, { ...diagnostics, candidates });
		}
		const polynomialResidual = Math.abs(
			evaluatePolynomial(normalizedCoefficients, root.normalizedTime)
		);
		if (evaluated.surfaceSeparation > tolerances.contactDistance) {
			candidates.push(
				candidateDiagnostic(
					evaluated,
					root,
					polynomialResidual,
					'indeterminate',
					null,
					null,
					'rejected-outside-contact-tolerance'
				)
			);
			return unresolved(
				'A mathematical root could not be verified within the contact-distance tolerance.',
				{ ...diagnostics, candidates }
			);
		}

		const evidence = classifyCircleCircleRootTopology(
			root,
			evaluated.normalVelocity,
			tolerances.normalVelocity,
			tolerances.contactDistance,
			(normalizedTime) =>
				circleCircleSurfaceSeparation(query, combinedRadius, normalizedTime, searchDuration)
		);
		const inheritedToleranceContainedGrazing: boolean =
			toleranceContainedGrazingThrough !== null &&
			root.normalizedTime <= toleranceContainedGrazingThrough;
		const toleranceContainedGrazingExit: number | null = inheritedToleranceContainedGrazing
			? toleranceContainedGrazingThrough
			: evidence.before !== null &&
				  (evidence.before === 'ambiguous' ||
						evidence.after === 'ambiguous' ||
						evidence.after === null)
				? findToleranceContainedGrazingExit(
						roots,
						rootIndex,
						normalizedCoefficients,
						tolerances.eventTime / searchDuration,
						tolerances.polynomialResidual,
						query.maximumRefinementIterations ?? defaultMaximumRefinementIterations,
						tolerances.contactDistance,
						(normalizedTime) =>
							circleCircleSurfaceSeparation(query, combinedRadius, normalizedTime, searchDuration)
					)
				: null;
		const toleranceContainedGrazing =
			inheritedToleranceContainedGrazing || toleranceContainedGrazingExit !== null;
		if (toleranceContainedGrazingExit !== null) {
			toleranceContainedGrazingThrough = toleranceContainedGrazingExit;
		}
		const motion = toleranceContainedGrazing
			? 'grazing'
			: evidence.topology === 'initial-contact'
				? initialContactMotion(evidence, evaluated.normalVelocity, tolerances.normalVelocity)
				: evidence.topology;
		const separationWasCertified = evidence.before === 'separated';
		if (releaseOwned && !separationWasCertified) {
			candidates.push(
				candidateDiagnostic(
					evaluated,
					root,
					polynomialResidual,
					evidence.topology,
					evidence.before,
					evidence.after,
					'rejected-release-owned'
				)
			);
			if (evidence.after === 'separated') releaseOwned = false;
			else if (
				(motion === 'entering' || evidence.after === 'overlapping') &&
				query.allowToleranceContainedReleasePassage === true &&
				certifiesToleranceContainedPassage(
					normalizedCoefficients,
					root.normalizedTime,
					roots[rootIndex + 1]?.normalizedTime,
					tolerances.eventTime / searchDuration,
					tolerances.polynomialResidual,
					query.maximumRefinementIterations ?? defaultMaximumRefinementIterations,
					tolerances.contactDistance,
					(normalizedTime) =>
						circleCircleSurfaceSeparation(query, combinedRadius, normalizedTime, searchDuration)
				)
			) {
				continue;
			} else if (motion === 'entering' || evidence.after === 'overlapping') {
				return unresolved(
					'Released circle contact re-entered before positive separation was certified.',
					{ ...diagnostics, candidates }
				);
			}
			continue;
		}
		releaseOwned = false;

		if (motion === 'exiting') {
			candidates.push(
				candidateDiagnostic(
					evaluated,
					root,
					polynomialResidual,
					evidence.topology,
					evidence.before,
					evidence.after,
					'rejected-exiting'
				)
			);
			continue;
		}
		if (motion === 'grazing') {
			candidates.push(
				candidateDiagnostic(
					evaluated,
					root,
					polynomialResidual,
					motion,
					evidence.before,
					evidence.after,
					'rejected-grazing'
				)
			);
			continue;
		}
		if (motion === 'indeterminate') {
			candidates.push(
				candidateDiagnostic(
					evaluated,
					root,
					polynomialResidual,
					evidence.topology,
					evidence.before,
					evidence.after,
					'indeterminate'
				)
			);
			return unresolved('A circle-circle root had indeterminate local topology.', {
				...diagnostics,
				candidates
			});
		}

		const response =
			evaluated.normalVelocity < -tolerances.normalVelocity ? 'impact' : 'non-impulsive-contact';
		candidates.push(
			candidateDiagnostic(
				evaluated,
				root,
				polynomialResidual,
				evidence.topology,
				evidence.before,
				evidence.after,
				response === 'impact' ? 'accepted-impact' : 'accepted-non-impulsive'
			)
		);
		return contactResult(query, evaluated, response, { ...diagnostics, candidates });
	}

	return { type: 'no-contact', diagnostics: { ...diagnostics, candidates } };
}

function candidateDiagnostic(
	candidate: CircleCircleCandidateState,
	root: {
		readonly source: CircleCircleContactCandidateDiagnostic['source'];
		readonly refinementIterations: number;
	},
	polynomialResidual: number,
	topology: CircleCircleRootTopology,
	beforeRegion: CircleCircleRootTopologyEvidence['before'],
	afterRegion: CircleCircleRootTopologyEvidence['after'],
	classification: CircleCircleContactCandidateClassification
): CircleCircleContactCandidateDiagnostic {
	return {
		time: candidate.time,
		polynomialResidual,
		surfaceSeparation: candidate.surfaceSeparation,
		normalVelocity: candidate.normalVelocity,
		source: root.source,
		refinementIterations: root.refinementIterations,
		topology,
		beforeRegion,
		afterRegion,
		classification
	};
}

function contactResult(
	query: CircleCircleContactQuery,
	candidate: CircleCircleCandidateState,
	response: CircleCircleContactState['response'],
	diagnostics: CircleCircleContactDiagnostics
): CircleCircleContactQueryResult {
	const event: ContactEvent = {
		type: 'contact',
		time: candidate.time,
		bodyId: query.segment.bodyId,
		colliderId: query.circle.id,
		position: candidate.position,
		normal: candidate.normal
	};
	return {
		type: 'contact',
		event,
		state: {
			time: candidate.time,
			position: candidate.position,
			velocity: candidate.velocity,
			normal: candidate.normal,
			normalVelocity: candidate.normalVelocity,
			response
		},
		diagnostics
	};
}

function resolveDegenerateContact(
	query: CircleCircleContactQuery,
	tolerances: CircleCircleContactTolerances,
	diagnostics: CircleCircleContactDiagnostics,
	combinedRadius: number
): CircleCircleContactQueryResult {
	const evaluated = evaluateCircleCircleCandidate(
		query,
		tolerances.contactDistance,
		0,
		query.searchUntilTime - query.segment.startTime,
		combinedRadius
	);
	if (evaluated.type === 'unresolved') return unresolved(evaluated.reason, diagnostics);
	const classification = query.releasedInitialContact ? 'indeterminate' : 'accepted-non-impulsive';
	const candidate: CircleCircleContactCandidateDiagnostic = {
		time: query.segment.startTime,
		polynomialResidual: 0,
		surfaceSeparation: evaluated.surfaceSeparation,
		normalVelocity: evaluated.normalVelocity,
		source: 'boundary',
		refinementIterations: 0,
		topology: query.releasedInitialContact ? 'indeterminate' : 'initial-contact',
		beforeRegion: null,
		afterRegion: 'ambiguous',
		classification
	};
	const completed = { ...diagnostics, polynomialScale: 0, candidates: [candidate] };
	return query.releasedInitialContact
		? unresolved(
				'Released circle contact remained indeterminate across the search interval.',
				completed
			)
		: contactResult(query, evaluated, 'non-impulsive-contact', completed);
}

function emptyDiagnostics(query: CircleCircleContactQuery): CircleCircleContactDiagnostics {
	return {
		searchInterval: [query.segment.startTime, query.searchUntilTime],
		normalizedPolynomialCoefficients: [],
		polynomialScale: null,
		refinementIterations: 0,
		candidates: []
	};
}

function unresolved(
	reason: string,
	diagnostics: CircleCircleContactDiagnostics
): CircleCircleContactQueryResult {
	return { type: 'unresolved', reason, diagnostics };
}
