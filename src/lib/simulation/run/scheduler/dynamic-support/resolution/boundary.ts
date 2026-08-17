import type { Vec2 } from '../../../../contracts';
import {
	classifyPostResponseContacts,
	selectPostContactMode,
	type ExactContact,
	type ExactTimeContactState,
	type PostContactMode,
	type SupportedMotionEvidence
} from '../../../contact-resolution';
import type { SchedulerState } from '../../types';
import type { DynamicSupportReactionState, DynamicSupportRuntime } from '../types';

export interface DynamicSupportModeEvidence {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly normal: Vec2;
	readonly anchoredContacts: readonly ExactContact[];
	readonly releasedAnchoredContactIds: readonly string[];
	readonly bodyBodyDisposition: 'retained' | 'released';
	readonly reaction: DynamicSupportReactionState;
	readonly motion?: SupportedMotionEvidence;
}

export function resolveDynamicSupportMode(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	evidence: DynamicSupportModeEvidence
): PostContactMode {
	const eventState = dynamicSupportContactState(state, support, evidence);
	const released = new Set(evidence.releasedAnchoredContactIds);
	const reactionById = new Map(
		evidence.reaction.support?.contacts.map((contact, index) => [
			contact.id,
			evidence.reaction.support!.reactions[index]!
		]) ?? []
	);
	const contacts = classifyPostResponseContacts(
		eventState,
		eventState.contacts.map((contact) => ({
			contactId: contact.id,
			preResponseNormalVelocity: 0,
			postResponseNormalVelocity: 0,
			impulse: 0,
			retentionEligible:
				contact.id === support.contactId
					? evidence.bodyBodyDisposition === 'retained'
					: !released.has(contact.id),
			supportReaction:
				contact.id === support.contactId
					? evidence.reaction.bodyBodyReaction
					: (reactionById.get(contact.id) ?? null)
		})),
		supportTolerance(state)
	)!;
	const retainedBodyContact = evidence.bodyBodyDisposition === 'retained';
	const dynamicallySupported =
		retainedBodyContact &&
		evidence.reaction.support !== null &&
		evidence.reaction.bodyBodyReaction > supportTolerance(state);
	return selectPostContactMode({
		contacts,
		dynamicSupport: dynamicallySupported
			? {
					contactId: support.contactId,
					movingBodyId: support.movingBodyId,
					supportBodyId: support.supportBodyId,
					motion: evidence.motion,
					stationaryDetail:
						'Dynamic support reached a turning point without a certified direction of departure.'
				}
			: null,
		unsupportedBodyContactId: retainedBodyContact ? support.contactId : null
	});
}

function dynamicSupportContactState(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	evidence: DynamicSupportModeEvidence
): ExactTimeContactState {
	const moving = state.runtimes.get(support.movingBodyId)!;
	const bodyContact: ExactContact = {
		type: 'body-body',
		id: support.contactId,
		firstBodyId: support.supportBodyId,
		secondBodyId: support.movingBodyId,
		normalFromFirstToSecond: evidence.normal,
		contactPoint: [
			evidence.position[0] - evidence.normal[0] * moving.body.physicalShape.radius,
			evidence.position[1] - evidence.normal[1] * moving.body.physicalShape.radius
		]
	};
	return {
		id: `${support.id}:boundary:${evidence.time}`,
		time: evidence.time,
		bodies: [
			...support.anchoredBodies,
			{
				id: support.movingBodyId,
				mass: moving.body.mass,
				radius: moving.body.physicalShape.radius,
				position: evidence.position,
				velocity: evidence.velocity
			}
		],
		contacts: [bodyContact, ...evidence.anchoredContacts]
	};
}

function supportTolerance(state: SchedulerState): number {
	return Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256);
}
