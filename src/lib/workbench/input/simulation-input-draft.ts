import type { SimulationInput, Vec2 } from '$lib/simulation/contracts';
import { validateSingleBallInput, type SimulationInputDiagnostic } from '$lib/simulation/run';
import { convertSpeedAndAngleToVelocity, type VelocityEntryDraft } from './velocity-entry';

export interface SimulationInputDraft extends VelocityEntryDraft {
	readonly radius: string;
	readonly positionX: string;
	readonly positionY: string;
	readonly gravityX: string;
	readonly gravityY: string;
	readonly restitution: string;
	readonly maximumSimulationTime: string;
	readonly maximumEvents: string;
}

export type SimulationInputField = Exclude<keyof SimulationInputDraft, 'velocityMode'> | 'scenario';

export interface SimulationInputValidationError {
	readonly field: SimulationInputField;
	readonly code: string;
	readonly message: string;
}

export type SimulationInputSubmissionResult =
	| {
			readonly valid: true;
			readonly input: SimulationInput;
			readonly velocity: Vec2;
	  }
	| {
			readonly valid: false;
			readonly errors: readonly SimulationInputValidationError[];
	  };

export function createSimulationInputDraft(input: SimulationInput): SimulationInputDraft {
	const body = input.initialDynamicBodies[0];
	const position = body?.position ?? [0, 0];
	const velocity = body?.velocity ?? [0, 0];
	const speed = Math.hypot(...velocity);
	const angleDegrees = speed === 0 ? 0 : radiansToDegrees(Math.atan2(velocity[1], velocity[0]));

	return {
		radius: String(body?.physicalShape.radius ?? 0),
		positionX: String(position[0]),
		positionY: String(position[1]),
		velocityMode: 'speed-angle',
		speed: String(speed),
		angleDegrees: String(angleDegrees),
		velocityX: String(velocity[0]),
		velocityY: String(velocity[1]),
		gravityX: String(input.settings.gravity[0]),
		gravityY: String(input.settings.gravity[1]),
		restitution: String(input.settings.restitution),
		maximumSimulationTime: String(input.settings.maximumSimulationTime),
		maximumEvents: String(input.settings.maximumEvents)
	};
}

export function prepareSimulationInputSubmission(
	baseInput: SimulationInput,
	draft: SimulationInputDraft
): SimulationInputSubmissionResult {
	const errors: SimulationInputValidationError[] = [];
	const radius = parseFiniteField('radius', 'Ball radius', draft.radius, errors);
	const positionX = parseFiniteField('positionX', 'Initial position X', draft.positionX, errors);
	const positionY = parseFiniteField('positionY', 'Initial position Y', draft.positionY, errors);
	const gravityX = parseFiniteField('gravityX', 'Gravity X', draft.gravityX, errors);
	const gravityY = parseFiniteField('gravityY', 'Gravity Y', draft.gravityY, errors);
	const restitution = parseFiniteField(
		'restitution',
		'Bounciness (coefficient of restitution)',
		draft.restitution,
		errors
	);
	const maximumSimulationTime = parseFiniteField(
		'maximumSimulationTime',
		'Maximum simulation time',
		draft.maximumSimulationTime,
		errors
	);
	const maximumEvents = parseFiniteField(
		'maximumEvents',
		'Maximum event count',
		draft.maximumEvents,
		errors
	);

	if (radius !== null && radius <= 0) {
		errors.push({
			field: 'radius',
			code: 'INVALID_RADIUS',
			message: 'Ball radius must be greater than zero.'
		});
	}
	if (restitution !== null && (restitution < 0 || restitution > 1)) {
		errors.push({
			field: 'restitution',
			code: 'INVALID_RESTITUTION',
			message: 'Bounciness must be between zero and one.'
		});
	}
	if (maximumSimulationTime !== null && maximumSimulationTime <= 0) {
		errors.push({
			field: 'maximumSimulationTime',
			code: 'INVALID_MAXIMUM_TIME',
			message: 'Maximum simulation time must be greater than zero.'
		});
	}
	if (maximumEvents !== null && (!Number.isInteger(maximumEvents) || maximumEvents < 0)) {
		errors.push({
			field: 'maximumEvents',
			code: 'INVALID_MAXIMUM_EVENTS',
			message: 'Maximum event count must be a non-negative integer.'
		});
	}

	const velocity = parseVelocity(draft, errors);
	if (
		radius === null ||
		positionX === null ||
		positionY === null ||
		gravityX === null ||
		gravityY === null ||
		restitution === null ||
		maximumSimulationTime === null ||
		maximumEvents === null ||
		velocity === null ||
		errors.length > 0
	) {
		return { valid: false, errors };
	}

	const body = baseInput.initialDynamicBodies[0];
	if (!body) {
		return {
			valid: false,
			errors: [
				{
					field: 'scenario',
					code: 'INVALID_BODY_COUNT',
					message: 'The selected scenario must contain exactly one dynamic body.'
				}
			]
		};
	}

	const candidate: SimulationInput = {
		...baseInput,
		initialDynamicBodies: [
			{
				...body,
				physicalShape: { ...body.physicalShape, radius },
				position: [positionX, positionY],
				velocity
			}
		],
		settings: {
			...baseInput.settings,
			gravity: [gravityX, gravityY],
			restitution,
			maximumEvents,
			maximumSimulationTime,
			tolerances: { ...baseInput.settings.tolerances }
		}
	};
	const diagnostics = validateSingleBallInput(candidate);
	if (diagnostics.length > 0) {
		return {
			valid: false,
			errors: diagnostics.map(toSimulationInputValidationError)
		};
	}

	return {
		valid: true,
		input: deepFreeze(copySerializable(candidate)),
		velocity
	};
}

