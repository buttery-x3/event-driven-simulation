import type {
	CircularContactMotionSegment,
	ContactManifoldMember,
	LinearContactMotionSegment,
	Vec2
} from '../../contracts';
import { dotVec2 } from '../../math';
import { evaluateCircularContactState, evaluateMotionSegmentVelocity } from '../../motion';
import { nearVector, stateTolerance } from '../history';
import { reportRunValidationFailure, type RunValidationContext } from '../results';

export function validateContactDynamics(context: RunValidationContext): void {
	validateImpacts(context);
	validateContactSearchEvidence(context);
	for (const [trajectoryIndex, trajectory] of context.run.trajectories.entries()) {
		for (const [segmentIndex, segment] of trajectory.segments.entries()) {
			if (segment.type === 'linear-contact') {
				validateLinearContact(context, segment, trajectoryIndex, segmentIndex);
			}
			if (segment.type === 'circular-contact') {
				validateCircularContact(context, segment, trajectoryIndex, segmentIndex);
				const next = trajectory.segments[segmentIndex + 1];
				if (
					next?.type === 'circular-contact' &&
					next.startTime === segment.endTime &&
					!context.run.events.some(
						(event) =>
							event.type === 'contact' &&
							event.bodyId === segment.bodyId &&
							event.time === segment.endTime
					)
				) {
					validateTurningPoint(context, segment, next, trajectoryIndex, segmentIndex);
				}
			}
		}
	}
	validateTransitions(context);
}

function validateImpacts(context: RunValidationContext): void {
	for (const [eventIndex, event] of context.run.events.entries()) {
		if (event.type !== 'contact') continue;
		for (const [contactIndex, contact] of (event.contacts ?? []).entries()) {
			const path = `$.events[${eventIndex}].contacts[${contactIndex}]`;
			if (contact.impulse < -stateTolerance(context)) {
				fail(
					context,
					'impact-manifold',
					'NEGATIVE_IMPULSE',
					'Contact impulses must be non-negative.',
					{
						path: `${path}.impulse`,
						time: event.time,
						bodyId: event.bodyId,
						colliderId: contact.colliderId
					}
				);
			}
			if (contact.postImpactNormalVelocity < -stateTolerance(context)) {
				fail(
					context,
					'impact-manifold',
					'PENETRATING_POST_IMPACT_VELOCITY',
					'Post-impact velocity must not penetrate a retained active contact.',
					{
						path: `${path}.postImpactNormalVelocity`,
						time: event.time,
						bodyId: event.bodyId,
						colliderId: contact.colliderId
					}
				);
			}
			validateVelocityEvidence(
				context,
				eventIndex,
				contactIndex,
				contact,
				event.preContactVelocity,
				event.postContactVelocity,
				event.time,
				event.bodyId
			);
		}
	}
}

function validateVelocityEvidence(
	context: RunValidationContext,
	eventIndex: number,
	contactIndex: number,
	contact: ContactManifoldMember,
	preVelocity: Vec2 | undefined,
	postVelocity: Vec2 | undefined,
	time: number,
	bodyId: string
): void {
	const path = `$.events[${eventIndex}].contacts[${contactIndex}]`;
	if (
		(preVelocity &&
			Math.abs(dotVec2(preVelocity, contact.normal) - contact.preImpactNormalVelocity) >
				stateTolerance(context)) ||
		(postVelocity &&
			Math.abs(dotVec2(postVelocity, contact.normal) - contact.postImpactNormalVelocity) >
				stateTolerance(context))
	) {
		fail(
			context,
			'impact-manifold',
			'IMPACT_EVIDENCE_MISMATCH',
			'Per-contact normal speeds must agree with the recorded event velocities.',
			{ path, time, bodyId, colliderId: contact.colliderId }
		);
	}
}

function validateContactSearchEvidence(context: RunValidationContext): void {
	for (const [searchIndex, search] of context.run.diagnostics.contactSearches.entries()) {
		for (const [candidateIndex, candidate] of search.candidates.entries()) {
			const path = `$.diagnostics.contactSearches[${searchIndex}].candidates[${candidateIndex}]`;
			if (
				candidate.classification.includes('rejected') &&
				(candidate.eventContactSetMember || candidate.positiveImpulseContributor)
			) {
				fail(
					context,
					'impact-manifold',
					'IMPACT_EVIDENCE_MISMATCH',
					'A rejected or release-owned root cannot be committed as an impulse-bearing impact.',
					{ path, time: candidate.time, colliderId: candidate.colliderId }
				);
			}
			if (candidate.impulse !== undefined && candidate.impulse < -stateTolerance(context)) {
				fail(
					context,
					'impact-manifold',
					'NEGATIVE_IMPULSE',
					'Diagnostic impulses must be non-negative.',
					{
						path: `${path}.impulse`,
						time: candidate.time,
						colliderId: candidate.colliderId
					}
				);
			}
			if (candidate.retainedSupportAfterImpact && candidate.releasedAfterImpact) {
				fail(
					context,
					'impact-manifold',
					'CONTACT_SET_MISMATCH',
					'A contact cannot be both retained and released after one impact.',
					{ path, time: candidate.time, colliderId: candidate.colliderId }
				);
			}
		}
	}
}

