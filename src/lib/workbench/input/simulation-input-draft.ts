import type {
	InitialDynamicCircleBodyState,
	SimulationInput,
	Vec2
} from '$lib/simulation/contracts';
import {
	parseSimulationInputFixture,
	serializeSimulationInputFixture
} from '$lib/simulation/serialization/simulation-input';
import { convertSpeedAndAngleToVelocity, type VelocityEntryDraft } from './velocity-entry';

export interface DynamicBodyDraft extends VelocityEntryDraft {
	readonly id: string;
	readonly mass: string;
	readonly radius: string;
	readonly releaseTime: string;
	readonly positionX: string;
	readonly positionY: string;
}

export interface SimulationInputDraft {
	readonly bodies: readonly DynamicBodyDraft[];
	readonly gravityX: string;
	readonly gravityY: string;
	readonly restitution: string;
	readonly maximumSimulationTime: string;
	readonly maximumEvents: string;
}

export type SimulationInputField = string;

export interface SimulationInputValidationError {
	readonly field: SimulationInputField;
	readonly code: string;
	readonly message: string;
}

export type SimulationInputSubmissionResult =
	| { readonly valid: true; readonly input: SimulationInput; readonly velocities: readonly Vec2[] }
	| { readonly valid: false; readonly errors: readonly SimulationInputValidationError[] };

export function createSimulationInputDraft(input: SimulationInput): SimulationInputDraft {
	return {
		bodies: input.initialDynamicBodies.map(createBodyDraft),
		gravityX: String(input.settings.gravity[0]),
		gravityY: String(input.settings.gravity[1]),
		restitution: String(input.settings.restitution),
		maximumSimulationTime: String(input.settings.maximumSimulationTime),
		maximumEvents: String(input.settings.maximumEvents)
	};
}

export function appendScheduledBallDraft(draft: SimulationInputDraft): SimulationInputDraft {
	const template = draft.bodies.at(-1);
	if (!template) return draft;

	return {
		...draft,
		bodies: [
			...draft.bodies,
			{
				...template,
				id: nextBallId(draft.bodies),
				releaseTime: nextReleaseTime(draft.bodies)
			}
		]
	};
}

