import type { EntityId, Vec2 } from '../../contracts';
import type { FixedWorldContactCandidate } from '../../collision';
import type { ImpactObservation } from '../single-ball/impact';
import type { AccumulationPhysicalEvent } from './types';

/**
 * Adapt single-ball impact observations into accumulation physical events.
 * Each observation is one positive-time physical contact event, never a solver iteration.
 */
export function physicalEventsFromImpactHistory(
	history: readonly ImpactObservation[],
	current: {
		readonly time: number;
		readonly bodyId: EntityId;
		readonly mass: number;
		readonly radius: number;
		readonly position: Vec2;
		readonly velocity: Vec2;
		readonly candidates: readonly FixedWorldContactCandidate[];
	}
): readonly AccumulationPhysicalEvent[] {
	const prior = history.map((observation, index) => {
		const colliderIds = observation.colliderIds;
		return {
			eventId: `impact-history:${index}:${observation.time}:${colliderIds.join('+')}`,
			time: observation.time,
			participantBodyIds: [current.bodyId],
			fixedColliderIds: colliderIds,
			dynamicPartnerBodyIds: [] as string[],
			contactEdgeKeys: observation.manifoldKey.split('|'),
			bodyStates: [
				{
					bodyId: current.bodyId,
					mass: current.mass,
					radius: current.radius,
					// Historical positions are not retained on ImpactObservation; residual checks use
					// the current certified state at promotion time.
					position: current.position,
					velocity: current.velocity
				}
			],
			maxRelativeNormalSpeed: observation.incomingNormalSpeed
		};
	});
	const currentColliders = [
		...new Set(current.candidates.map(({ colliderId }) => colliderId))
	].sort();
	const currentEvent: AccumulationPhysicalEvent = {
		eventId: `impact-history:current:${current.time}:${currentColliders.join('+')}`,
		time: current.time,
		participantBodyIds: [current.bodyId],
		fixedColliderIds: currentColliders,
		dynamicPartnerBodyIds: [],
		contactEdgeKeys: current.candidates.map(
			({ colliderId, feature }) => `${colliderId}:${feature}`
		),
		bodyStates: [
			{
				bodyId: current.bodyId,
				mass: current.mass,
				radius: current.radius,
				position: current.position,
				velocity: current.velocity
			}
		],
		maxRelativeNormalSpeed: Math.max(
			0,
			...current.candidates.map(({ normalVelocity }) => -normalVelocity)
		)
	};
	return [...prior, currentEvent];
}
