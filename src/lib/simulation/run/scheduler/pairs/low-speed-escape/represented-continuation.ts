import type { Vec2 } from '../../../../contracts';
import { dotVec2 } from '../../../../math';
import {
	REPRESENTED_MOTION_SPEED,
	isSubResolutionNormalMotion,
	type ExactContact,
	type ResolvedContactState
} from '../../../contact-resolution';
import type { BodyVelocityResponse } from '../../dormancy';
import {
	canRepresentDynamicSupport,
	type DynamicSupportPreflightAnchor
} from '../../dynamic-support';
import type { SchedulerState } from '../../types';

export interface RepresentedSupportContinuation {
	readonly response: BodyVelocityResponse;
	readonly resolvedContacts: ResolvedContactState;
}

export function tryRepresentedDynamicSupportContinuation(
	state: SchedulerState,
	resolved: ResolvedContactState,
	response: BodyVelocityResponse,
	anchors: readonly DynamicSupportPreflightAnchor[],
	tolerance: number
): RepresentedSupportContinuation | null {
	const releasedBodyContacts = resolved.contacts.flatMap(({ contact, disposition, ...role }) =>
		contact.type === 'body-body' &&
		disposition === 'released' &&
		isSubResolutionNormalMotion(role.preResponseNormalVelocity, role.postResponseNormalVelocity)
			? [contact]
			: []
	);
	for (const contact of releasedBodyContacts) {
		for (const anchor of anchors) {
			const candidate = representedSupportCandidate(resolved, response, contact, anchor);
			if (
				candidate &&
				canRepresentDynamicSupport(
					state,
					candidate.resolvedContacts,
					candidate.response,
					contact,
					anchor,
					tolerance
				)
			) {
				return candidate;
			}
		}
	}
	return null;
}

function representedSupportCandidate(
	resolved: ResolvedContactState,
	response: BodyVelocityResponse,
	contact: Extract<ExactContact, { readonly type: 'body-body' }>,
	anchor: DynamicSupportPreflightAnchor
): RepresentedSupportContinuation | null {
	if (anchor.bodyIds.has(contact.firstBodyId) === anchor.bodyIds.has(contact.secondBodyId)) {
		return null;
	}
	const supportBodyId = anchor.bodyIds.has(contact.firstBodyId)
		? contact.firstBodyId
		: contact.secondBodyId;
	const movingBodyId =
		supportBodyId === contact.firstBodyId ? contact.secondBodyId : contact.firstBodyId;
	const ordinaryMoving = response.bodyVelocities.find(
		({ bodyId }) => bodyId === movingBodyId
	)?.velocity;
	if (!ordinaryMoving) return null;
	const normal: Vec2 =
		supportBodyId === contact.firstBodyId
			? contact.normalFromFirstToSecond
			: [-contact.normalFromFirstToSecond[0], -contact.normalFromFirstToSecond[1]];
	const tangent: Vec2 = [-normal[1], normal[0]];
	const signedSpeed = dotVec2(ordinaryMoving, tangent);
	if (Math.abs(signedSpeed) <= REPRESENTED_MOTION_SPEED) return null;
	const representedMoving: Vec2 = [tangent[0] * signedSpeed, tangent[1] * signedSpeed];
	return {
		response: {
			bodyVelocities: response.bodyVelocities.map((body) =>
				anchor.bodyIds.has(body.bodyId)
					? { bodyId: body.bodyId, velocity: [0, 0] as const }
					: body.bodyId === movingBodyId
						? { bodyId: body.bodyId, velocity: representedMoving }
						: body
			)
		},
		resolvedContacts: {
			eventState: resolved.eventState,
			contacts: resolved.contacts.map((role) =>
				role.contact.id === contact.id ? { ...role, disposition: 'retained' as const } : role
			)
		}
	};
}
