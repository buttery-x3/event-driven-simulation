import type {
	InitialDynamicCircleBodyState,
	SimulationInput,
	StaticCircleCollider,
	StaticCollider,
	Vec2
} from '../../contracts';
import {
	defaultFixedWorldContactTolerances,
	type FixedWorldContactCandidate
} from '../../collision';
import { dotVec2 } from '../../math';
import type { AccumulationBodyState, AccumulationLimitContact } from './types';

export interface LimitGeometryResult {
	readonly bodyStates: readonly AccumulationBodyState[];
	readonly fixedCandidates: readonly FixedWorldContactCandidate[];
	readonly contacts: readonly AccumulationLimitContact[];
	readonly penetrations: readonly {
		readonly bodyId: string;
		readonly otherId: string;
		readonly separation: number;
	}[];
	readonly stateResiduals: readonly {
		readonly bodyId: string;
		readonly positionDistance: number;
		readonly velocityDistance: number;
	}[];
}

/**
 * Reconstruct limiting body states and the complete geometrically active contact graph.
 * Historical collider IDs seed nearby geometry; the active set is re-queried at the limit.
 *
 * Trajectory positions stay at the current certified event state when the remaining temporal
 * and state tails lie inside declared tolerances. Geometric multi-circle intersections are used
 * only to certify proximity and to rebuild contact normals, not to silently teleport bodies.
 */
export function reconstructLimitGeometry(input: {
	readonly simulation: SimulationInput;
	readonly currentBodies: readonly AccumulationBodyState[];
	readonly historicalFixedColliderIds: readonly string[];
	readonly currentTime: number;
	readonly candidateLimitTime: number;
	readonly remainingTimeUpperBound: number;
}): LimitGeometryResult | null {
	const { simulation, currentBodies, currentTime } = input;
	const contactDistance = simulation.settings.tolerances.contactDistance;
	const eventTime = simulation.settings.tolerances.eventTime;

	// Reject promotion when the unresolved temporal tail still implies an appreciable state drift.
	for (const body of currentBodies) {
		const positionResidualBound =
			Math.hypot(...body.velocity) * input.remainingTimeUpperBound +
			0.5 * Math.hypot(...simulation.settings.gravity) * input.remainingTimeUpperBound ** 2;
		const tolerant =
			input.remainingTimeUpperBound <= 64 * eventTime ||
			positionResidualBound <= 8 * Math.max(contactDistance, eventTime);
		if (!tolerant && currentBodies.length === 1) {
			// Single-body fixed multi-circle limits may still promote when the geometric limit is
			// already within the curvature-aware distance bound of the observed state.
			const geometric = geometricCircleLimitPosition(
				simulation,
				body,
				input.historicalFixedColliderIds,
				contactDistance
			);
			if (!geometric || geometric.distance > geometric.limitDistanceTolerance) return null;
		} else if (!tolerant) {
			return null;
		}
	}

	// Keep authoritative trajectory state at the current certified event (do not snap positions).
	const adjustedBodies = currentBodies.map((body) => ({ ...body }));
	if (adjustedBodies.some((body) => !isFiniteState(body))) return null;

	// Geometry for the complete limiting manifold is re-queried at the geometric limit when known;
	// body trajectory positions remain the current certified states.
	const geometryQueryBodies = adjustedBodies.map((body) => {
		if (adjustedBodies.length !== 1) return body;
		const geometric = geometricCircleLimitPosition(
			simulation,
			body,
			input.historicalFixedColliderIds,
			contactDistance
		);
		if (
			input.historicalFixedColliderIds.length >= 2 &&
			geometric &&
			geometric.distance > geometric.limitDistanceTolerance
		) {
			return null;
		}
		return geometric ? { ...body, position: geometric.position } : body;
	});
	if (geometryQueryBodies.some((body) => body === null)) return null;
	const queryBodies = geometryQueryBodies as AccumulationBodyState[];

	const fixedCandidates: FixedWorldContactCandidate[] = [];
	const contacts: AccumulationLimitContact[] = [];
	const penetrations: {
		bodyId: string;
		otherId: string;
		separation: number;
	}[] = [];
	const historicalFixed = new Set(input.historicalFixedColliderIds);

	for (let index = 0; index < queryBodies.length; index += 1) {
		const queryBody = queryBodies[index]!;
		const trajectoryBody = adjustedBodies[index]!;
		for (const collider of simulation.scene.staticColliders) {
			const state = contactState(queryBody.position, queryBody.radius, collider);
			if (!state) continue;
			if (state.separation < -contactDistance) {
				penetrations.push({
					bodyId: trajectoryBody.bodyId,
					otherId: collider.id,
					separation: state.separation
				});
				continue;
			}
			if (Math.abs(state.separation) > contactDistance) continue;
			// Candidate body position stays on the observed trajectory; normals come from the limit.
			const candidate = candidateAtLimit(trajectoryBody, collider, currentTime, state);
			fixedCandidates.push(candidate);
			contacts.push({
				id: `body-fixed:${trajectoryBody.bodyId}:${collider.id}:${state.feature}`,
				type: 'body-fixed',
				bodyId: trajectoryBody.bodyId,
				secondBodyId: null,
				colliderId: collider.id,
				contactPoint: state.contactPoint,
				normal: state.normal,
				separation: state.separation,
				feature: state.feature,
				retainedFromHistory: historicalFixed.has(collider.id),
				addedAtLimit: !historicalFixed.has(collider.id)
			});
		}
	}

	for (let first = 0; first < queryBodies.length; first += 1) {
		for (let second = first + 1; second < queryBodies.length; second += 1) {
			const left = queryBodies[first]!;
			const right = queryBodies[second]!;
			const offset: Vec2 = [
				right.position[0] - left.position[0],
				right.position[1] - left.position[1]
			];
			const centreDistance = Math.hypot(...offset);
			const combined = left.radius + right.radius;
			const separation = centreDistance - combined;
			if (separation < -contactDistance) {
				penetrations.push({
					bodyId: left.bodyId,
					otherId: right.bodyId,
					separation
				});
				continue;
			}
			if (Math.abs(separation) > contactDistance || !(centreDistance > 0)) continue;
			const normal: Vec2 = [offset[0] / centreDistance, offset[1] / centreDistance];
			const contactPoint: Vec2 = [
				left.position[0] + normal[0] * left.radius,
				left.position[1] + normal[1] * left.radius
			];
			contacts.push({
				id: `body-body:${left.bodyId}:${right.bodyId}`,
				type: 'body-body',
				bodyId: left.bodyId,
				secondBodyId: right.bodyId,
				colliderId: null,
				contactPoint,
				normal,
				separation,
				feature: 'circle-circle',
				retainedFromHistory: false,
				addedAtLimit: true
			});
		}
	}

	if (penetrations.length > 0) return null;
	if (contacts.length === 0) return null;

	const stateResiduals = adjustedBodies.map((body, index) => {
		const current = currentBodies[index]!;
		return {
			bodyId: body.bodyId,
			positionDistance: distance(body.position, current.position),
			velocityDistance: distance(body.velocity, current.velocity)
		};
	});

	// Historical fixed supports for a single body must remain present at the limit when they
	// participated in the certified sequence.
	if (adjustedBodies.length === 1) {
		for (const colliderId of input.historicalFixedColliderIds) {
			if (!contacts.some((contact) => contact.colliderId === colliderId)) {
				// Allow historical supports that truly leave at the limit only when another active
				// contact remains; otherwise fail closed.
				if (contacts.filter((contact) => contact.type === 'body-fixed').length === 0) {
					return null;
				}
			}
		}
	}

	return {
		bodyStates: adjustedBodies,
		fixedCandidates: fixedCandidates.sort(compareGeometry),
		contacts: contacts.sort((left, right) => left.id.localeCompare(right.id)),
		penetrations,
		stateResiduals
	};
}

