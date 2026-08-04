import type { DynamicContactRecord, InitialDynamicCircleBodyState, Vec2 } from '../../contracts';
import { evaluateBodyTrajectoryPosition, evaluateMotionSegmentVelocity } from '../../motion';
import { nearVector, stateTolerance, timeTolerance } from '../history';
import { reportRunValidationFailure, type RunValidationContext } from '../results';

const earlierOverlapSampleCount = 32;

export function validateDynamicBodyContacts(context: RunValidationContext): void {
	for (const [contactIndex, contact] of context.run.dynamicContacts.entries()) {
		const terminalDiscovery =
			context.run.terminalReason.type === 'unsupported-body-body-response' &&
			context.run.terminalReason.contactId === contact.id;
		const continuousPrediction = context.run.diagnostics.pairPredictions.some(
			(prediction) =>
				prediction.queryOutcome === 'contact' &&
				prediction.decision === 'selected' &&
				prediction.predictedTime === contact.time
		);
		if (!terminalDiscovery && !continuousPrediction) continue;
		const participants = contact.participants.filter(
			(participant): participant is Extract<typeof participant, { type: 'body' }> =>
				participant.type === 'body'
		);
		if (participants.length !== 2) continue;
		const first = context.submittedInput.initialDynamicBodies.find(
			({ id }) => id === participants[0]!.bodyId
		);
		const second = context.submittedInput.initialDynamicBodies.find(
			({ id }) => id === participants[1]!.bodyId
		);
		if (!first || !second) continue;
		validateContactState(context, contact, first, second, contactIndex);
		validateSharedHorizon(context, contact, first, second, contactIndex);
		challengeEarlierOverlap(context, contact, first, second, contactIndex);
	}
	validateTerminalPairBoundary(context);
}

function validateContactState(
	context: RunValidationContext,
	contact: DynamicContactRecord,
	first: InitialDynamicCircleBodyState,
	second: InitialDynamicCircleBodyState,
	contactIndex: number
): void {
	const firstState = bodyStateAt(context, first.id, contact.time);
	const secondState = bodyStateAt(context, second.id, contact.time);
	if (!firstState || !secondState) return;
	const offset: Vec2 = [
		secondState.position[0] - firstState.position[0],
		secondState.position[1] - firstState.position[1]
	];
	const distance = Math.hypot(...offset);
	const normal: Vec2 | null = distance > 0 ? [offset[0] / distance, offset[1] / distance] : null;
	const tolerance = stateTolerance(context);
	const path = `$.dynamicContacts[${contactIndex}]`;
	if (
		!normal ||
		Math.abs(distance - first.physicalShape.radius - second.physicalShape.radius) > tolerance ||
		!nearVector(normal, contact.normalFromFirstToSecond, tolerance * 8)
	) {
		fail(
			context,
			'CONTACT_OFF_BOUNDARY',
			'The dynamic bodies must touch with the recorded first-to-second normal.',
			path,
			contact.time,
			first.id
		);
		return;
	}
	const expectedPoint: Vec2 = [
		firstState.position[0] + normal[0] * first.physicalShape.radius,
		firstState.position[1] + normal[1] * first.physicalShape.radius
	];
	const relativeVelocity: Vec2 = [
		secondState.velocity[0] - firstState.velocity[0],
		secondState.velocity[1] - firstState.velocity[1]
	];
	const normalMotion = relativeVelocity[0] * normal[0] + relativeVelocity[1] * normal[1];
	if (
		!nearVector(expectedPoint, contact.contactPoint, tolerance * 8) ||
		contact.preImpactNormalVelocity === null ||
		Math.abs(contact.preImpactNormalVelocity - normalMotion) > tolerance * 8 ||
		normalMotion > tolerance
	) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'Dynamic contact geometry and incoming relative motion must agree with both paths.',
			path,
			contact.time,
			first.id
		);
	}
}

