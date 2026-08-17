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
		const component = context.run.contactComponents.find(({ activeContactIds }) =>
			activeContactIds.includes(contact.id)
		);
		const constrained = Boolean(
			component &&
			context.run.diagnostics.constrainedImpactSolves?.some(
				({ componentId }) => componentId === component.id
			)
		);
		validateContactState(context, contact, first, second, contactIndex);
		if (!constrained) validateResolvedResponse(context, contact, first, second, contactIndex);
		validateSharedHorizon(context, contact, first, second, contactIndex);
		challengeEarlierOverlap(context, contact, first, second, contactIndex);
	}
	validateTerminalPairBoundary(context);
}

function validateResolvedResponse(
	context: RunValidationContext,
	contact: DynamicContactRecord,
	first: InitialDynamicCircleBodyState,
	second: InitialDynamicCircleBodyState,
	contactIndex: number
): void {
	if (contact.state !== 'released') return;
	const component = context.run.contactComponents.find(({ activeContactIds }) =>
		activeContactIds.includes(contact.id)
	);
	if (component && component.activeContactIds.length > 1) return;
	const path = `$.dynamicContacts[${contactIndex}]`;
	const before = contact.preImpactVelocities;
	const after = contact.postImpactVelocities;
	const impulse = contact.impulse;
	const onFirst = contact.impulseOnFirst;
	const onSecond = contact.impulseOnSecond;
	const tolerance = stateTolerance(context) * 16;
	if (
		!before ||
		!after ||
		impulse === null ||
		!onFirst ||
		!onSecond ||
		contact.preImpactNormalVelocity === null ||
		contact.postImpactNormalVelocity === null
	) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'A resolved body impact must retain complete pre/post velocity and impulse evidence.',
			path,
			contact.time,
			first.id
		);
		return;
	}
	if (impulse < 0) {
		fail(
			context,
			'NEGATIVE_IMPULSE',
			'A body impact impulse cannot be attractive.',
			path,
			contact.time
		);
		return;
	}
	const normal = contact.normalFromFirstToSecond;
	const expectedFirstImpulse: Vec2 = [-impulse * normal[0], -impulse * normal[1]];
	const expectedSecondImpulse: Vec2 = [impulse * normal[0], impulse * normal[1]];
	const firstMomentumChange: Vec2 = [
		first.mass * (after[0][0] - before[0][0]),
		first.mass * (after[0][1] - before[0][1])
	];
	const secondMomentumChange: Vec2 = [
		second.mass * (after[1][0] - before[1][0]),
		second.mass * (after[1][1] - before[1][1])
	];
	const tangent: Vec2 = [-normal[1], normal[0]];
	const outgoingNormal = dot([after[1][0] - after[0][0], after[1][1] - after[0][1]], normal);
	const expectedOutgoing =
		-context.submittedInput.settings.restitution * contact.preImpactNormalVelocity;
	const momentumBefore: Vec2 = [
		first.mass * before[0][0] + second.mass * before[1][0],
		first.mass * before[0][1] + second.mass * before[1][1]
	];
	const momentumAfter: Vec2 = [
		first.mass * after[0][0] + second.mass * after[1][0],
		first.mass * after[0][1] + second.mass * after[1][1]
	];
	const energyBefore = kineticEnergy(first.mass, before[0]) + kineticEnergy(second.mass, before[1]);
	const energyAfter = kineticEnergy(first.mass, after[0]) + kineticEnergy(second.mass, after[1]);
	const responseMatches =
		nearVector(onFirst, expectedFirstImpulse, tolerance) &&
		nearVector(onSecond, expectedSecondImpulse, tolerance) &&
		nearVector(firstMomentumChange, expectedFirstImpulse, tolerance) &&
		nearVector(secondMomentumChange, expectedSecondImpulse, tolerance) &&
		nearVector(momentumAfter, momentumBefore, tolerance) &&
		Math.abs(dot(before[0], tangent) - dot(after[0], tangent)) <= tolerance &&
		Math.abs(dot(before[1], tangent) - dot(after[1], tangent)) <= tolerance &&
		Math.abs(outgoingNormal - contact.postImpactNormalVelocity) <= tolerance &&
		Math.abs(outgoingNormal - expectedOutgoing) <= tolerance &&
		energyAfter <= energyBefore + tolerance * Math.max(1, energyBefore);
	if (!responseMatches) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'The resolved impact must satisfy equal-and-opposite impulse, tangential preservation, momentum, restitution and energy invariants.',
			path,
			contact.time,
			first.id
		);
	}
	if (outgoingNormal < -tolerance)
		fail(
			context,
			'PENETRATING_POST_IMPACT_VELOCITY',
			'The resolved relative normal velocity remains incoming.',
			path,
			contact.time,
			first.id
		);
}

function dot(left: Vec2, right: Vec2): number {
	return left[0] * right[0] + left[1] * right[1];
}

function kineticEnergy(mass: number, velocity: Vec2): number {
	return 0.5 * mass * dot(velocity, velocity);
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
	const recordedBefore = contact.preImpactVelocities;
	const relativeVelocity: Vec2 = recordedBefore
		? [recordedBefore[1][0] - recordedBefore[0][0], recordedBefore[1][1] - recordedBefore[0][1]]
		: [
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
	const component = context.run.contactComponents.find(({ activeContactIds }) =>
		activeContactIds.includes(contact.id)
	);
	if (!prediction && component && component.activeContactIds.length > 1) return;
	const localHorizon = prediction?.localEventHorizons
		? Math.min(...prediction.localEventHorizons)
		: null;
	if (
		!prediction ||
		contact.time < prediction.validInterval[0] - timeTolerance(context) ||
		contact.time > prediction.validInterval[1] + timeTolerance(context) ||
		(localHorizon !== null && prediction.validInterval[1] > localHorizon + timeTolerance(context))
	) {
		fail(
			context,
			'INVALID_INTERVAL',
			'The selected body contact and pair search must lie inside the earlier local-event horizon.',
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
		| 'NEGATIVE_IMPULSE'
		| 'PENETRATING_POST_IMPACT_VELOCITY'
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
