import type {
	ConstantAccelerationMotionSegment,
	StaticCircleCollider,
	Vec2
} from '../../contracts';
import { dotVec2, normaliseVec2 } from '../../math';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';

interface CircleCirclePathQuery {
	readonly segment: ConstantAccelerationMotionSegment;
	readonly ballRadius: number;
	readonly circle: StaticCircleCollider;
}

export interface CircleCircleCandidateState {
	readonly type: 'candidate';
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly normal: Vec2;
	readonly normalVelocity: number;
	readonly surfaceSeparation: number;
}

export type CircleCircleCandidateEvaluation =
	CircleCircleCandidateState | { readonly type: 'unresolved'; readonly reason: string };

export function buildCircleCircleContactPolynomial(
	query: CircleCirclePathQuery,
	searchDuration: number,
	combinedRadius: number
): number[] {
	const relativePosition: Vec2 = [
		query.segment.startPosition[0] - query.circle.centre[0],
		query.segment.startPosition[1] - query.circle.centre[1]
	];
	const scaledVelocity: Vec2 = [
		query.segment.startVelocity[0] * searchDuration,
		query.segment.startVelocity[1] * searchDuration
	];
	const scaledHalfAcceleration: Vec2 = [
		0.5 * query.segment.acceleration[0] * searchDuration ** 2,
		0.5 * query.segment.acceleration[1] * searchDuration ** 2
	];
	return [
		dotVec2(relativePosition, relativePosition) - combinedRadius ** 2,
		2 * dotVec2(relativePosition, scaledVelocity),
		dotVec2(scaledVelocity, scaledVelocity) + 2 * dotVec2(relativePosition, scaledHalfAcceleration),
		2 * dotVec2(scaledVelocity, scaledHalfAcceleration),
		dotVec2(scaledHalfAcceleration, scaledHalfAcceleration)
	];
}

export function evaluateCircleCircleCandidate(
	query: CircleCirclePathQuery,
	contactDistanceTolerance: number,
	normalizedTime: number,
	searchDuration: number,
	combinedRadius: number
): CircleCircleCandidateEvaluation {
	const time = query.segment.startTime + normalizedTime * searchDuration;
	const position = evaluateMotionSegmentPosition(query.segment, time);
	const velocity = evaluateMotionSegmentVelocity(query.segment, time);
	const offset: Vec2 = [position[0] - query.circle.centre[0], position[1] - query.circle.centre[1]];
	const distance = Math.hypot(...offset);
	const normal = normaliseVec2(offset, contactDistanceTolerance);
	const normalVelocity = normal ? dotVec2(velocity, normal) : Number.NaN;
	const surfaceSeparation = Math.abs(distance - combinedRadius);
	if (
		![...position, ...velocity, distance, normalVelocity, surfaceSeparation].every(
			Number.isFinite
		) ||
		!normal
	) {
		return {
			type: 'unresolved',
			reason: 'A candidate contact could not be evaluated with finite stable geometry.'
		};
	}
	return {
		type: 'candidate',
		time,
		position,
		velocity,
		normal,
		normalVelocity,
		surfaceSeparation
	};
}

export function circleCircleSurfaceSeparation(
	query: CircleCirclePathQuery,
	combinedRadius: number,
	normalizedTime: number,
	searchDuration: number
): number {
	const time = query.segment.startTime + normalizedTime * searchDuration;
	const position = evaluateMotionSegmentPosition(query.segment, time);
	return (
		Math.hypot(position[0] - query.circle.centre[0], position[1] - query.circle.centre[1]) -
		combinedRadius
	);
}
