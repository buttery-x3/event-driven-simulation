import type { RunTerminalReason, SimulationInput, StaticLineSegmentCollider, Vec2 } from '../../contracts';
import { dotVec2 } from '../../math';

export function classifySettlement(
	input: SimulationInput,
	ballRadius: number,
	colliderId: string,
	time: number,
	position: Vec2,
	normal: Vec2,
	contactPoint: Vec2,
	outgoingVelocity: Vec2
): Extract<RunTerminalReason, { type: 'settled-supporting-surface' }> | null {
	const policy = input.settings.settlement;
	if (!policy) return null;

	const collider = input.scene.staticColliders.find(
		(candidate): candidate is StaticLineSegmentCollider =>
			candidate.id === colliderId && candidate.physicalShape.type === 'line-segment'
	);
	if (!collider || collider.surfaceRole !== 'supporting-flat') return null;

	const normalSeparationSpeed = dotVec2(outgoingVelocity, normal);
	const tangent: Vec2 = [-normal[1], normal[0]];
	const tangentialSpeed = Math.abs(dotVec2(outgoingVelocity, tangent));
	const pressingAcceleration = -dotVec2(input.settings.gravity, normal);
	const contactSeparation = Math.hypot(
		position[0] - contactPoint[0],
		position[1] - contactPoint[1]
	);

	if (
		normalSeparationSpeed < -input.settings.tolerances.eventTime ||
		normalSeparationSpeed > policy.maximumNormalSeparationSpeed ||
		tangentialSpeed > policy.maximumTangentialSpeed ||
		pressingAcceleration < policy.minimumPressingAcceleration ||
		Math.abs(contactSeparation - ballRadius) > policy.contactDistance
	) {
		return null;
	}

	return {
		type: 'settled-supporting-surface',
		time,
		colliderId,
		position,
		normalSeparationSpeed,
		tangentialSpeed
	};
}
