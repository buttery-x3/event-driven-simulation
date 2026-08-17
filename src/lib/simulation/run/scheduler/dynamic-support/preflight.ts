import type { Vec2 } from '../../../contracts';
import { dotVec2 } from '../../../math';
import {
	selectPostContactMode,
	type ExactContact,
	type ResolvedContactState
} from '../../contact-resolution';
import type { BodyVelocityResponse } from '../dormancy';
import type { SchedulerState } from '../types';
import { createDynamicSupportPrediction } from './prediction';
import type { DynamicSupportRuntime } from './types';

export interface DynamicSupportPreflightAnchor {
	readonly componentId: string;
	readonly bodyIds: ReadonlySet<string>;
	readonly contacts: readonly ExactContact[];
}

export function canRepresentDynamicSupport(
	state: SchedulerState,
	resolvedContacts: ResolvedContactState,
	response: BodyVelocityResponse,
	contact: Extract<ExactContact, { readonly type: 'body-body' }>,
	anchor: DynamicSupportPreflightAnchor,
	tolerance: number
): boolean {
	if (anchor.bodyIds.has(contact.firstBodyId) === anchor.bodyIds.has(contact.secondBodyId)) {
		return false;
	}
	if (
		[...anchor.bodyIds].some((bodyId) => {
			const velocity = response.bodyVelocities.find((body) => body.bodyId === bodyId)?.velocity;
			return !velocity || Math.hypot(...velocity) > tolerance;
		})
	) {
		return false;
	}
	const component = resolvedContacts.eventState;
	const anchoredBodies = component.bodies.filter(({ id }) => anchor.bodyIds.has(id));
	if (anchoredBodies.length !== anchor.bodyIds.size || anchor.contacts.length === 0) return false;
	const supportBodyId = anchor.bodyIds.has(contact.firstBodyId)
		? contact.firstBodyId
		: contact.secondBodyId;
	const movingBodyId =
		supportBodyId === contact.firstBodyId ? contact.secondBodyId : contact.firstBodyId;
	const normal: Vec2 =
		supportBodyId === contact.firstBodyId
			? contact.normalFromFirstToSecond
			: [-contact.normalFromFirstToSecond[0], -contact.normalFromFirstToSecond[1]];
	const tangent: Vec2 = [-normal[1], normal[0]];
	const movingVelocity = response.bodyVelocities.find(
		({ bodyId }) => bodyId === movingBodyId
	)?.velocity;
	if (!movingVelocity) return false;
	const signedSpeed = dotVec2(movingVelocity, tangent);
	if (Math.abs(signedSpeed) <= tolerance) return false;
	const mode = selectPostContactMode({
		contacts: resolvedContacts,
		dynamicSupport: { contactId: contact.id, movingBodyId, supportBodyId }
	});
	if (mode.type !== 'dynamic-sustained-support') return false;
	const id = `dynamic-support-preflight:${component.time}:${movingBodyId}->${supportBodyId}`;
	const runtime: DynamicSupportRuntime = {
		id,
		contactId: contact.id,
		movingBodyId,
		supportBodyId,
		componentId: anchor.componentId,
		anchoredBodyIds: [...anchor.bodyIds].sort(),
		anchoredBodies,
		anchoredContacts: anchor.contacts,
		time: component.time,
		position: component.bodies.find(({ id: bodyId }) => bodyId === movingBodyId)!.position,
		normal,
		direction: signedSpeed > 0 ? 1 : -1,
		tangentialSpeed: Math.abs(signedSpeed)
	};
	return createDynamicSupportPrediction(state, runtime, movingVelocity) !== null;
}