function parseVelocity(
	draft: SimulationInputDraft,
	errors: SimulationInputValidationError[]
): Vec2 | null {
	if (draft.velocityMode === 'speed-angle') {
		const speed = parseFiniteField('speed', 'Launch speed', draft.speed, errors);
		const angleDegrees = parseFiniteField(
			'angleDegrees',
			'Launch angle',
			draft.angleDegrees,
			errors
		);
		if (speed !== null && speed < 0) {
			errors.push({
				field: 'speed',
				code: 'NEGATIVE_SPEED',
				message: 'Launch speed must be zero or greater.'
			});
		}
		return speed !== null && speed >= 0 && angleDegrees !== null
			? convertSpeedAndAngleToVelocity(speed, angleDegrees)
			: null;
	}

	const velocityX = parseFiniteField('velocityX', 'Velocity X', draft.velocityX, errors);
	const velocityY = parseFiniteField('velocityY', 'Velocity Y', draft.velocityY, errors);
	return velocityX !== null && velocityY !== null ? [velocityX, velocityY] : null;
}

function parseFiniteField(
	field: Exclude<SimulationInputField, 'scenario'>,
	label: string,
	value: string,
	errors: SimulationInputValidationError[]
): number | null {
	if (value.trim().length === 0) {
		errors.push({ field, code: 'REQUIRED', message: `${label} is required.` });
		return null;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		errors.push({ field, code: 'NOT_FINITE', message: `${label} must be a finite number.` });
		return null;
	}

	return parsed;
}

function toSimulationInputValidationError(
	diagnostic: SimulationInputDiagnostic
): SimulationInputValidationError {
	const fieldByPath: Readonly<Record<string, SimulationInputField>> = {
		'$.initialDynamicBodies[0].physicalShape.radius': 'radius',
		'$.initialDynamicBodies[0].position': 'positionX',
		'$.initialDynamicBodies[0].velocity': 'velocityX',
		'$.settings.gravity': 'gravityX',
		'$.settings.restitution': 'restitution',
		'$.settings.maximumEvents': 'maximumEvents',
		'$.settings.maximumSimulationTime': 'maximumSimulationTime'
	};

	return {
		field: fieldByPath[diagnostic.path] ?? 'scenario',
		code: diagnostic.code,
		message: diagnostic.message
	};
}

function copySerializable<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
	if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const nested of Object.values(value)) deepFreeze(nested);
	return value;
}

function radiansToDegrees(value: number): number {
	return (value * 180) / Math.PI;
}
