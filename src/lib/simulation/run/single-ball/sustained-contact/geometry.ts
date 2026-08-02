import type { StaticCollider, Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { dotVec2 } from '../../../math';
import type { SustainedContactRequest } from './types';

export function circularPosition(centre: Vec2, contactRadius: number, angle: number): Vec2 {
	return [centre[0] + contactRadius * Math.cos(angle), centre[1] + contactRadius * Math.sin(angle)];
}

export function colliderSeparation(
	position: Vec2,
	radius: number,
	collider: StaticCollider
): number {
	if ('centre' in collider) {
		return (
			Math.hypot(position[0] - collider.centre[0], position[1] - collider.centre[1]) -
			radius -
			collider.physicalShape.radius
		);
	}
	const start = collider.physicalShape.start;
	const end = collider.physicalShape.end;
	const delta: Vec2 = [end[0] - start[0], end[1] - start[1]];
	const lengthSquared = dotVec2(delta, delta);
	const fraction = Math.max(
		0,
		Math.min(1, dotVec2([position[0] - start[0], position[1] - start[1]], delta) / lengthSquared)
	);
	const closest: Vec2 = [start[0] + fraction * delta[0], start[1] + fraction * delta[1]];
	return Math.hypot(position[0] - closest[0], position[1] - closest[1]) - radius;
}

export function containsPosition(minimum: Vec2, maximum: Vec2, position: Vec2): boolean {
	return (
		position[0] >= minimum[0] &&
		position[0] <= maximum[0] &&
		position[1] >= minimum[1] &&
		position[1] <= maximum[1]
	);
}

export function outsideBounds(
	position: Vec2,
	halfWidth: number,
	height: number
): 'left' | 'right' | 'bottom' | 'top' | null {
	if (position[0] < -halfWidth) return 'left';
	if (position[0] > halfWidth) return 'right';
	if (position[1] < 0) return 'bottom';
	if (position[1] > height) return 'top';
	return null;
}

export function supportCandidate(
	request: SustainedContactRequest,
	time: number,
	position: Vec2,
	velocity: Vec2,
	normal: Vec2
): FixedWorldContactCandidate | null {
	const collider = request.input.scene.staticColliders.find(({ id }) => id === request.colliderId);
	if (!collider) return null;
	const feature = 'centre' in collider ? 'circle' : boundaryFeature(collider, normal);
	return {
		type: 'contact-candidate',
		bodyId: request.body.id,
		colliderId: collider.id,
		colliderKind: 'centre' in collider ? 'circle' : 'boundary',
		feature,
		time,
		position,
		contactPoint: [
			position[0] - normal[0] * request.body.physicalShape.radius,
			position[1] - normal[1] * request.body.physicalShape.radius
		],
		normal,
		normalVelocity: dotVec2(velocity, normal),
		response: 'non-impulsive-contact'
	};
}

export function colliderCandidateAtState(
	request: SustainedContactRequest,
	colliderId: string,
	time: number,
	position: Vec2,
	velocity: Vec2
): FixedWorldContactCandidate | null {
	const collider = request.input.scene.staticColliders.find(({ id }) => id === colliderId);
	if (!collider) return null;
	const geometry =
		'centre' in collider
			? circleContactGeometry(position, collider.centre, request.body.physicalShape.radius)
			: boundaryContactGeometry(position, collider);
	if (!geometry) return null;
	const normalVelocity = dotVec2(velocity, geometry.normal);
	return {
		type: 'contact-candidate',
		bodyId: request.body.id,
		colliderId,
		colliderKind: 'centre' in collider ? 'circle' : 'boundary',
		feature: geometry.feature,
		time,
		position,
		contactPoint: geometry.contactPoint,
		normal: geometry.normal,
		normalVelocity,
		response:
			normalVelocity < -request.input.settings.tolerances.eventTime
				? 'impact'
				: 'non-impulsive-contact'
	};
}

function circleContactGeometry(position: Vec2, centre: Vec2, ballRadius: number) {
	const offset: Vec2 = [position[0] - centre[0], position[1] - centre[1]];
	const distance = Math.hypot(...offset);
	if (!(distance > 0)) return null;
	const normal: Vec2 = [offset[0] / distance, offset[1] / distance];
	return {
		feature: 'circle' as const,
		contactPoint: [
			position[0] - normal[0] * ballRadius,
			position[1] - normal[1] * ballRadius
		] as Vec2,
		normal
	};
}

function boundaryContactGeometry(
	position: Vec2,
	collider: Exclude<StaticCollider, { centre: Vec2 }>
) {
	const start = collider.physicalShape.start;
	const end = collider.physicalShape.end;
	const delta: Vec2 = [end[0] - start[0], end[1] - start[1]];
	const lengthSquared = dotVec2(delta, delta);
	if (!(lengthSquared > 0)) return null;
	const fraction = Math.max(
		0,
		Math.min(1, dotVec2([position[0] - start[0], position[1] - start[1]], delta) / lengthSquared)
	);
	const contactPoint: Vec2 = [start[0] + fraction * delta[0], start[1] + fraction * delta[1]];
	const offset: Vec2 = [position[0] - contactPoint[0], position[1] - contactPoint[1]];
	const distance = Math.hypot(...offset);
	if (!(distance > 0)) return null;
	const normal: Vec2 = [offset[0] / distance, offset[1] / distance];
	return {
		feature:
			fraction === 0
				? ('start-endpoint' as const)
				: fraction === 1
					? ('end-endpoint' as const)
					: boundaryFeature(collider, normal),
		contactPoint,
		normal
	};
}

function boundaryFeature(collider: Exclude<StaticCollider, { centre: Vec2 }>, normal: Vec2) {
	const delta: Vec2 = [
		collider.physicalShape.end[0] - collider.physicalShape.start[0],
		collider.physicalShape.end[1] - collider.physicalShape.start[1]
	];
	const positive: Vec2 = [-delta[1], delta[0]];
	return dotVec2(positive, normal) >= 0
		? ('segment-face-positive' as const)
		: ('segment-face-negative' as const);
}
