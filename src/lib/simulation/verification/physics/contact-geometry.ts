import type {
	InitialDynamicCircleBodyState,
	MotionSegment,
	StaticCollider,
	Vec2
} from '../../contracts';
import { evaluateBodyTrajectoryPosition, evaluateMotionSegmentPosition } from '../../motion';
import { bodyFor, nearVector, stateTolerance } from '../history';
import { reportRunValidationFailure, type RunValidationContext } from '../results';

export interface ColliderContactGeometry {
	readonly clearance: number;
	readonly normal: Vec2 | null;
	readonly contactPoint: Vec2;
}

export function validateContactGeometry(context: RunValidationContext): void {
	for (const [eventIndex, event] of context.run.events.entries()) {
		if (event.type !== 'contact') continue;
		const body = bodyFor(context.submittedInput, event.bodyId);
		const collider = colliderFor(context, event.colliderId);
		if (!body || !collider) continue;
		validateBoundaryEvidence(
			context,
			body,
			collider,
			event.position,
			event.normal,
			`$.events[${eventIndex}]`,
			event.time
		);
		for (const [contactIndex, contact] of (event.contacts ?? []).entries()) {
			const memberCollider = colliderFor(context, contact.colliderId);
			if (!memberCollider) continue;
			validateBoundaryEvidence(
				context,
				body,
				memberCollider,
				event.position,
				contact.normal,
				`$.events[${eventIndex}].contacts[${contactIndex}]`,
				event.time,
				contact.contactPoint
			);
		}
	}

	for (const [contactIndex, contact] of context.run.dynamicContacts.entries()) {
		const bodyParticipant = contact.participants.find(
			(participant): participant is Extract<typeof participant, { type: 'body' }> =>
				participant.type === 'body'
		);
		const fixedParticipant = contact.participants.find(
			(participant): participant is Extract<typeof participant, { type: 'fixed-collider' }> =>
				participant.type === 'fixed-collider'
		);
		if (!bodyParticipant || !fixedParticipant) continue;
		const body = bodyFor(context.submittedInput, bodyParticipant.bodyId);
		const collider = colliderFor(context, fixedParticipant.colliderId);
		const trajectory = context.run.trajectories.find(
			({ bodyId }) => bodyId === bodyParticipant.bodyId
		);
		const position = trajectory ? evaluateBodyTrajectoryPosition(trajectory, contact.time) : null;
		if (!body || !collider || !position) continue;
		validateBoundaryEvidence(
			context,
			body,
			collider,
			position,
			contact.normalFromFirstToSecond,
			`$.dynamicContacts[${contactIndex}]`,
			contact.time,
			contact.contactPoint
		);
		const normalVelocity = contact.postImpactNormalVelocity;
		const exactImpact = context.run.contactComponents.some(
			(component) =>
				component.type === 'exact-time-impact' && component.activeContactIds.includes(contact.id)
		);
		const tolerance = Math.max(
			context.submittedInput.settings.tolerances.contactDistance,
			Number.EPSILON * 256
		);
		if (
			exactImpact &&
			contact.releaseReason !== 'support-reaction-zero' &&
			normalVelocity !== null &&
			((contact.state === 'retained' && normalVelocity > tolerance) ||
				(contact.state === 'released' && normalVelocity <= tolerance))
		) {
			fail(
				context,
				'CONTACT_SET_MISMATCH',
				'Retained or released fixed support disagrees with post-impact normal motion.',
				{
					path: `$.dynamicContacts[${contactIndex}]`,
					time: contact.time,
					bodyId: body.id,
					colliderId: collider.id
				}
			);
		}
	}

	for (const [trajectoryIndex, trajectory] of context.run.trajectories.entries()) {
		const body = bodyFor(context.submittedInput, trajectory.bodyId);
		if (!body) continue;
		for (const [segmentIndex, segment] of trajectory.segments.entries()) {
			if (
				segment.type === 'free-flight' ||
				segment.type === 'stationary' ||
				segment.type === 'accumulation-tail'
			)
				continue;
			validateConstrainedGeometry(context, body, segment, trajectoryIndex, segmentIndex);
		}
	}
}

