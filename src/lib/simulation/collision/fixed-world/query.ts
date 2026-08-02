import type { ContactEvent, StaticCollider } from '../../contracts';
import { evaluateBoundary, evaluateCircle } from './candidate-evaluation';
import { certifyContactSet } from './manifold';
import type {
	FixedWorldColliderDiagnostic,
	FixedWorldContactCandidate,
	FixedWorldContactDiagnostics,
	FixedWorldContactQuery,
	FixedWorldContactQueryResult,
	FixedWorldContactTolerances
} from './types';

export const defaultFixedWorldContactTolerances = {
	contactDistance: 1e-9,
	eventTime: 1e-9,
	normalVelocity: 1e-9,
	polynomialResidual: 1e-12
} as const satisfies FixedWorldContactTolerances;

export function findEarliestFixedWorldContact(
	query: FixedWorldContactQuery
): FixedWorldContactQueryResult {
	const tolerances = query.tolerances ?? defaultFixedWorldContactTolerances;
	const initialDiagnostics = diagnostics(query, tolerances, [], [], [], []);
	const invalidReason = validateQuery(query, tolerances);
	if (invalidReason)
		return { type: 'invalid-input', reason: invalidReason, diagnostics: initialDiagnostics };
	const duplicateColliderId = findDuplicateColliderId(query.colliders);
	if (duplicateColliderId) {
		return {
			type: 'invalid-input',
			reason: `Collider ID "${duplicateColliderId}" is duplicated in the fixed world.`,
			diagnostics: initialDiagnostics
		};
	}

	const candidates: FixedWorldContactCandidate[] = [];
	const evaluations: FixedWorldColliderDiagnostic[] = [];
	for (const collider of query.colliders) {
		const evaluation =
			'centre' in collider
				? evaluateCircle(query, collider, tolerances)
				: evaluateBoundary(query, collider, tolerances);
		evaluations.push(evaluation.diagnostic);
		if (evaluation.candidate) candidates.push(evaluation.candidate);
	}
	candidates.sort(compareCandidates);
	const earliest = candidates[0] ?? null;
	const near = earliest
		? candidates.filter((candidate) => candidate.time - earliest.time <= tolerances.eventTime)
		: [];
	const uncertain = evaluations.filter(
		({ outcome }) => outcome === 'invalid-input' || outcome === 'unresolved'
	);
	if (uncertain.length > 0) {
		const type = uncertain.some(({ outcome }) => outcome === 'invalid-input')
			? 'invalid-input'
			: 'unresolved';
		const reason = describeUncertainEvaluations(
			type === 'invalid-input'
				? 'Invalid collider queries'
				: 'Unresolved collider queries prevent earliest-event selection',
			uncertain
		);
		return {
			type,
			reason,
			diagnostics: diagnostics(query, tolerances, evaluations, candidates, near, [])
		};
	}
	if (!earliest)
		return {
			type: 'no-event',
			diagnostics: diagnostics(query, tolerances, evaluations, candidates, near, [])
		};

	const set = certifyContactSet(query, tolerances, near);
	if (set.type === 'unresolved') {
		return {
			type: 'unresolved',
			reason: set.reason,
			diagnostics: diagnostics(query, tolerances, evaluations, candidates, near, [])
		};
	}
	const representative = set.candidates[0]!;
	const event: ContactEvent = {
		type: 'contact',
		time: representative.time,
		bodyId: representative.bodyId,
		colliderId: representative.colliderId,
		position: representative.position,
		normal: representative.normal
	};
	return {
		type: 'contact',
		event,
		candidate: representative,
		activeCandidates: set.candidates,
		diagnostics: diagnostics(query, tolerances, evaluations, candidates, near, set.candidates)
	};
}

function diagnostics(
	query: FixedWorldContactQuery,
	tolerances: FixedWorldContactTolerances,
	colliderEvaluations: readonly FixedWorldColliderDiagnostic[],
	orderedCandidates: readonly FixedWorldContactCandidate[],
	nearSimultaneousCandidates: readonly FixedWorldContactCandidate[],
	activeCandidates: readonly FixedWorldContactCandidate[]
): FixedWorldContactDiagnostics {
	return {
		searchInterval: [query.segment.startTime, query.searchUntilTime],
		eventTimeTolerance: tolerances.eventTime,
		colliderEvaluations,
		orderedCandidates,
		nearSimultaneousCandidates,
		activeCandidates
	};
}

function validateQuery(
	query: FixedWorldContactQuery,
	tolerances: FixedWorldContactTolerances
): string | null {
	const segment = query.segment;
	if (segment.bodyId.trim().length === 0) return 'The body ID must be non-empty.';
	if (
		!Number.isFinite(segment.startTime) ||
		!Number.isFinite(segment.endTime) ||
		segment.endTime <= segment.startTime
	)
		return 'The motion segment must have finite times and end after it starts.';
	if (
		![...segment.startPosition, ...segment.startVelocity, ...segment.acceleration].every(
			Number.isFinite
		)
	)
		return 'Motion coordinates must contain finite numbers.';
	if (!Number.isFinite(query.ballRadius) || query.ballRadius <= 0)
		return 'The ball radius must be a positive finite number.';
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

function compareCandidates(
	left: FixedWorldContactCandidate,
	right: FixedWorldContactCandidate
): number {
	return (
		left.time - right.time ||
		left.colliderId.localeCompare(right.colliderId) ||
		left.feature.localeCompare(right.feature)
	);
}

function findDuplicateColliderId(colliders: readonly StaticCollider[]): string | null {
	const seen = new Set<string>();
	for (const collider of colliders) {
		if (seen.has(collider.id)) return collider.id;
		seen.add(collider.id);
	}
	return null;
}

function describeUncertainEvaluations(
	prefix: string,
	evaluations: readonly FixedWorldColliderDiagnostic[]
): string {
	return `${prefix}: ${evaluations.map((evaluation) => `${evaluation.colliderId} (${evaluation.reason ?? evaluation.outcome})`).join(', ')}.`;
}
