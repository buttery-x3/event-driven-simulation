import {
	findEarliestBoundaryContact,
	type BoundaryContactCandidateDiagnostic
} from '../boundary-contact';
import type { StaticCircleCollider, StaticLineSegmentCollider, Vec2 } from '../../contracts';
import {
	findEarliestCircleCircleContact,
	type CircleCircleContactCandidateDiagnostic
} from '../circle-circle';
import type {
	FixedWorldColliderDiagnostic,
	FixedWorldContactCandidate,
	FixedWorldContactQuery,
	FixedWorldContactTolerances,
	FixedWorldRejectedCandidateDiagnostic
} from './types';

export function evaluateCircle(
	query: FixedWorldContactQuery,
	circle: StaticCircleCollider,
	tolerances: FixedWorldContactTolerances
): {
	readonly candidate: FixedWorldContactCandidate | null;
	readonly diagnostic: FixedWorldColliderDiagnostic;
} {
	const result = findEarliestCircleCircleContact({
		segment: query.segment,
		ballRadius: query.ballRadius,
		circle,
		searchUntilTime: query.searchUntilTime,
		tolerances,
		maximumRefinementIterations: query.maximumRefinementIterations,
		releasedInitialContact: released(query, circle.id)
	});
	const rejectedCandidates = result.diagnostics.candidates
		.filter((candidate) => !candidate.classification.startsWith('accepted-'))
		.map(toCircleRejection);

	if (result.type !== 'contact') {
		return {
			candidate: null,
			diagnostic: diagnostic(
				circle.id,
				'circle',
				result.type,
				'reason' in result ? result.reason : null,
				rejectedCandidates
			)
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
		colliderKind: 'circle',
		feature: 'circle',
		time: result.event.time,
		position: result.event.position,
		contactPoint,
		normal: result.event.normal,
		normalVelocity: result.state.normalVelocity,
		response: result.state.response
	} as const satisfies FixedWorldContactCandidate;
	return { candidate, diagnostic: acceptedDiagnostic(candidate, rejectedCandidates) };
}

export function evaluateBoundary(
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
		maximumRefinementIterations: query.maximumRefinementIterations,
		ignoreInitialContact: released(query, boundary.id)
	});
	const rejectedCandidates = result.diagnostics.candidates
		.filter((candidate) => candidate.classification !== 'accepted')
		.map(toBoundaryRejection);
	if (result.type !== 'contact') {
		return {
			candidate: null,
			diagnostic: diagnostic(
				boundary.id,
				'boundary',
				result.type,
				'reason' in result ? result.reason : null,
				rejectedCandidates
			)
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
		normalVelocity: result.state.normalVelocity,
		response:
			result.state.normalVelocity < -tolerances.normalVelocity ? 'impact' : 'non-impulsive-contact'
	} as const satisfies FixedWorldContactCandidate;
	return { candidate, diagnostic: acceptedDiagnostic(candidate, rejectedCandidates) };
}

function acceptedDiagnostic(
	candidate: FixedWorldContactCandidate,
	rejectedCandidates: readonly FixedWorldRejectedCandidateDiagnostic[]
): FixedWorldColliderDiagnostic {
	return {
		colliderId: candidate.colliderId,
		colliderKind: candidate.colliderKind,
		outcome: 'contact',
		reason: null,
		eventTime: candidate.time,
		contactPoint: candidate.contactPoint,
		normal: candidate.normal,
		rejectedCandidates
	};
}

function diagnostic(
	colliderId: string,
	colliderKind: 'circle' | 'boundary',
	outcome: FixedWorldColliderDiagnostic['outcome'],
	reason: string | null,
	rejectedCandidates: readonly FixedWorldRejectedCandidateDiagnostic[]
): FixedWorldColliderDiagnostic {
	return {
		colliderId,
		colliderKind,
		outcome,
		reason,
		eventTime: null,
		contactPoint: null,
		normal: null,
		rejectedCandidates
	};
}

function toCircleRejection(
	candidate: CircleCircleContactCandidateDiagnostic
): FixedWorldRejectedCandidateDiagnostic {
	return { time: candidate.time, feature: 'circle', classification: candidate.classification };
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

function released(query: FixedWorldContactQuery, colliderId: string): boolean {
	return (
		query.releasedContactColliderId === colliderId ||
		(query.releasedContactColliderIds?.includes(colliderId) ?? false)
	);
}