export function prepareSimulationInputSubmission(
	baseInput: SimulationInput,
	draft: SimulationInputDraft
): SimulationInputSubmissionResult {
	const errors: SimulationInputValidationError[] = [];
	const bodies = draft.bodies.map((bodyDraft, index) =>
		parseBodyDraft(
			baseInput.initialDynamicBodies[index] ?? baseInput.initialDynamicBodies[0],
			bodyDraft,
			index,
			errors
		)
	);
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

	if (draft.bodies.length === 0) {
		errors.push({
			field: 'scenario',
			code: 'INVALID_BODY_COUNT',
			message: 'The scenario must contain at least one dynamic body.'
		});
	}
	if (new Set(draft.bodies.map(({ id }) => id.trim())).size !== draft.bodies.length) {
		errors.push({
			field: 'scenario',
			code: 'DUPLICATE_BODY_ID',
			message: 'Body IDs must be unique.'
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

	if (
		bodies.some((body) => body === null) ||
		gravityX === null ||
		gravityY === null ||
		restitution === null ||
		maximumSimulationTime === null ||
		maximumEvents === null ||
		errors.length > 0
	) {
		return { valid: false, errors };
	}

	const candidate: SimulationInput = {
		...baseInput,
		initialDynamicBodies: bodies as readonly InitialDynamicCircleBodyState[],
		settings: {
			...baseInput.settings,
			gravity: [gravityX, gravityY],
			restitution,
			maximumEvents,
			maximumSimulationTime,
			tolerances: { ...baseInput.settings.tolerances }
		}
	};

	try {
		const input = deepFreeze(
			parseSimulationInputFixture(serializeSimulationInputFixture(candidate))
		);
		return {
			valid: true,
			input,
			velocities: input.initialDynamicBodies.map(({ velocity }) => velocity)
		};
	} catch (error) {
		return {
			valid: false,
			errors: [
				{
					field: 'scenario',
					code: 'INVALID_SIMULATION_INPUT',
					message: error instanceof Error ? error.message : 'The submitted input is invalid.'
				}
			]
		};
	}
}

function createBodyDraft(body: InitialDynamicCircleBodyState): DynamicBodyDraft {
	const speed = Math.hypot(...body.velocity);
	const angleDegrees =
		speed === 0 ? 0 : radiansToDegrees(Math.atan2(body.velocity[1], body.velocity[0]));
	return {
		id: body.id,
		mass: String(body.mass),
		radius: String(body.physicalShape.radius),
		releaseTime: String(body.releaseTime),
		positionX: String(body.position[0]),
		positionY: String(body.position[1]),
		velocityMode: 'speed-angle',
		speed: String(speed),
		angleDegrees: String(angleDegrees),
		velocityX: String(body.velocity[0]),
		velocityY: String(body.velocity[1])
	};
}

function parseBodyDraft(
	baseBody: InitialDynamicCircleBodyState | undefined,
	draft: DynamicBodyDraft,
	index: number,
	errors: SimulationInputValidationError[]
): InitialDynamicCircleBodyState | null {
	const prefix = `body.${index}`;
	const id = draft.id.trim();
	if (!id)
		errors.push({ field: `${prefix}.id`, code: 'REQUIRED', message: 'Body ID is required.' });
	const mass = parseFiniteField(`${prefix}.mass`, 'Body mass', draft.mass, errors);
	const radius = parseFiniteField(`${prefix}.radius`, 'Body radius', draft.radius, errors);
	const releaseTime = parseFiniteField(
		`${prefix}.releaseTime`,
		'Body release time',
		draft.releaseTime,
		errors
	);
	const positionX = parseFiniteField(
		`${prefix}.positionX`,
		'Initial position X',
		draft.positionX,
		errors
	);
	const positionY = parseFiniteField(
		`${prefix}.positionY`,
		'Initial position Y',
		draft.positionY,
		errors
	);
	const velocity = parseVelocity(draft, prefix, errors);

	if (mass !== null && mass <= 0)
		errors.push({
			field: `${prefix}.mass`,
			code: 'INVALID_MASS',
			message: 'Body mass must be greater than zero.'
		});
	if (radius !== null && radius <= 0)
		errors.push({
			field: `${prefix}.radius`,
			code: 'INVALID_RADIUS',
			message: 'Ball radius must be greater than zero.'
		});
	if (releaseTime !== null && releaseTime < 0)
		errors.push({
			field: `${prefix}.releaseTime`,
			code: 'INVALID_RELEASE_TIME',
			message: 'Release time cannot be negative.'
		});

	if (
		!baseBody ||
		!id ||
		mass === null ||
		radius === null ||
		releaseTime === null ||
		positionX === null ||
		positionY === null ||
		velocity === null ||
		mass <= 0 ||
		radius <= 0 ||
		releaseTime < 0
	)
		return null;

	return {
		...baseBody,
		id,
		mass,
		physicalShape: { ...baseBody.physicalShape, radius },
		releaseTime,
		position: [positionX, positionY],
		velocity
	};
}

function parseVelocity(
	draft: DynamicBodyDraft,
	prefix: string,
	errors: SimulationInputValidationError[]
): Vec2 | null {
	if (draft.velocityMode === 'speed-angle') {
		const speed = parseFiniteField(`${prefix}.speed`, 'Launch speed', draft.speed, errors);
		const angleDegrees = parseFiniteField(
			`${prefix}.angleDegrees`,
			'Launch angle',
			draft.angleDegrees,
			errors
		);
		if (speed !== null && speed < 0)
			errors.push({
				field: `${prefix}.speed`,
				code: 'NEGATIVE_SPEED',
				message: 'Launch speed must be zero or greater.'
			});
		return speed !== null && speed >= 0 && angleDegrees !== null
			? convertSpeedAndAngleToVelocity(speed, angleDegrees)
			: null;
	}
	const velocityX = parseFiniteField(`${prefix}.velocityX`, 'Velocity X', draft.velocityX, errors);
	const velocityY = parseFiniteField(`${prefix}.velocityY`, 'Velocity Y', draft.velocityY, errors);
	return velocityX !== null && velocityY !== null ? [velocityX, velocityY] : null;
}

function parseFiniteField(
	field: string,
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

function deepFreeze<T>(value: T): T {
	if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const nested of Object.values(value)) deepFreeze(nested);
	return value;
}

function radiansToDegrees(value: number): number {
	return (value * 180) / Math.PI;
}

function nextBallId(bodies: readonly DynamicBodyDraft[]): string {
	const ids = new Set(bodies.map(({ id }) => id.trim()));
	let suffix = bodies.length + 1;
	while (ids.has(`ball-${suffix}`)) suffix += 1;
	return `ball-${suffix}`;
}

function nextReleaseTime(bodies: readonly DynamicBodyDraft[]): string {
	const releaseTimes = bodies
		.map(({ releaseTime }) => Number(releaseTime))
		.filter((releaseTime) => Number.isFinite(releaseTime));
	return String(Math.max(0, ...releaseTimes) + 1);
}
