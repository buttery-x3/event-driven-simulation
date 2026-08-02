import type { SimulationInput, SimulationRunRecord, Vec2 } from '$lib/simulation/contracts';
import {
	constructSingleBallRun,
	validateSingleBallInput,
	type SimulationInputDiagnostic
} from '$lib/simulation/run';

export type VelocityEntryMode = 'speed-angle' | 'components';

export interface LaunchDraft {
	readonly positionX: string;
	readonly positionY: string;
	readonly velocityMode: VelocityEntryMode;
	readonly speed: string;
	readonly angleDegrees: string;
	readonly velocityX: string;
	readonly velocityY: string;
}

export type LaunchField =
	'positionX' | 'positionY' | 'speed' | 'angleDegrees' | 'velocityX' | 'velocityY' | 'scenario';

export interface LaunchValidationError {
	readonly field: LaunchField;
	readonly code: string;
	readonly message: string;
}

export type LaunchSubmissionResult =
	| {
			readonly valid: true;
			readonly input: SimulationInput;
			readonly velocity: Vec2;
	  }
	| {
			readonly valid: false;
			readonly errors: readonly LaunchValidationError[];
	  };

export interface CompletedLaunchCalculation {
	readonly submittedInput: SimulationInput;
	readonly run: SimulationRunRecord;
}

export function createLaunchDraft(input: SimulationInput): LaunchDraft {
	const body = input.initialDynamicBodies[0];
	const position = body?.position ?? [0, 0];
	const velocity = body?.velocity ?? [0, 0];
	const speed = Math.hypot(...velocity);
	const angleDegrees = speed === 0 ? 0 : radiansToDegrees(Math.atan2(velocity[1], velocity[0]));

	return {
		positionX: String(position[0]),
		positionY: String(position[1]),
		velocityMode: 'speed-angle',
		speed: String(speed),
		angleDegrees: String(angleDegrees),
		velocityX: String(velocity[0]),
		velocityY: String(velocity[1])
	};
}

export function convertSpeedAndAngleToVelocity(speed: number, angleDegrees: number): Vec2 {
	const angleRadians = degreesToRadians(angleDegrees);
	return normalizeVectorComponent([speed * Math.cos(angleRadians), speed * Math.sin(angleRadians)]);
}

export function changeVelocityEntryMode(draft: LaunchDraft, mode: VelocityEntryMode): LaunchDraft {
	if (draft.velocityMode === mode) return draft;

	if (mode === 'components') {
		const speed = Number(draft.speed);
		const angleDegrees = Number(draft.angleDegrees);
		if (!Number.isFinite(speed) || !Number.isFinite(angleDegrees) || speed < 0) {
			return { ...draft, velocityMode: mode };
		}
		const velocity = convertSpeedAndAngleToVelocity(speed, angleDegrees);
		return {
			...draft,
			velocityMode: mode,
			velocityX: String(velocity[0]),
			velocityY: String(velocity[1])
		};
	}

	const velocityX = Number(draft.velocityX);
	const velocityY = Number(draft.velocityY);
	if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) {
		return { ...draft, velocityMode: mode };
	}
	const speed = Math.hypot(velocityX, velocityY);
	return {
		...draft,
		velocityMode: mode,
		speed: String(speed),
		angleDegrees: String(speed === 0 ? 0 : radiansToDegrees(Math.atan2(velocityY, velocityX)))
	};
}

export function prepareLaunchSubmission(
	baseInput: SimulationInput,
	draft: LaunchDraft
): LaunchSubmissionResult {
	const errors: LaunchValidationError[] = [];
	const positionX = parseFiniteField('positionX', 'Initial position X', draft.positionX, errors);
	const positionY = parseFiniteField('positionY', 'Initial position Y', draft.positionY, errors);
	let velocity: Vec2 | null = null;

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
		if (speed !== null && speed >= 0 && angleDegrees !== null) {
			velocity = convertSpeedAndAngleToVelocity(speed, angleDegrees);
		}
	} else {
		const velocityX = parseFiniteField('velocityX', 'Velocity X', draft.velocityX, errors);
		const velocityY = parseFiniteField('velocityY', 'Velocity Y', draft.velocityY, errors);
		if (velocityX !== null && velocityY !== null) velocity = [velocityX, velocityY];
	}

	if (positionX === null || positionY === null || velocity === null || errors.length > 0) {
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
				physicalShape: { ...body.physicalShape },
				position: [positionX, positionY],
				velocity
			}
		],
		settings: {
			...baseInput.settings,
			gravity: [...baseInput.settings.gravity],
			tolerances: { ...baseInput.settings.tolerances },
			...(baseInput.settings.settlement ? { settlement: { ...baseInput.settings.settlement } } : {})
		}
	};
	const diagnostics = validateSingleBallInput(candidate);
	if (diagnostics.length > 0) {
		return {
			valid: false,
			errors: diagnostics.map(toLaunchValidationError)
		};
	}

	return {
		valid: true,
		input: deepFreeze(copySerializable(candidate)),
		velocity
	};
}

export function executeLaunchSubmission(input: SimulationInput): CompletedLaunchCalculation {
	return {
		submittedInput: input,
		run: constructSingleBallRun(input)
	};
}

function parseFiniteField(
	field: Exclude<LaunchField, 'scenario'>,
	label: string,
	value: string,
	errors: LaunchValidationError[]
): number | null {
	if (value.trim().length === 0) {
		errors.push({
			field,
			code: 'REQUIRED',
			message: `${label} is required.`
		});
		return null;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		errors.push({
			field,
			code: 'NOT_FINITE',
			message: `${label} must be a finite number.`
		});
		return null;
	}

	return parsed;
}

function toLaunchValidationError(diagnostic: SimulationInputDiagnostic): LaunchValidationError {
	const field =
		diagnostic.path === '$.initialDynamicBodies[0].position'
			? 'positionX'
			: diagnostic.path === '$.initialDynamicBodies[0].velocity'
				? 'velocityX'
				: 'scenario';

	return {
		field,
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

function degreesToRadians(value: number): number {
	return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
	return (value * 180) / Math.PI;
}

function normalizeVectorComponent(vector: Vec2): Vec2 {
	return vector.map((component) =>
		Math.abs(component) < 1e-15 ? 0 : component
	) as unknown as Vec2;
}