function geometricCircleLimitPosition(
	simulation: SimulationInput,
	body: AccumulationBodyState,
	historicalFixedColliderIds: readonly string[],
	tolerance: number
): {
	readonly position: Vec2;
	readonly distance: number;
	readonly limitDistanceTolerance: number;
} | null {
	const circles = historicalFixedColliderIds
		.map((id) => simulation.scene.staticColliders.find((collider) => collider.id === id))
		.filter(
			(collider): collider is StaticCircleCollider => collider?.physicalShape.type === 'circle'
		);
	if (circles.length < 2) return null;
	const left = circles[0]!;
	const right = circles[1]!;
	const intersections = circleIntersections(left, right, body.radius, tolerance);
	const limitPosition = intersections.sort(
		(a, b) => distance(a, body.position) - distance(b, body.position)
	)[0];
	if (!limitPosition) return null;
	const leftRadius = body.radius + left.physicalShape.radius;
	const rightRadius = body.radius + right.physicalShape.radius;
	const centresDistance = distance(left.centre, right.centre);
	const tangentLimit =
		Math.abs(centresDistance - leftRadius - rightRadius) <= tolerance ||
		Math.abs(centresDistance - Math.abs(leftRadius - rightRadius)) <= tolerance;
	const limitDistanceTolerance = tangentLimit
		? Math.sqrt(2 * Math.max(leftRadius, rightRadius) * tolerance)
		: 8 * tolerance;
	return {
		position: limitPosition,
		distance: distance(limitPosition, body.position),
		limitDistanceTolerance
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
	body: AccumulationBodyState,
	collider: StaticCollider,
	time: number,
	state: NonNullable<ReturnType<typeof contactState>>
): FixedWorldContactCandidate {
	const normalVelocity = dotVec2(body.velocity, state.normal);
	return {
		type: 'contact-candidate',
		bodyId: body.bodyId,
		colliderId: collider.id,
		colliderKind: 'centre' in collider ? 'circle' : 'boundary',
		feature: state.feature,
		time,
		position: body.position,
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

function isFiniteState(body: AccumulationBodyState): boolean {
	return (
		body.position.every(Number.isFinite) &&
		body.velocity.every(Number.isFinite) &&
		Number.isFinite(body.mass) &&
		Number.isFinite(body.radius)
	);
}

function distance(left: Vec2, right: Vec2): number {
	return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

export function toAccumulationBody(
	body: InitialDynamicCircleBodyState,
	position: Vec2,
	velocity: Vec2
): AccumulationBodyState {
	return {
		bodyId: body.id,
		mass: body.mass,
		radius: body.physicalShape.radius,
		position,
		velocity
	};
}
