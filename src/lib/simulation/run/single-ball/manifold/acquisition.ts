import type {
	InitialDynamicCircleBodyState,
	SimulationInput,
	StaticCircleCollider,
	StaticCollider,
	Vec2
} from '../../../contracts';
import {
	defaultFixedWorldContactTolerances,
	type FixedWorldContactCandidate
} from '../../../collision';
import { dotVec2 } from '../../../math';

interface AlternatingObservation {
	readonly time: number;
	readonly manifoldKey: string;
	readonly colliderIds: readonly string[];
}

export interface AlternatingContactLimit {
	readonly candidates: readonly FixedWorldContactCandidate[];
	readonly position: Vec2;
	readonly sequenceColliderIds: readonly string[];
	readonly intervals: readonly number[];
	readonly stateDistance: number;
}

export function acquireAlternatingContactLimit(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	time: number,
	position: Vec2,
	velocity: Vec2,
	currentCandidates: readonly FixedWorldContactCandidate[],
	history: readonly AlternatingObservation[]
): AlternatingContactLimit | null {
	const sequence = alternatingSequence(time, currentCandidates, history);
	if (!sequence) return null;
	const colliders = sequence.colliderIds.map((id) =>
		input.scene.staticColliders.find((collider) => collider.id === id)
	);
	if (!colliders.every(isCircleCollider)) return null;
	const intersections = circleIntersections(
		colliders[0]!,
		colliders[1]!,
		body.physicalShape.radius,
		input.settings.tolerances.contactDistance
	);
	const limitPosition = intersections.sort(
		(left, right) => distance(left, position) - distance(right, position)
	)[0];
	if (!limitPosition) return null;
	const stateDistance = distance(limitPosition, position);
	const leftRadius = body.physicalShape.radius + colliders[0]!.physicalShape.radius;
	const rightRadius = body.physicalShape.radius + colliders[1]!.physicalShape.radius;
	const centresDistance = distance(colliders[0]!.centre, colliders[1]!.centre);
	const tangentLimit =
		Math.abs(centresDistance - leftRadius - rightRadius) <=
		input.settings.tolerances.contactDistance;
	const limitDistanceTolerance = tangentLimit
		? Math.sqrt(2 * Math.max(leftRadius, rightRadius) * input.settings.tolerances.contactDistance)
		: 8 * input.settings.tolerances.contactDistance;
	if (stateDistance > limitDistanceTolerance) return null;

	const states = input.scene.staticColliders.map((collider) => ({
		collider,
		state: contactState(limitPosition, body.physicalShape.radius, collider)
	}));
	if (
		states.some(
			({ state }) => state !== null && state.separation < -input.settings.tolerances.contactDistance
		)
	)
		return null;
	const candidates = states
		.filter(
			(entry): entry is { collider: StaticCollider; state: NonNullable<typeof entry.state> } =>
				entry.state !== null &&
				Math.abs(entry.state.separation) <= input.settings.tolerances.contactDistance
		)
		.map(({ collider, state }) => candidateAtLimit(body, collider, time, position, velocity, state))
		.sort(compareGeometry);
	if (!sequence.colliderIds.every((id) => candidates.some(({ colliderId }) => colliderId === id))) {
		return null;
	}

	return {
		candidates,
		position: limitPosition,
		sequenceColliderIds: sequence.colliderIds,
		intervals: sequence.intervals,
		stateDistance
	};
}

function alternatingSequence(
	time: number,
	currentCandidates: readonly FixedWorldContactCandidate[],
	history: readonly AlternatingObservation[]
): {
	readonly colliderIds: readonly [string, string];
	readonly intervals: readonly number[];
} | null {
	if (currentCandidates.length !== 1) return null;
	const current = currentCandidates[0]!;
	const observations = [
		...history,
		{
			time,
			manifoldKey: `${current.colliderId}:${current.feature}`,
			colliderIds: [current.colliderId]
		}
	].slice(-5);
	if (observations.length < 5 || observations.some(({ colliderIds }) => colliderIds.length !== 1)) {
		return null;
	}
	const keys = observations.map(({ manifoldKey }) => manifoldKey);
	if (keys[0] !== keys[2] || keys[2] !== keys[4] || keys[1] !== keys[3] || keys[0] === keys[1])
		return null;
	const intervals = observations.slice(1).map((observation, index) => {
		return observation.time - observations[index]!.time;
	});
	if (
		intervals.some((interval) => !(interval > 0)) ||
		intervals[3]! >= intervals[0]! ||
		intervals.slice(1).filter((interval, index) => interval < intervals[index]!).length < 2
	)
		return null;
	return {
		colliderIds: [observations[0]!.colliderIds[0]!, observations[1]!.colliderIds[0]!],
		intervals
	};
}