function validateLinearContact(
	context: RunValidationContext,
	segment: LinearContactMotionSegment,
	trajectoryIndex: number,
	segmentIndex: number
): void {
	const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`;
	for (const time of [segment.startTime, segment.endTime]) {
		const velocity = evaluateMotionSegmentVelocity(segment, time);
		if (
			Math.abs(dotVec2(velocity, segment.contactNormal)) > stateTolerance(context) ||
			Math.abs(dotVec2(segment.acceleration, segment.contactNormal)) > stateTolerance(context)
		) {
			fail(
				context,
				'sustained-contact',
				'NON_TANGENTIAL_CONSTRAINED_MOTION',
				'Linear constrained velocity and acceleration must remain tangent to the support.',
				{ path, time, bodyId: segment.bodyId, colliderId: segment.supportingColliderId }
			);
			break;
		}
	}
	const reaction = -dotVec2(segment.acceleration, segment.contactNormal);
	if (reaction < -stateTolerance(context)) {
		fail(
			context,
			'sustained-contact',
			'ATTRACTIVE_SUPPORT_REACTION',
			'A retained linear support would require an attractive reaction.',
			{
				path,
				time: segment.startTime,
				bodyId: segment.bodyId,
				colliderId: segment.supportingColliderId
			}
		);
	}
}

function validateCircularContact(
	context: RunValidationContext,
	segment: CircularContactMotionSegment,
	trajectoryIndex: number,
	segmentIndex: number
): void {
	const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`;
	for (const fraction of [0, 0.5, 1]) {
		const time = segment.startTime + (segment.endTime - segment.startTime) * fraction;
		const state = evaluateCircularContactState(segment, time);
		if (Math.abs(dotVec2(state.velocity, state.normal)) > stateTolerance(context)) {
			fail(
				context,
				'sustained-contact',
				'NON_TANGENTIAL_CONSTRAINED_MOTION',
				'Circular constrained velocity must remain tangent to its changing normal.',
				{ path, time, bodyId: segment.bodyId, colliderId: segment.supportingColliderId }
			);
			break;
		}
		const speedSquared = dotVec2(state.velocity, state.velocity);
		const reaction = -speedSquared / segment.contactRadius - dotVec2(segment.gravity, state.normal);
		if (reaction < -stateTolerance(context)) {
			fail(
				context,
				'sustained-contact',
				'ATTRACTIVE_SUPPORT_REACTION',
				'A retained circular support would require an attractive reaction.',
				{ path, time, bodyId: segment.bodyId, colliderId: segment.supportingColliderId }
			);
			break;
		}
	}
}

function validateTurningPoint(
	context: RunValidationContext,
	incoming: CircularContactMotionSegment,
	outgoing: CircularContactMotionSegment,
	trajectoryIndex: number,
	segmentIndex: number
): void {
	if (
		incoming.supportingColliderId !== outgoing.supportingColliderId ||
		incoming.direction === outgoing.direction
	) {
		return;
	}
	const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex + 1}]`;
	const incomingState = evaluateCircularContactState(incoming, incoming.endTime);
	const outgoingTangent: Vec2 = [
		-incomingState.normal[1] * outgoing.direction,
		incomingState.normal[0] * outgoing.direction
	];
	if (
		Math.hypot(...incomingState.velocity) > stateTolerance(context) ||
		Math.hypot(...outgoing.startVelocity) > stateTolerance(context) ||
		outgoing.startTangentialSpeed > stateTolerance(context) ||
		!nearVector(incomingState.position, outgoing.startPosition, stateTolerance(context)) ||
		dotVec2(outgoing.gravity, outgoingTangent) <= 0
	) {
		fail(
			context,
			'sustained-contact',
			'INVALID_TURNING_POINT',
			'A circular reversal must pass continuously through zero tangential speed in the accelerated direction.',
			{
				path,
				time: outgoing.startTime,
				bodyId: outgoing.bodyId,
				colliderId: outgoing.supportingColliderId
			}
		);
	}
}

function validateTransitions(context: RunValidationContext): void {
	for (const [eventIndex, event] of context.run.events.entries()) {
		if (event.type !== 'contact-mode-transition') continue;
		const trajectory = context.run.trajectories.find(({ bodyId }) => bodyId === event.bodyId);
		const outgoing = trajectory?.segments.find((segment) => segment.startTime === event.time);
		const endsAtTransition = event.time === context.run.diagnostics.simulatedUntilTime;
		if (
			event.to === 'sliding' &&
			(!outgoing || outgoing.type === 'free-flight') &&
			!endsAtTransition
		) {
			fail(
				context,
				'sustained-contact',
				'CONTACT_SET_MISMATCH',
				'A transition to sliding must retain a constrained outgoing segment.',
				{
					path: `$.events[${eventIndex}]`,
					time: event.time,
					bodyId: event.bodyId,
					colliderId: event.colliderId
				}
			);
		}
		if (event.to === 'free-flight' && outgoing && outgoing.type !== 'free-flight') {
			fail(
				context,
				'sustained-contact',
				'CONTACT_SET_MISMATCH',
				'A support-loss transition must not retain the released constrained mode.',
				{
					path: `$.events[${eventIndex}]`,
					time: event.time,
					bodyId: event.bodyId,
					colliderId: event.colliderId
				}
			);
		}
	}
}

function fail(
	context: RunValidationContext,
	category: 'impact-manifold' | 'sustained-contact',
	code: Parameters<typeof reportRunValidationFailure>[2],
	message: string,
	reference: Parameters<typeof reportRunValidationFailure>[4]
): void {
	reportRunValidationFailure(context, category, code, message, reference);
}
