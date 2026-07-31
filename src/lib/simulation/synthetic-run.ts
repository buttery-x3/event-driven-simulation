import type {
	MotionSegment,
	RunStatus,
	SimulationInput,
	SimulationRunRecord,
	Vec2
} from './contracts';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from './trajectory';
import { dotVec2, normaliseVec2 } from './vector';

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
	const eventPosition = evaluateMotionSegmentPosition(firstSegment, eventTime);
	const contactNormal = normaliseVec2(
		[eventPosition[0] - collider.centre[0], eventPosition[1] - collider.centre[1]],
		input.settings.tolerances.contactDistance
	);

	if (!contactNormal) {
		return stoppedRun(input, {
			type: 'invalid',
			reason: 'The configured contact tolerance does not permit a stable contact normal.'
		});
	}

	const incomingVelocity = evaluateMotionSegmentVelocity(firstSegment, eventTime);
	const normalVelocity = dotVec2(incomingVelocity, contactNormal);
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