function circleIntersections(
	left: StaticCircleCollider,
	right: StaticCircleCollider,
	bodyRadius: number,
	tolerance: number
): Vec2[] {
	const delta: Vec2 = [right.centre[0] - left.centre[0], right.centre[1] - left.centre[1]];
	const centreDistance = Math.hypot(...delta);
	if (!(centreDistance > 0)) return [];
	const leftRadius = left.physicalShape.radius + bodyRadius;
	const rightRadius = right.physicalShape.radius + bodyRadius;
	if (
		centreDistance > leftRadius + rightRadius + tolerance ||
		centreDistance < Math.abs(leftRadius - rightRadius) - tolerance
	)
		return [];
	const along =
		(leftRadius * leftRadius - rightRadius * rightRadius + centreDistance * centreDistance) /
		(2 * centreDistance);
	const heightSquared = leftRadius * leftRadius - along * along;
	const heightToleranceSquared = 2 * Math.max(leftRadius, rightRadius) * tolerance;
	if (heightSquared < -heightToleranceSquared) return [];
	const unit: Vec2 = [delta[0] / centreDistance, delta[1] / centreDistance];
	const base: Vec2 = [left.centre[0] + along * unit[0], left.centre[1] + along * unit[1]];
	const height = Math.sqrt(heightSquared <= heightToleranceSquared ? 0 : heightSquared);
	if (height === 0) return [base];
	const perpendicular: Vec2 = [-unit[1], unit[0]];
	return [
		[base[0] + height * perpendicular[0], base[1] + height * perpendicular[1]],
		[base[0] - height * perpendicular[0], base[1] - height * perpendicular[1]]
	];
}

function contactState(position: Vec2, bodyRadius: number, collider: StaticCollider) {
	if ('centre' in collider) {
		const offset: Vec2 = [position[0] - collider.centre[0], position[1] - collider.centre[1]];
		const centreDistance = Math.hypot(...offset);
		if (!(centreDistance > 0)) return null;
		const normal: Vec2 = [offset[0] / centreDistance, offset[1] / centreDistance];
		return {
			separation: centreDistance - collider.physicalShape.radius - bodyRadius,
			contactPoint: [
				collider.centre[0] + collider.physicalShape.radius * normal[0],
				collider.centre[1] + collider.physicalShape.radius * normal[1]
			] as Vec2,
			normal,
			feature: 'circle' as const
		};
	}
	const start = collider.physicalShape.start;
	const edge: Vec2 = [
		collider.physicalShape.end[0] - start[0],
		collider.physicalShape.end[1] - start[1]
	];
	const lengthSquared = dotVec2(edge, edge);
	if (!(lengthSquared > 0)) return null;
	const fraction = Math.max(
		0,
		Math.min(1, dotVec2([position[0] - start[0], position[1] - start[1]], edge) / lengthSquared)
	);
	const contactPoint: Vec2 = [start[0] + fraction * edge[0], start[1] + fraction * edge[1]];
	const offset: Vec2 = [position[0] - contactPoint[0], position[1] - contactPoint[1]];
	const centreDistance = Math.hypot(...offset);
	if (!(centreDistance > 0)) return null;
	const normal: Vec2 = [offset[0] / centreDistance, offset[1] / centreDistance];
	return {
		separation: centreDistance - bodyRadius,
		contactPoint,
		normal,
		feature:
			fraction === 0
				? ('start-endpoint' as const)
				: fraction === 1
					? ('end-endpoint' as const)
					: dotVec2([-edge[1], edge[0]], normal) >= 0
						? ('segment-face-positive' as const)
						: ('segment-face-negative' as const)
	};
}

function candidateAtLimit(
	body: InitialDynamicCircleBodyState,
	collider: StaticCollider,
	time: number,
	position: Vec2,
	velocity: Vec2,
	state: NonNullable<ReturnType<typeof contactState>>
): FixedWorldContactCandidate {
	const normalVelocity = dotVec2(velocity, state.normal);
	return {
		type: 'contact-candidate',
		bodyId: body.id,
		colliderId: collider.id,
		colliderKind: 'centre' in collider ? 'circle' : 'boundary',
		feature: state.feature,
		time,
		position,
		contactPoint: state.contactPoint,
		normal: state.normal,
		normalVelocity,
		response:
			normalVelocity < -defaultFixedWorldContactTolerances.normalVelocity
				? 'impact'
				: 'non-impulsive-contact'
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

function isCircleCollider(collider: StaticCollider | undefined): collider is StaticCircleCollider {
	return collider?.physicalShape.type === 'circle';
}

function distance(left: Vec2, right: Vec2): number {
	return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
