import type { Vec2 } from '../../../contracts';
import type { AccumulationObservation, AccumulationObservedContact } from '../../accumulation';
import type { LocalBodyPrediction } from '../../single-ball/local-events';
import type { SchedulerState } from '../types';
import { snapshotComponentBodyStates, type ExactTimeComponent } from '../pairs/component';

export function localAccumulationObservation(
	state: SchedulerState,
	prediction: Extract<LocalBodyPrediction, { readonly kind: 'contact' }>
): AccumulationObservation | null {
	const snapshots = snapshotComponentBodyStates(state, prediction.time);
	if (!snapshots.some(({ id }) => id === prediction.bodyId)) return null;
	const contacts: AccumulationObservedContact[] = prediction.result.activeCandidates.map(
		(candidate) => ({
			type: 'body-fixed',
			bodyId: candidate.bodyId,
			colliderId: candidate.colliderId,
			feature: candidate.feature,
			normal: candidate.normal
		})
	);
	return observationFrom(
		`physical-fixed-contact:${prediction.bodyId}:${prediction.time}:${contacts
			.map((contact) => (contact.type === 'body-fixed' ? contact.colliderId : ''))
			.sort()
			.join('+')}`,
		prediction.time,
		[prediction.bodyId],
		snapshots,
		contacts,
		Math.max(0, ...prediction.result.activeCandidates.map(({ normalVelocity }) => -normalVelocity))
	);
}

export function pairAccumulationObservation(
	state: SchedulerState,
	component: ExactTimeComponent
): AccumulationObservation {
	const snapshots = snapshotComponentBodyStates(state, component.time);
	const contacts: AccumulationObservedContact[] = component.contacts.map((contact) =>
		contact.type === 'body-fixed'
			? {
					type: 'body-fixed',
					bodyId: contact.bodyId,
					colliderId: contact.colliderId,
					feature: contact.candidate.feature,
					normal: contact.normal
				}
			: {
					type: 'body-body',
					firstBodyId: contact.firstBodyId,
					secondBodyId: contact.secondBodyId,
					normalFromFirstToSecond: contact.normalFromFirstToSecond
				}
	);
	return observationFrom(
		`physical-component-contact:${component.id}`,
		component.time,
		component.bodies.map(({ id }) => id),
		snapshots,
		contacts,
		maximumNormalSpeed(component)
	);
}

function observationFrom(
	id: string,
	time: number,
	participantBodyIds: readonly string[],
	snapshots: ReturnType<typeof snapshotComponentBodyStates>,
	contacts: readonly AccumulationObservedContact[],
	maximumRelativeNormalSpeed: number
): AccumulationObservation {
	return {
		id,
		time,
		participantBodyIds: [...participantBodyIds].sort(),
		candidateFixedColliderIds: [
			...new Set(
				contacts.flatMap((contact) => (contact.type === 'body-fixed' ? [contact.colliderId] : []))
			)
		].sort(),
		bodyStates: snapshots.map(({ id: bodyId, mass, radius, position, velocity }) => ({
			bodyId,
			mass,
			radius,
			position,
			velocity
		})),
		contacts,
		maximumRelativeNormalSpeed,
		kind: 'physical-contact'
	};
}

function maximumNormalSpeed(component: ExactTimeComponent): number {
	return Math.max(
		0,
		...component.contacts.map((contact) => {
			if (contact.type === 'body-fixed') {
				const body = component.bodies.find(({ id }) => id === contact.bodyId)!;
				return Math.max(0, -dot(body.velocity, contact.normal));
			}
			const first = component.bodies.find(({ id }) => id === contact.firstBodyId)!;
			const second = component.bodies.find(({ id }) => id === contact.secondBodyId)!;
			return Math.max(
				0,
				-dot(
					[second.velocity[0] - first.velocity[0], second.velocity[1] - first.velocity[1]],
					contact.normalFromFirstToSecond
				)
			);
		})
	);
}

function dot(left: Vec2, right: Vec2): number {
	return left[0] * right[0] + left[1] * right[1];
}
