import type { DynamicContactRecord, Vec2 } from '../../../contracts';
import type { ExactContact, ResolvedContactRole } from '../../contact-resolution';
import type { ExactTimeComponent } from './component';

export interface CommittedCoupledResponse {
	readonly bodyVelocities: readonly {
		readonly bodyId: string;
		readonly velocity: Vec2;
	}[];
	readonly contacts: readonly {
		readonly contactId: string;
		readonly preImpactNormalVelocity: number;
		readonly postImpactNormalVelocity: number;
		readonly impulse: number;
	}[];
}

export function resolvedCoupledContactRecord(
	component: ExactTimeComponent,
	resolved: ResolvedContactRole,
	response: CommittedCoupledResponse
): DynamicContactRecord {
	const contact = resolved.contact;
	const result = response.contacts.find(({ contactId }) => contactId === contact.id)!;
	const preVelocities = participantVelocities(component, contact);
	const postVelocities = participantVelocities(component, contact, response);
	const normal = contact.type === 'body-body' ? contact.normalFromFirstToSecond : contact.normal;
	return {
		id: contact.id,
		time: component.time,
		participants:
			contact.type === 'body-body'
				? [
						{ type: 'body', bodyId: contact.firstBodyId },
						{ type: 'body', bodyId: contact.secondBodyId }
					]
				: [
						{ type: 'fixed-collider', colliderId: contact.colliderId },
						{ type: 'body', bodyId: contact.bodyId }
					],
		contactPoint: contact.contactPoint,
		normalFromFirstToSecond: normal,
		preImpactNormalVelocity: result.preImpactNormalVelocity,
		postImpactNormalVelocity: result.postImpactNormalVelocity,
		impulse: result.impulse,
		preImpactVelocities: preVelocities,
		postImpactVelocities: postVelocities,
		impulseOnFirst: scaledVector(normal, -result.impulse),
		impulseOnSecond: scaledVector(normal, result.impulse),
		state: resolved.disposition,
		...(resolved.disposition === 'released'
			? {
					releaseReason:
						result.postImpactNormalVelocity > 0
							? ('impact-separation' as const)
							: ('support-reaction-zero' as const)
				}
			: {})
	};
}

export function unresolvedCoupledContactRecord(
	component: ExactTimeComponent,
	contact: ExactContact
): DynamicContactRecord {
	const normal = contact.type === 'body-body' ? contact.normalFromFirstToSecond : contact.normal;
	const velocities = participantVelocities(component, contact);
	return {
		id: contact.id,
		time: component.time,
		participants:
			contact.type === 'body-body'
				? [
						{ type: 'body', bodyId: contact.firstBodyId },
						{ type: 'body', bodyId: contact.secondBodyId }
					]
				: [
						{ type: 'fixed-collider', colliderId: contact.colliderId },
						{ type: 'body', bodyId: contact.bodyId }
					],
		contactPoint: contact.contactPoint,
		normalFromFirstToSecond: normal,
		preImpactNormalVelocity: relativeNormal(velocities, normal),
		postImpactNormalVelocity: null,
		impulse: null,
		preImpactVelocities: velocities,
		state: 'incoming'
	};
}

function participantVelocities(
	component: ExactTimeComponent,
	contact: ExactContact,
	response?: CommittedCoupledResponse
): readonly [Vec2, Vec2] {
	const velocity = (bodyId: string): Vec2 =>
		response?.bodyVelocities.find((body) => body.bodyId === bodyId)?.velocity ??
		component.bodies.find((body) => body.id === bodyId)!.velocity;
	return contact.type === 'body-body'
		? [velocity(contact.firstBodyId), velocity(contact.secondBodyId)]
		: [[0, 0], velocity(contact.bodyId)];
}

function relativeNormal(velocities: readonly [Vec2, Vec2], normal: Vec2): number {
	return (
		(velocities[1][0] - velocities[0][0]) * normal[0] +
		(velocities[1][1] - velocities[0][1]) * normal[1]
	);
}

function scaledVector(vector: Vec2, scale: number): Vec2 {
	const x = scale * vector[0];
	const y = scale * vector[1];
	return [x === 0 ? 0 : x, y === 0 ? 0 : y];
}
