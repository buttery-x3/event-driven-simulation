import type { BoardBounds, SimulationInput, Vec2 } from '../../contracts';
import { validateSceneDefinition } from '../../world';

export interface SimulationInputDiagnostic {
	readonly code:
		| 'INVALID_SCENE'
		| 'INVALID_BODY_COUNT'
		| 'INVALID_BODY_ID'
		| 'DUPLICATE_BODY_ID'
		| 'INVALID_RADIUS'
		| 'INVALID_POSITION'
		| 'INVALID_VELOCITY'
		| 'POSITION_OUTSIDE_BOUNDS'
		| 'INVALID_GRAVITY'
		| 'INVALID_RESTITUTION'
		| 'INVALID_MAXIMUM_EVENTS'
		| 'INVALID_MAXIMUM_TIME'
		| 'INVALID_TOLERANCES'
		| 'INVALID_SETTLEMENT_POLICY';
	readonly path: string;
	readonly message: string;
}

export function validateSingleBallInput(
	input: SimulationInput
): readonly SimulationInputDiagnostic[] {
	const sceneValidation = validateSceneDefinition(input.scene, '$.scene');
	if (!sceneValidation.valid) {
		const first = sceneValidation.diagnostics[0]!;
		return [{ code: 'INVALID_SCENE', path: first.path, message: first.message }];
	}

	if (input.initialDynamicBodies.length !== 1) {
		return [
			{
				code: 'INVALID_BODY_COUNT',
				path: '$.initialDynamicBodies',
				message: 'A single-ball run requires exactly one dynamic body.'
			}
		];
	}

	const body = input.initialDynamicBodies[0]!;
	if (body.id.trim().length === 0) {
		return [
			{
				code: 'INVALID_BODY_ID',
				path: '$.initialDynamicBodies[0].id',
				message: 'The dynamic body ID must be non-empty.'
			}
		];
	}
	if (
		input.scene.staticColliders.some(({ id }) => id === body.id) ||
		input.scene.terminationRegions.some(({ id }) => id === body.id)
	) {
		return [
			{
				code: 'DUPLICATE_BODY_ID',
				path: '$.initialDynamicBodies[0].id',
				message: `Dynamic body ID "${body.id}" duplicates a scene entity ID.`
			}
		];
	}
	if (!Number.isFinite(body.physicalShape.radius) || body.physicalShape.radius <= 0) {
		return [
			{
				code: 'INVALID_RADIUS',
				path: '$.initialDynamicBodies[0].physicalShape.radius',
				message: 'The dynamic body radius must be a positive finite number.'
			}
		];
	}
	if (!isFiniteVec2(body.position)) {
		return [
			{
				code: 'INVALID_POSITION',
				path: '$.initialDynamicBodies[0].position',
				message: 'The dynamic body position must contain finite numbers.'
			}
		];
	}
	if (!isFiniteVec2(body.velocity)) {
		return [
			{
				code: 'INVALID_VELOCITY',
				path: '$.initialDynamicBodies[0].velocity',
				message: 'The dynamic body velocity must contain finite numbers.'
			}
		];
	}
	if (!isInsideBounds(body.position, input.scene.bounds)) {
		return [
			{
				code: 'POSITION_OUTSIDE_BOUNDS',
				path: '$.initialDynamicBodies[0].position',
				message: 'The dynamic body initial position must be inside the supported scene bounds.'
			}
		];
	}

	const settings = input.settings;
	if (!isFiniteVec2(settings.gravity)) {
		return [
			{
				code: 'INVALID_GRAVITY',
				path: '$.settings.gravity',
				message: 'Gravity must contain finite numbers.'
			}
		];
	}
	if (
		!Number.isFinite(settings.restitution) ||
		settings.restitution < 0 ||
		settings.restitution > 1
	) {
		return [
			{
				code: 'INVALID_RESTITUTION',
				path: '$.settings.restitution',
				message: 'Restitution must be a finite number between zero and one.'
			}
		];
	}
	if (!Number.isInteger(settings.maximumEvents) || settings.maximumEvents < 0) {
		return [
			{
				code: 'INVALID_MAXIMUM_EVENTS',
				path: '$.settings.maximumEvents',
				message: 'The maximum event count must be a non-negative integer.'
			}
		];
	}
	if (!Number.isFinite(settings.maximumSimulationTime) || settings.maximumSimulationTime <= 0) {
		return [
			{
				code: 'INVALID_MAXIMUM_TIME',
				path: '$.settings.maximumSimulationTime',
				message: 'Maximum simulation time must be a positive finite number.'
			}
		];
	}
	if (
		!Number.isFinite(settings.tolerances.contactDistance) ||
		settings.tolerances.contactDistance <= 0 ||
		!Number.isFinite(settings.tolerances.eventTime) ||
		settings.tolerances.eventTime <= 0
	) {
		return [
			{
				code: 'INVALID_TOLERANCES',
				path: '$.settings.tolerances',
				message: 'Contact-distance and event-time tolerances must be positive finite numbers.'
			}
		];
	}
	if (settings.settlement && !isValidSettlementPolicy(settings.settlement)) {
		return [
			{
				code: 'INVALID_SETTLEMENT_POLICY',
				path: '$.settings.settlement',
				message:
					'Settlement thresholds must be finite, with non-negative speed thresholds and positive distance and pressing-acceleration thresholds.'
			}
		];
	}

	return [];
}

function isValidSettlementPolicy(policy: NonNullable<SimulationInput['settings']['settlement']>) {
	return (
		Number.isFinite(policy.maximumNormalSeparationSpeed) &&
		policy.maximumNormalSeparationSpeed >= 0 &&
		Number.isFinite(policy.maximumTangentialSpeed) &&
		policy.maximumTangentialSpeed >= 0 &&
		Number.isFinite(policy.contactDistance) &&
		policy.contactDistance > 0 &&
		Number.isFinite(policy.minimumPressingAcceleration) &&
		policy.minimumPressingAcceleration > 0
	);
}

function isInsideBounds(position: Vec2, bounds: BoardBounds): boolean {
	return (
		position[0] >= -bounds.width / 2 &&
		position[0] <= bounds.width / 2 &&
		position[1] >= 0 &&
		position[1] <= bounds.height
	);
}

function isFiniteVec2(vector: Vec2): boolean {
	return vector.every(Number.isFinite);
}
