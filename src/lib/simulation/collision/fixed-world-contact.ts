import {
	findEarliestBoundaryContact,
	type BoundaryContactCandidateDiagnostic,
	type BoundaryContactFeature,
	type BoundaryContactTolerances
} from './boundary-contact';
import type {
	ContactEvent,
	MotionSegment,
	StaticCircleCollider,
	StaticCollider,
	StaticLineSegmentCollider,
	Vec2
} from '../contracts';
import {
	findEarliestPegContact,
	type PegContactCandidateDiagnostic,
	type PegContactTolerances
} from './peg-contact';

export interface FixedWorldContactTolerances
	extends PegContactTolerances, BoundaryContactTolerances {}

export const defaultFixedWorldContactTolerances = {
	contactDistance: 1e-9,
	eventTime: 1e-9,
	normalVelocity: 1e-9,
	polynomialResidual: 1e-12
} as const satisfies FixedWorldContactTolerances;

export interface FixedWorldContactQuery {
	readonly segment: MotionSegment;
	readonly ballRadius: number;
	readonly colliders: readonly StaticCollider[];
	readonly searchUntilTime: number;
	readonly tolerances?: FixedWorldContactTolerances;
	readonly maximumRefinementIterations?: number;
}

export type FixedWorldContactFeature = 'circle' | BoundaryContactFeature;

export interface FixedWorldContactCandidate {
	readonly type: 'contact-candidate';
	readonly bodyId: string;
	readonly colliderId: string;
	readonly colliderKind: 'peg' | 'boundary';
	readonly feature: FixedWorldContactFeature;
	readonly time: number;
	readonly position: Vec2;
	readonly contactPoint: Vec2;
	readonly normal: Vec2;
	readonly normalVelocity: number;
}

export interface FixedWorldRejectedCandidateDiagnostic {
	readonly time: number;
	readonly feature: FixedWorldContactFeature;
	readonly classification: string;
}

export interface FixedWorldColliderDiagnostic {
	readonly colliderId: string;
	readonly colliderKind: 'peg' | 'boundary';
	readonly outcome: 'contact' | 'no-contact' | 'unresolved' | 'invalid-input';
	readonly reason: string | null;
	readonly eventTime: number | null;
	readonly contactPoint: Vec2 | null;
	readonly normal: Vec2 | null;
	readonly rejectedCandidates: readonly FixedWorldRejectedCandidateDiagnostic[];
}

export interface FixedWorldContactDiagnostics {
	readonly searchInterval: readonly [startTime: number, endTime: number];
	readonly eventTimeTolerance: number;
	readonly colliderEvaluations: readonly FixedWorldColliderDiagnostic[];
	readonly orderedCandidates: readonly FixedWorldContactCandidate[];
	readonly nearSimultaneousCandidates: readonly FixedWorldContactCandidate[];
}

export type FixedWorldContactQueryResult =
	| {
			readonly type: 'contact';
			readonly event: ContactEvent;
			readonly candidate: FixedWorldContactCandidate;
			readonly diagnostics: FixedWorldContactDiagnostics;
	  }
	| {
			readonly type: 'no-event';
			readonly diagnostics: FixedWorldContactDiagnostics;
	  }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly diagnostics: FixedWorldContactDiagnostics;
	  }
	| {
			readonly type: 'invalid-input';
			readonly reason: string;
			readonly diagnostics: FixedWorldContactDiagnostics;
	  };

