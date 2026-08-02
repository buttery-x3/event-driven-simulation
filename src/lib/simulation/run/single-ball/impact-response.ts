import type { SimulationInput, Vec2 } from '../../contracts';
import { dotVec2 } from '../../math';

export interface ImpactObservation {
	readonly colliderId: string;
	readonly time: number;
	readonly incomingNormalSpeed: number;
}

export interface ImpactResponse {
	readonly outgoingVelocity: Vec2;
	readonly enterSustainedContact: boolean;
	readonly collapseReason:
		'zero-restitution' | 'contracting-impacts' | 'initial-supported-state' | null;
}

export function resolveImpactResponse(
	input: SimulationInput,
	colliderId: string,
	time: number,
	normal: Vec2,
	incomingVelocity: Vec2,
	history: readonly ImpactObservation[]
): ImpactResponse | null {
	const normalVelocity = dotVec2(incomingVelocity, normal);
	const responseScale = (1 + input.settings.restitution) * normalVelocity;
	const outgoingVelocity: Vec2 = [
		incomingVelocity[0] - responseScale * normal[0],
		incomingVelocity[1] - responseScale * normal[1]
	];
	if (!Number.isFinite(responseScale) || !outgoingVelocity.every(Number.isFinite)) return null;

	const pressingAcceleration = -dotVec2(input.settings.gravity, normal);
	if (pressingAcceleration <= 0 || normalVelocity > input.settings.tolerances.eventTime) {
		return { outgoingVelocity, enterSustainedContact: false, collapseReason: null };
	}
	if (
		time === 0 &&
		Math.abs(normalVelocity) <= input.settings.tolerances.eventTime &&
		history.length === 0
	) {
		return {
			outgoingVelocity,
			enterSustainedContact: true,
			collapseReason: 'initial-supported-state'
		};
	}

	if (input.settings.restitution === 0) {
		return {
			outgoingVelocity,
			enterSustainedContact: true,
			collapseReason: 'zero-restitution'
		};
	}

	const sameCollider = history
		.filter((observation) => observation.colliderId === colliderId)
		.slice(-2);
	if (sameCollider.length < 2) {
		return { outgoingVelocity, enterSustainedContact: false, collapseReason: null };
	}

	const previous = sameCollider[1]!;
	const beforePrevious = sameCollider[0]!;
	const previousInterval = previous.time - beforePrevious.time;
	const currentInterval = time - previous.time;
	const currentApproachSpeed = Math.max(0, -normalVelocity);
	const speedThreshold = Math.sqrt(
		2 * pressingAcceleration * input.settings.tolerances.contactDistance
	);
	const contracting =
		previousInterval > input.settings.tolerances.eventTime &&
		currentInterval > input.settings.tolerances.eventTime &&
		currentInterval < previousInterval &&
		currentApproachSpeed < previous.incomingNormalSpeed;
	const ratio = contracting ? currentInterval / previousInterval : 1;
	const predictedRemainingTime = ratio < 1 ? (currentInterval * ratio) / (1 - ratio) : Infinity;
	const nearbyWindow = Math.max(
		64 * input.settings.tolerances.eventTime,
		8 * Math.sqrt(input.settings.tolerances.contactDistance / pressingAcceleration)
	);

	return {
		outgoingVelocity,
		enterSustainedContact:
			contracting &&
			currentApproachSpeed * input.settings.restitution <= 2 * speedThreshold &&
			predictedRemainingTime <= nearbyWindow,
		collapseReason:
			contracting &&
			currentApproachSpeed * input.settings.restitution <= 2 * speedThreshold &&
			predictedRemainingTime <= nearbyWindow
				? 'contracting-impacts'
				: null
	};
}
