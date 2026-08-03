import type {
	BoardBounds,
	InitialDynamicCircleBodyState,
	SimulationInput,
	Vec2
} from '../../contracts';
import { validateSceneDefinition } from '../../world';

export interface SimulationInputDiagnostic {
	readonly code:
		| 'INVALID_SCENE'
		| 'INVALID_BODY_COUNT'
		| 'INVALID_BODY_ID'
		| 'DUPLICATE_BODY_ID'
		| 'INVALID_RADIUS'
		| 'INVALID_MASS'
		| 'INVALID_RELEASE_TIME'
		| 'UNSUPPORTED_RELEASE_TIME'
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

export function validateSimulationInput(
	input: SimulationInput
): readonly SimulationInputDiagnostic[] {
	const sceneValidation = validateSceneDefinition(input.scene, '$.scene');
	if (!sceneValidation.valid) {
		const first = sceneValidation.diagnostics[0]!;
		return [{ code: 'INVALID_SCENE', path: first.path, message: first.message }];
	}

	const settingsDiagnostic = validateSettings(input);
	if (settingsDiagnostic) return [settingsDiagnostic];
	if (input.initialDynamicBodies.length === 0) {
		return [
			{
				code: 'INVALID_BODY_COUNT',
				path: '$.initialDynamicBodies',
				message: 'A simulation requires at least one dynamic body.'
			}
		];
	}

	const seen = new Set<string>();
	for (const [index, body] of input.initialDynamicBodies.entries()) {
		const diagnostic = validateBody(input, body, index, seen);
		if (diagnostic) return [diagnostic];
		seen.add(body.id);
	}
	return [];
}

export function validateSingleBallInput(
	input: SimulationInput
): readonly SimulationInputDiagnostic[] {
	if (input.initialDynamicBodies.length !== 1) {
		return [
			{
				code: 'INVALID_BODY_COUNT',
				path: '$.initialDynamicBodies',
				message: 'A single-ball run requires exactly one dynamic body.'
			}
		];
	}
	const diagnostics = validateSimulationInput(input);
	if (diagnostics.length > 0) return diagnostics;
	if (input.initialDynamicBodies[0]!.releaseTime !== 0) {
		return [
			{
				code: 'UNSUPPORTED_RELEASE_TIME',
				path: '$.initialDynamicBodies[0].releaseTime',
				message: 'The compatibility single-ball input requires release time zero.'
			}
		];
	}
	return [];
}

function validateSettings(input: SimulationInput): SimulationInputDiagnostic | null {
	const settings = input.settings;
	if (!isFiniteVec2(settings.gravity)) {
		return {
			code: 'INVALID_GRAVITY',
			path: '$.settings.gravity',
			message: 'Gravity must contain finite numbers.'
		};
	}
	if (
		!Number.isFinite(settings.restitution) ||
		settings.restitution < 0 ||
		settings.restitution > 1
	) {
		return {
			code: 'INVALID_RESTITUTION',
			path: '$.settings.restitution',
			message: 'Restitution must be a finite number between zero and one.'
		};
	}
	if (!Number.isInteger(settings.maximumEvents) || settings.maximumEvents < 0) {
		return {
			code: 'INVALID_MAXIMUM_EVENTS',
			path: '$.settings.maximumEvents',
			message: 'The maximum event count must be a non-negative integer.'
		};
	}
	if (!Number.isFinite(settings.maximumSimulationTime) || settings.maximumSimulationTime <= 0) {
		return {
			code: 'INVALID_MAXIMUM_TIME',
			path: '$.settings.maximumSimulationTime',
			message: 'Maximum simulation time must be a positive finite number.'
		};
	}
	if (
		!Number.isFinite(settings.tolerances.contactDistance) ||
		settings.tolerances.contactDistance <= 0 ||
		!Number.isFinite(settings.tolerances.eventTime) ||
		settings.tolerances.eventTime <= 0
	) {
		return {
			code: 'INVALID_TOLERANCES',
			path: '$.settings.tolerances',
			message: 'Contact-distance and event-time tolerances must be positive finite numbers.'
		};
	}
	return null;
}

function validateBody(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	index: number,
	seen: ReadonlySet<string>
): SimulationInputDiagnostic | null {
	const path = `$.initialDynamicBodies[${index}]`;
	if (body.id.trim().length === 0) {
		return { code: 'INVALID_BODY_ID', path: `${path}.id`, message: 'Body IDs must be non-empty.' };
	}
	if (
		seen.has(body.id) ||
		input.scene.staticColliders.some(({ id }) => id === body.id) ||
		input.scene.terminationRegions.some(({ id }) => id === body.id)
	) {
		return {
			code: 'DUPLICATE_BODY_ID',
			path: `${path}.id`,
			message: `Dynamic body ID "${body.id}" must be unique across the scene.`
		};
	}
	if (!Number.isFinite(body.physicalShape.radius) || body.physicalShape.radius <= 0) {
		return {
			code: 'INVALID_RADIUS',
			path: `${path}.physicalShape.radius`,
			message: 'Dynamic body radii must be positive finite numbers.'
		};
	}
	if (!Number.isFinite(body.mass) || body.mass <= 0) {
		return {
			code: 'INVALID_MASS',
			path: `${path}.mass`,
			message: 'Dynamic body masses must be positive finite numbers.'
		};
	}
	if (!Number.isFinite(body.releaseTime) || body.releaseTime < 0) {
		return {
			code: 'INVALID_RELEASE_TIME',
			path: `${path}.releaseTime`,
			message: 'Release times must be finite and non-negative.'
		};
	}
	if (!isFiniteVec2(body.position)) {
		return {
			code: 'INVALID_POSITION',
			path: `${path}.position`,
			message: 'Dynamic body positions must contain finite numbers.'
		};
	}
	if (!isFiniteVec2(body.velocity)) {
		return {
			code: 'INVALID_VELOCITY',
			path: `${path}.velocity`,
			message: 'Dynamic body velocities must contain finite numbers.'
		};
	}
	if (!isInsideBounds(body.position, input.scene.bounds)) {
		return {
			code: 'POSITION_OUTSIDE_BOUNDS',
			path: `${path}.position`,
			message: 'Dynamic body initial positions must be inside the supported scene bounds.'
		};
	}
	return null;
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