export function findEarliestFixedWorldContact(
	query: FixedWorldContactQuery
): FixedWorldContactQueryResult {
	const tolerances = query.tolerances ?? defaultFixedWorldContactTolerances;
	const initialDiagnostics: FixedWorldContactDiagnostics = {
		searchInterval: [query.segment.startTime, query.searchUntilTime],
		eventTimeTolerance: tolerances.eventTime,
		colliderEvaluations: [],
		orderedCandidates: [],
		nearSimultaneousCandidates: []
	};
	const invalidReason = validateQuery(query, tolerances);
	if (invalidReason) {
		return { type: 'invalid-input', reason: invalidReason, diagnostics: initialDiagnostics };
	}

	const duplicateColliderId = findDuplicateColliderId(query.colliders);
	if (duplicateColliderId) {
		return {
			type: 'invalid-input',
			reason: `Collider ID "${duplicateColliderId}" is duplicated in the fixed world.`,
			diagnostics: initialDiagnostics
		};
	}

	const candidates: FixedWorldContactCandidate[] = [];
	const colliderEvaluations: FixedWorldColliderDiagnostic[] = [];

	for (const collider of query.colliders) {
		if ('centre' in collider) {
			const evaluation = evaluatePeg(query, collider, tolerances);
			colliderEvaluations.push(evaluation.diagnostic);
			if (evaluation.candidate) candidates.push(evaluation.candidate);
		} else {
			const evaluation = evaluateBoundary(query, collider, tolerances);
			colliderEvaluations.push(evaluation.diagnostic);
			if (evaluation.candidate) candidates.push(evaluation.candidate);
		}
	}

	candidates.sort(compareCandidates);
	const earliestCandidate = candidates[0] ?? null;
	const nearSimultaneousCandidates = earliestCandidate
		? candidates.filter(
				(candidate) => candidate.time - earliestCandidate.time <= tolerances.eventTime
			)
		: [];
	const diagnostics: FixedWorldContactDiagnostics = {
		searchInterval: [query.segment.startTime, query.searchUntilTime],
		eventTimeTolerance: tolerances.eventTime,
		colliderEvaluations,
		orderedCandidates: candidates,
		nearSimultaneousCandidates
	};

	const invalidEvaluations = colliderEvaluations.filter(
		(evaluation) => evaluation.outcome === 'invalid-input'
	);
	if (invalidEvaluations.length > 0) {
		return {
			type: 'invalid-input',
			reason: describeUncertainEvaluations('Invalid collider queries', invalidEvaluations),
			diagnostics
		};
	}

	const unresolvedEvaluations = colliderEvaluations.filter(
		(evaluation) => evaluation.outcome === 'unresolved'
	);
	if (unresolvedEvaluations.length > 0) {
		return {
			type: 'unresolved',
			reason: describeUncertainEvaluations(
				'Unresolved collider queries prevent earliest-event selection',
				unresolvedEvaluations
			),
			diagnostics
		};
	}

	if (!earliestCandidate) return { type: 'no-event', diagnostics };

	return {
		type: 'contact',
		event: {
			type: 'contact',
			time: earliestCandidate.time,
			bodyId: earliestCandidate.bodyId,
			colliderId: earliestCandidate.colliderId,
			position: earliestCandidate.position,
			normal: earliestCandidate.normal
		},
		candidate: earliestCandidate,
		diagnostics
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
	) {
		return 'The motion segment must have finite times and end after it starts.';
	}
	if (
		![...segment.startPosition, ...segment.startVelocity, ...segment.acceleration].every(
			Number.isFinite
		)
	) {
		return 'Motion coordinates must contain finite numbers.';
	}
	if (!Number.isFinite(query.ballRadius) || query.ballRadius <= 0) {
		return 'The ball radius must be a positive finite number.';
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

function evaluatePeg(
	query: FixedWorldContactQuery,
	peg: StaticCircleCollider,
	tolerances: FixedWorldContactTolerances
): {
	readonly candidate: FixedWorldContactCandidate | null;
	readonly diagnostic: FixedWorldColliderDiagnostic;
} {
	const result = findEarliestPegContact({
		segment: query.segment,
		ballRadius: query.ballRadius,
		peg,
		searchUntilTime: query.searchUntilTime,
		tolerances,
		maximumRefinementIterations: query.maximumRefinementIterations
	});
	const rejectedCandidates = result.diagnostics.candidates
		.filter((candidate) => candidate.classification !== 'accepted')
		.map(toPegRejection);

	if (result.type !== 'contact') {
		return {
			candidate: null,
			diagnostic: {
				colliderId: peg.id,
				colliderKind: 'peg',
				outcome: result.type,
				reason: 'reason' in result ? result.reason : null,
				eventTime: null,
				contactPoint: null,
				normal: null,
				rejectedCandidates
			}
		};
	}

	const contactPoint: Vec2 = [
		result.event.position[0] - result.event.normal[0] * query.ballRadius,
		result.event.position[1] - result.event.normal[1] * query.ballRadius
	];
	const candidate = {
		type: 'contact-candidate',
		bodyId: result.event.bodyId,
		colliderId: result.event.colliderId,
		colliderKind: 'peg',
		feature: 'circle',
		time: result.event.time,
		position: result.event.position,
		contactPoint,
		normal: result.event.normal,
		normalVelocity: result.state.normalVelocity
	} as const satisfies FixedWorldContactCandidate;

	return {
		candidate,
		diagnostic: {
			colliderId: peg.id,
			colliderKind: 'peg',
			outcome: 'contact',
			reason: null,
			eventTime: candidate.time,
			contactPoint,
			normal: candidate.normal,
			rejectedCandidates
		}
	};
}

function evaluateBoundary(
	query: FixedWorldContactQuery,
	boundary: StaticLineSegmentCollider,
	tolerances: FixedWorldContactTolerances
): {
	readonly candidate: FixedWorldContactCandidate | null;
	readonly diagnostic: FixedWorldColliderDiagnostic;
} {
	const result = findEarliestBoundaryContact({
		segment: query.segment,
		ballRadius: query.ballRadius,
		boundary,
		searchUntilTime: query.searchUntilTime,
		tolerances,
		maximumRefinementIterations: query.maximumRefinementIterations
	});
	const rejectedCandidates = result.diagnostics.candidates
		.filter((candidate) => candidate.classification !== 'accepted')
		.map(toBoundaryRejection);

	if (result.type !== 'contact') {
		return {
			candidate: null,
			diagnostic: {
				colliderId: boundary.id,
				colliderKind: 'boundary',
				outcome: result.type,
				reason: 'reason' in result ? result.reason : null,
				eventTime: null,
				contactPoint: null,
				normal: null,
				rejectedCandidates
			}
		};
	}

	const candidate = {
		type: 'contact-candidate',
		bodyId: result.event.bodyId,
		colliderId: result.event.colliderId,
		colliderKind: 'boundary',
		feature: result.state.feature,
		time: result.event.time,
		position: result.event.position,
		contactPoint: result.state.contactPoint,
		normal: result.event.normal,
		normalVelocity: result.state.normalVelocity
	} as const satisfies FixedWorldContactCandidate;

	return {
		candidate,
		diagnostic: {
			colliderId: boundary.id,
			colliderKind: 'boundary',
			outcome: 'contact',
			reason: null,
			eventTime: candidate.time,
			contactPoint: candidate.contactPoint,
			normal: candidate.normal,
			rejectedCandidates
		}
	};
}

function toPegRejection(
	candidate: PegContactCandidateDiagnostic
): FixedWorldRejectedCandidateDiagnostic {
	return {
		time: candidate.time,
		feature: 'circle',
		classification: candidate.classification
	};
}

function toBoundaryRejection(
	candidate: BoundaryContactCandidateDiagnostic
): FixedWorldRejectedCandidateDiagnostic {
	return {
		time: candidate.time,
		feature: candidate.feature,
		classification: candidate.classification
	};
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
	return `${prefix}: ${evaluations
		.map((evaluation) => `${evaluation.colliderId} (${evaluation.reason ?? evaluation.outcome})`)
		.join(', ')}.`;
}