export function evaluateColliderContact(
	position: Vec2,
	bodyRadius: number,
	collider: StaticCollider
): ColliderContactGeometry {
	if ('centre' in collider) {
		const offset: Vec2 = [position[0] - collider.centre[0], position[1] - collider.centre[1]];
		const distance = Math.hypot(...offset);
		const normal: Vec2 | null = distance > 0 ? [offset[0] / distance, offset[1] / distance] : null;
		return {
			clearance: distance - collider.physicalShape.radius - bodyRadius,
			normal,
			contactPoint: normal
				? [
						collider.centre[0] + collider.physicalShape.radius * normal[0],
						collider.centre[1] + collider.physicalShape.radius * normal[1]
					]
				: collider.centre
		};
	}
	const start = collider.physicalShape.start;
	const end = collider.physicalShape.end;
	const edge: Vec2 = [end[0] - start[0], end[1] - start[1]];
	const lengthSquared = edge[0] ** 2 + edge[1] ** 2;
	const projection =
		lengthSquared === 0
			? 0
			: Math.max(
					0,
					Math.min(
						1,
						((position[0] - start[0]) * edge[0] + (position[1] - start[1]) * edge[1]) /
							lengthSquared
					)
				);
	const contactPoint: Vec2 = [start[0] + edge[0] * projection, start[1] + edge[1] * projection];
	const offset: Vec2 = [position[0] - contactPoint[0], position[1] - contactPoint[1]];
	const distance = Math.hypot(...offset);
	return {
		clearance: distance - bodyRadius,
		normal: distance > 0 ? [offset[0] / distance, offset[1] / distance] : null,
		contactPoint
	};
}

function validateBoundaryEvidence(
	context: RunValidationContext,
	body: InitialDynamicCircleBodyState,
	collider: StaticCollider,
	position: Vec2,
	normal: Vec2,
	path: string,
	time: number,
	recordedContactPoint?: Vec2
): void {
	const geometry = evaluateColliderContact(position, body.physicalShape.radius, collider);
	const tolerance = stateTolerance(context);
	if (Math.abs(geometry.clearance) > tolerance) {
		fail(
			context,
			'CONTACT_OFF_BOUNDARY',
			'The recorded contact centre is not on the expanded collider boundary.',
			{
				path: `${path}.position`,
				time,
				bodyId: body.id,
				colliderId: collider.id
			}
		);
	}
	if (!geometry.normal || !nearVector(geometry.normal, normal, tolerance * 8)) {
		fail(
			context,
			'CONTACT_NORMAL_MISMATCH',
			'The recorded contact normal disagrees with scene geometry.',
			{
				path: `${path}.normal`,
				time,
				bodyId: body.id,
				colliderId: collider.id
			}
		);
	}
	if (
		recordedContactPoint &&
		Math.abs(evaluateColliderContact(recordedContactPoint, 0, collider).clearance) > tolerance
	) {
		fail(
			context,
			'CONTACT_OFF_BOUNDARY',
			'The manifold contact point is not on the submitted collider.',
			{
				path: `${path}.contactPoint`,
				time,
				bodyId: body.id,
				colliderId: collider.id
			}
		);
	}
}

function validateConstrainedGeometry(
	context: RunValidationContext,
	body: InitialDynamicCircleBodyState,
	segment: Extract<MotionSegment, { type: 'linear-contact' | 'circular-contact' }>,
	trajectoryIndex: number,
	segmentIndex: number
): void {
	const collider = colliderFor(context, segment.supportingColliderId);
	if (!collider) return;
	const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`;
	if (
		(segment.type === 'circular-contact' && collider.physicalShape.type !== 'circle') ||
		(segment.type === 'linear-contact' && collider.physicalShape.type !== 'line-segment')
	) {
		fail(
			context,
			'CONSTRAINED_PATH_DRIFT',
			'The constrained path type does not match its supporting collider.',
			{
				path: `${path}.supportingColliderId`,
				time: segment.startTime,
				bodyId: segment.bodyId,
				colliderId: collider.id
			}
		);
		return;
	}
	if (
		segment.type === 'circular-contact' &&
		'centre' in collider &&
		(!nearVector(segment.centre, collider.centre, stateTolerance(context)) ||
			Math.abs(segment.contactRadius - collider.physicalShape.radius - body.physicalShape.radius) >
				stateTolerance(context))
	) {
		fail(
			context,
			'CONSTRAINED_PATH_DRIFT',
			'Circular path centre or radius disagrees with its support.',
			{
				path,
				time: segment.startTime,
				bodyId: segment.bodyId,
				colliderId: collider.id
			}
		);
	}
	for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
		const time = segment.startTime + (segment.endTime - segment.startTime) * fraction;
		const position = evaluateMotionSegmentPosition(segment, time);
		const geometry = evaluateColliderContact(position, body.physicalShape.radius, collider);
		if (Math.abs(geometry.clearance) > stateTolerance(context)) {
			fail(
				context,
				'CONSTRAINED_PATH_DRIFT',
				'A constrained trajectory drifts from its retained support.',
				{
					path,
					time,
					bodyId: segment.bodyId,
					colliderId: collider.id
				}
			);
			break;
		}
	}
}

function colliderFor(
	context: RunValidationContext,
	colliderId: string
): StaticCollider | undefined {
	return context.submittedInput.scene.staticColliders.find(({ id }) => id === colliderId);
}

function fail(
	context: RunValidationContext,
	code: Parameters<typeof reportRunValidationFailure>[2],
	message: string,
	reference: Parameters<typeof reportRunValidationFailure>[4]
): void {
	reportRunValidationFailure(context, 'contact-geometry', code, message, reference);
}
