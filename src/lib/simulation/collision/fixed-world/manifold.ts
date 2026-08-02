import type { StaticCollider, Vec2 } from '../../contracts';
import { dotVec2 } from '../../math';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';
import type {
	FixedWorldContactCandidate,
	FixedWorldContactQuery,
	FixedWorldContactTolerances
} from './types';

export type ContactSetResult =
	| { readonly type: 'active'; readonly candidates: readonly FixedWorldContactCandidate[] }
	| { readonly type: 'unresolved'; readonly reason: string };

export function certifyContactSet(
	query: FixedWorldContactQuery,
	tolerances: FixedWorldContactTolerances,
	nearCandidates: readonly FixedWorldContactCandidate[]
): ContactSetResult {
	const earliest = nearCandidates[0];
	if (!earliest) return { type: 'active', candidates: [] };
	const exactTimeTolerance = 16 * Number.EPSILON * Math.max(1, Math.abs(earliest.time));
	const later = nearCandidates.find(
		(candidate) => candidate.time - earliest.time > exactTimeTolerance
	);
	if (later) {
		return {
			type: 'unresolved',
			reason: `Candidate ${later.colliderId} is within eventTime of the earliest event but is not certified at the same time.`
		};
	}

	const position = evaluateMotionSegmentPosition(query.segment, earliest.time);
	const velocity = evaluateMotionSegmentVelocity(query.segment, earliest.time);
	const active: FixedWorldContactCandidate[] = [];
	for (const candidate of nearCandidates) {
		const collider = query.colliders.find(({ id }) => id === candidate.colliderId);
		if (!collider)
			return {
				type: 'unresolved',
				reason: `Candidate collider ${candidate.colliderId} is missing.`
			};
		const state = contactState(position, velocity, query.ballRadius, collider, candidate);
		if (!state || Math.abs(state.separation) > tolerances.contactDistance) {
			return {
				type: 'unresolved',
				reason: `Candidate ${candidate.colliderId} is not certified touching at the common event state.`
			};
		}
		if (state.normalVelocity <= tolerances.normalVelocity) {
			active.push({
				...candidate,
				time: earliest.time,
				position,
				contactPoint: state.contactPoint,
				normal: state.normal,
				normalVelocity: state.normalVelocity,
				response:
					state.normalVelocity < -tolerances.normalVelocity ? 'impact' : 'non-impulsive-contact'
			});
		}
	}
	if (active.length === 0) {
		return {
			type: 'unresolved',
			reason: 'No non-separating contact was active at the common event state.'
		};
	}
	return { type: 'active', candidates: active.sort(compareGeometry) };
}

function contactState(
	position: Vec2,
	velocity: Vec2,
	ballRadius: number,
	collider: StaticCollider,
	candidate: FixedWorldContactCandidate
): {
	readonly separation: number;
	readonly contactPoint: Vec2;
	readonly normal: Vec2;
	readonly normalVelocity: number;
} | null {
	if ('centre' in collider) {
		const offset: Vec2 = [position[0] - collider.centre[0], position[1] - collider.centre[1]];
		const distance = Math.hypot(...offset);
		if (!(distance > 0)) return null;
		const normal: Vec2 = [offset[0] / distance, offset[1] / distance];
		return {
			separation: distance - ballRadius - collider.physicalShape.radius,
			contactPoint: [position[0] - normal[0] * ballRadius, position[1] - normal[1] * ballRadius],
			normal,
			normalVelocity: dotVec2(velocity, normal)
		};
	}
	const start = collider.physicalShape.start;
	const end = collider.physicalShape.end;
	const endpoint =
		candidate.feature === 'start-endpoint'
			? start
			: candidate.feature === 'end-endpoint'
				? end
				: null;
	if (endpoint) {
		const offset: Vec2 = [position[0] - endpoint[0], position[1] - endpoint[1]];
		const distance = Math.hypot(...offset);
		if (!(distance > 0)) return null;
		const normal: Vec2 = [offset[0] / distance, offset[1] / distance];
		return {
			separation: distance - ballRadius,
			contactPoint: endpoint,
			normal,
			normalVelocity: dotVec2(velocity, normal)
		};
	}
	const delta: Vec2 = [end[0] - start[0], end[1] - start[1]];
	const length = Math.hypot(...delta);
	const tangent: Vec2 = [delta[0] / length, delta[1] / length];
	const normal = candidate.normal;
	const along = dotVec2([position[0] - start[0], position[1] - start[1]], tangent);
	const contactPoint: Vec2 = [start[0] + along * tangent[0], start[1] + along * tangent[1]];
	return {
		separation:
			dotVec2([position[0] - contactPoint[0], position[1] - contactPoint[1]], normal) - ballRadius,
		contactPoint,
		normal,
		normalVelocity: dotVec2(velocity, normal)
	};
}

function compareGeometry(
	left: FixedWorldContactCandidate,
	right: FixedWorldContactCandidate
): number {
	return (
		left.normal[0] - right.normal[0] ||
		left.normal[1] - right.normal[1] ||
		left.contactPoint[0] - right.contactPoint[0] ||
		left.contactPoint[1] - right.contactPoint[1] ||
		left.feature.localeCompare(right.feature) ||
		left.colliderId.localeCompare(right.colliderId)
	);
}