function validateSharedHorizon(
	context: RunValidationContext,
	contact: DynamicContactRecord,
	first: InitialDynamicCircleBodyState,
	second: InitialDynamicCircleBodyState,
	contactIndex: number
): void {
	const prediction = context.run.diagnostics.pairPredictions.find(
		(candidate) =>
			candidate.decision === 'selected' &&
			candidate.predictedTime === contact.time &&
			candidate.bodyIds[0] === first.id &&
			candidate.bodyIds[1] === second.id
	);
	if (
		!prediction ||
		contact.time < prediction.validInterval[0] - timeTolerance(context) ||
		contact.time > prediction.validInterval[1] + timeTolerance(context)
	) {
		fail(
			context,
			'INVALID_INTERVAL',
			'The selected body contact must lie inside its shared local-event horizon.',
			`$.dynamicContacts[${contactIndex}]`,
			contact.time
		);
	}
}

function challengeEarlierOverlap(
	context: RunValidationContext,
	contact: DynamicContactRecord,
	first: InitialDynamicCircleBodyState,
	second: InitialDynamicCircleBodyState,
	contactIndex: number
): void {
	const start = Math.max(first.releaseTime, second.releaseTime);
	if (contact.time <= start) return;
	const minimumDistance = first.physicalShape.radius + second.physicalShape.radius;
	for (let sample = 0; sample < earlierOverlapSampleCount; sample += 1) {
		const fraction = sample / earlierOverlapSampleCount;
		const time = start + (contact.time - start) * fraction;
		const firstPosition = trajectoryPosition(context, first.id, time);
		const secondPosition = trajectoryPosition(context, second.id, time);
		if (!firstPosition || !secondPosition) continue;
		if (
			Math.hypot(secondPosition[0] - firstPosition[0], secondPosition[1] - firstPosition[1]) <
			minimumDistance - stateTolerance(context)
		) {
			fail(
				context,
				'EARLY_GEOMETRY_CROSSING',
				'A bounded independent challenge found an obvious earlier body overlap.',
				`$.dynamicContacts[${contactIndex}]`,
				time,
				first.id
			);
			return;
		}
	}
}

function validateTerminalPairBoundary(context: RunValidationContext): void {
	const reason = context.run.terminalReason;
	if (reason.type !== 'unsupported-body-body-response') return;
	const contact = context.run.dynamicContacts.find(({ id }) => id === reason.contactId);
	if (
		!contact ||
		contact.time !== reason.time ||
		reason.bodyIds.some(
			(bodyId) =>
				context.run.bodyStates.find(({ bodyId: candidate }) => candidate === bodyId)
					?.recordedUntilTime !== reason.time
		)
	) {
		fail(
			context,
			'INVALID_VALID_PREFIX',
			'The unsupported response must terminate both participant histories at exact contact.',
			'$.terminalReason',
			reason.time
		);
	}
}

function bodyStateAt(context: RunValidationContext, bodyId: string, time: number) {
	const trajectory = context.run.trajectories.find(({ bodyId: candidate }) => candidate === bodyId);
	const segment = trajectory?.segments.find(
		(candidate) => candidate.startTime <= time && candidate.endTime >= time
	);
	if (!segment) return null;
	return {
		position: evaluateBodyTrajectoryPosition(trajectory!, time)!,
		velocity: evaluateMotionSegmentVelocity(segment, time)
	};
}

function trajectoryPosition(
	context: RunValidationContext,
	bodyId: string,
	time: number
): Vec2 | null {
	const trajectory = context.run.trajectories.find(({ bodyId: candidate }) => candidate === bodyId);
	return trajectory ? evaluateBodyTrajectoryPosition(trajectory, time) : null;
}

function fail(
	context: RunValidationContext,
	code:
		| 'CONTACT_OFF_BOUNDARY'
		| 'EARLY_GEOMETRY_CROSSING'
		| 'IMPACT_EVIDENCE_MISMATCH'
		| 'INVALID_INTERVAL'
		| 'INVALID_VALID_PREFIX',
	message: string,
	path: string,
	time: number,
	bodyId?: string
): void {
	reportRunValidationFailure(context, 'contact-geometry', code, message, {
		path,
		time,
		...(bodyId ? { bodyId } : {})
	});
}
