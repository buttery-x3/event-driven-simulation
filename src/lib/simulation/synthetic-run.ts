import type {
	BodyTrajectory,
	MotionSegment,
	RunStatus,
	SimulationInput,
	SimulationRunRecord,
	Vec2
} from './contracts';

export function evaluateMotionSegment(segment: MotionSegment, time: number): Vec2 {
	const elapsed = time - segment.startTime;
	const elapsedSquared = elapsed * elapsed;

	return [
		segment.startPosition[0] +
			segment.startVelocity[0] * elapsed +
			0.5 * segment.acceleration[0] * elapsedSquared,
		segment.startPosition[1] +
			segment.startVelocity[1] * elapsed +
			0.5 * segment.acceleration[1] * elapsedSquared
	];
}

export function evaluateBodyTrajectory(trajectory: BodyTrajectory, time: number): Vec2 | null {
	const segment = trajectory.segments.find(
		(candidate) => time >= candidate.startTime && time <= candidate.endTime
	);

	return segment ? evaluateMotionSegment(segment, time) : null;
}

export function generateSyntheticRun(input: SimulationInput): SimulationRunRecord {
	const body = input.initialBodies[0];
	const collider = input.scene.fixedCircles[0];

	if (input.initialBodies.length !== 1 || !body) {
		return stoppedRun(input, { type: 'invalid', reason: 'A synthetic run requires one body.' });
	}

	if (!collider) {
		return stoppedRun(input, {
			type: 'invalid',
			reason: 'A synthetic run requires one fixed circle for its representative contact.'
		});
	}

	if (
		!Number.isFinite(input.settings.maximumSimulationTime) ||
		input.settings.maximumSimulationTime <= 0
	) {
		return stoppedRun(input, {
			type: 'invalid',
			reason: 'Maximum simulation time must be a positive finite number.'
		});
	}

	if (input.settings.maximumEvents < 1) {
		return stoppedRun(input, {
			type: 'iteration-limited',
			reason: 'The configured event limit does not permit the synthetic contact.'
		});
	}

	const eventTime = input.settings.maximumSimulationTime / 2;
	const firstSegment: MotionSegment = {
		bodyId: body.id,
		startTime: 0,
		endTime: eventTime,
		startPosition: body.position,
		startVelocity: body.velocity,
		acceleration: input.settings.gravity
	};
	const eventPosition = evaluateMotionSegment(firstSegment, eventTime);
	const contactNormal = normalise(
		[eventPosition[0] - collider.centre[0], eventPosition[1] - collider.centre[1]],
		input.settings.tolerances.contactDistance
	);

	if (!contactNormal) {
		return stoppedRun(input, {
			type: 'invalid',
			reason: 'The configured contact tolerance does not permit a stable contact normal.'
		});
	}

	const incomingVelocity = evaluateVelocity(firstSegment, eventTime);
	const normalVelocity = dot(incomingVelocity, contactNormal);
	const restitutionScale = (1 + input.settings.restitution) * normalVelocity;
	const outgoingVelocity: Vec2 = [
		incomingVelocity[0] - restitutionScale * contactNormal[0],
		incomingVelocity[1] - restitutionScale * contactNormal[1]
	];
	const secondSegment: MotionSegment = {
		bodyId: body.id,
		startTime: eventTime,
		endTime: input.settings.maximumSimulationTime,
		startPosition: eventPosition,
		startVelocity: outgoingVelocity,
		acceleration: input.settings.gravity
	};

	return {
		contractVersion: 1,
		input,
		status: { type: 'complete' },
		trajectories: [{ bodyId: body.id, segments: [firstSegment, secondSegment] }],
		events: [
			{
				type: 'contact',
				time: eventTime,
				bodyId: body.id,
				colliderId: collider.id,
				position: eventPosition,
				normal: contactNormal
			}
		],
		diagnostics: {
			iterations: 1,
			simulatedUntilTime: input.settings.maximumSimulationTime,
			entries: [
				{
					severity: 'info',
					code: 'SYNTHETIC_CONTACT_GENERATED',
					message: 'Generated the configured synthetic trajectory and representative contact.',
					time: eventTime,
					bodyId: body.id
				}
			]
		}
	};
}

function evaluateVelocity(segment: MotionSegment, time: number): Vec2 {
	const elapsed = time - segment.startTime;

	return [
		segment.startVelocity[0] + segment.acceleration[0] * elapsed,
		segment.startVelocity[1] + segment.acceleration[1] * elapsed
	];
}

function normalise(vector: Vec2, tolerance: number): Vec2 | null {
	const length = Math.hypot(vector[0], vector[1]);

	if (!Number.isFinite(length) || length <= tolerance) {
		return null;
	}

	return [vector[0] / length, vector[1] / length];
}

function dot(left: Vec2, right: Vec2): number {
	return left[0] * right[0] + left[1] * right[1];
}

function stoppedRun(input: SimulationInput, status: Exclude<RunStatus, { type: 'complete' }>) {
	return {
		contractVersion: 1,
		input,
		status,
		trajectories: [],
		events: [],
		diagnostics: {
			iterations: 0,
			simulatedUntilTime: 0,
			entries: [
				{
					severity: status.type === 'invalid' ? ('error' as const) : ('warning' as const),
					code:
						status.type === 'invalid' ? 'SYNTHETIC_INPUT_INVALID' : 'SYNTHETIC_EVENT_LIMIT_REACHED',
					message: status.reason,
					time: null,
					bodyId: null
				}
			]
		}
	} satisfies SimulationRunRecord;
}
