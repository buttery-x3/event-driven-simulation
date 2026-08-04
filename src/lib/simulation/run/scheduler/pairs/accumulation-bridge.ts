import type { Vec2 } from '../../../contracts';
import {
	certifyAccumulationLimit,
	type AccumulationLimit,
	type AccumulationPhysicalEvent
} from '../../accumulation';
import type { SchedulerState } from '../types';
import type { ActiveComponentContact, ComponentBodyState, ExactTimeComponent } from './component';

export function maybePromoteAccumulatingComponent(
	state: SchedulerState,
	incomingComponent: ExactTimeComponent,
	tolerance: number
): {
	readonly component: ExactTimeComponent;
	readonly restitution: number;
	readonly physicalEvent: AccumulationPhysicalEvent;
	readonly certified: boolean;
} {
	const physicalEvent = physicalEventFromComponent(incomingComponent);
	const recentHistory = [
		...state.physicalEventHistory.filter((event) =>
			event.participantBodyIds.some((id) => incomingComponent.bodies.some((body) => body.id === id))
		),
		physicalEvent
	].slice(-12);
	const accumulation = certifyAccumulationLimit({
		simulation: state.input,
		events: recentHistory,
		currentBodies: incomingComponent.bodies.map((body) => ({
			bodyId: body.id,
			mass: body.mass,
			radius: body.radius,
			position: body.position,
			velocity: body.velocity
		})),
		minimumEvents: 5
	});
	if (accumulation.type !== 'certified') {
		return {
			component: incomingComponent,
			restitution: state.input.settings.restitution,
			physicalEvent,
			certified: false
		};
	}
	const promoted = componentFromAccumulation(incomingComponent, accumulation.limit, tolerance);
	if (!promoted) {
		return {
			component: incomingComponent,
			restitution: state.input.settings.restitution,
			physicalEvent,
			certified: false
		};
	}
	recordPromotionDiagnostics(state, promoted, accumulation.limit);
	return {
		component: promoted,
		restitution: 0,
		physicalEvent,
		certified: true
	};
}

export function recordPhysicalEvent(
	state: SchedulerState,
	physicalEvent: AccumulationPhysicalEvent
): void {
	state.physicalEventHistory.push(physicalEvent);
	if (state.physicalEventHistory.length > 64) {
		state.physicalEventHistory.splice(0, state.physicalEventHistory.length - 64);
	}
}

function recordPromotionDiagnostics(
	state: SchedulerState,
	component: ExactTimeComponent,
	limit: AccumulationLimit
): void {
	for (const body of component.bodies) {
		const runtime = state.runtimes.get(body.id);
		runtime?.entries.push({
			severity: 'info',
			code: 'ACCUMULATION_CERTIFIED',
			message: `Certified multi-body accumulation (${limit.certificationMethod}) for bodies [${limit.participantBodyIds.join(', ')}] with remaining-time upper bound ${limit.remainingTimeUpperBound} s and ${limit.activeLimitContacts.length} limit contacts.`,
			time: component.time,
			bodyId: body.id
		});
		runtime?.entries.push({
			severity: 'info',
			code: 'ACCUMULATION_PROMOTED',
			message: `Promoted limiting multi-body contact component through FLAME-53 at t=${component.time} s; path=${limit.path}.`,
			time: component.time,
			bodyId: body.id
		});
	}
}

function physicalEventFromComponent(component: ExactTimeComponent): AccumulationPhysicalEvent {
	const bodyIds = component.bodies.map(({ id }) => id).sort();
	const fixedColliderIds = [
		...new Set(
			component.contacts.flatMap((contact) =>
				contact.type === 'body-fixed' ? [contact.colliderId] : []
			)
		)
	].sort();
	const dynamicPartnerBodyIds = [
		...new Set(
			component.contacts.flatMap((contact) =>
				contact.type === 'body-body' ? [contact.firstBodyId, contact.secondBodyId] : []
			)
		)
	].sort();
	return {
		eventId: component.id,
		time: component.time,
		participantBodyIds: bodyIds,
		fixedColliderIds,
		dynamicPartnerBodyIds,
		contactEdgeKeys: component.contacts.map(({ id }) => id).sort(),
		bodyStates: component.bodies.map((body) => ({
			bodyId: body.id,
			mass: body.mass,
			radius: body.radius,
			position: body.position,
			velocity: body.velocity
		})),
		maxRelativeNormalSpeed: Math.max(
			0,
			...component.contacts.map((contact) => normalApproachSpeed(component, contact))
		)
	};
}

function normalApproachSpeed(
	component: ExactTimeComponent,
	contact: ActiveComponentContact
): number {
	if (contact.type === 'body-fixed') {
		const body = component.bodies.find(({ id }) => id === contact.bodyId);
		if (!body) return 0;
		return Math.max(
			0,
			-(body.velocity[0] * contact.normal[0] + body.velocity[1] * contact.normal[1])
		);
	}
	const first = component.bodies.find(({ id }) => id === contact.firstBodyId);
	const second = component.bodies.find(({ id }) => id === contact.secondBodyId);
	if (!first || !second) return 0;
	const relative: Vec2 = [
		second.velocity[0] - first.velocity[0],
		second.velocity[1] - first.velocity[1]
	];
	return Math.max(
		0,
		-(
			relative[0] * contact.normalFromFirstToSecond[0] +
			relative[1] * contact.normalFromFirstToSecond[1]
		)
	);
}

function componentFromAccumulation(
	source: ExactTimeComponent,
	limit: AccumulationLimit,
	tolerance: number
): ExactTimeComponent | null {
	const bodies = limit.limitingBodyStates
		.map((state) => {
			const sourceBody = source.bodies.find(({ id }) => id === state.bodyId);
			if (!sourceBody) return null;
			return {
				id: state.bodyId,
				mass: state.mass,
				radius: state.radius,
				position: state.position,
				velocity: state.velocity,
				prefixSegment: sourceBody.prefixSegment
			} satisfies ComponentBodyState;
		})
		.filter((body): body is ComponentBodyState => body !== null)
		.sort((left, right) => left.id.localeCompare(right.id));
	if (bodies.length === 0) return null;
	const contacts: ActiveComponentContact[] = [];
	for (const contact of limit.activeLimitContacts) {
		if (contact.type === 'body-body' && contact.secondBodyId) {
			contacts.push({
				type: 'body-body',
				id: contact.id,
				firstBodyId: contact.bodyId,
				secondBodyId: contact.secondBodyId,
				normalFromFirstToSecond: contact.normal,
				contactPoint: contact.contactPoint,
				selection: null
			});
			continue;
		}
		const candidate = limit.fixedCandidates.find(
			({ colliderId, bodyId }) => colliderId === contact.colliderId && bodyId === contact.bodyId
		);
		if (!candidate || !contact.colliderId) continue;
		contacts.push({
			type: 'body-fixed',
			id: contact.id,
			bodyId: contact.bodyId,
			colliderId: contact.colliderId,
			normal: contact.normal,
			contactPoint: contact.contactPoint,
			candidate
		});
	}
	if (contacts.length === 0) return null;
	return {
		id: `accumulation-impact:${source.time}:${bodies.map(({ id }) => id).join('+')}`,
		time: source.time,
		bodies,
		contacts,
		candidateEvidence: [
			...source.candidateEvidence,
			...contacts.map((contact) => ({
				id: contact.id,
				type: contact.type,
				separation:
					limit.geometricResiduals.find(({ contactId }) => contactId === contact.id)?.separation ??
					0,
				active: true,
				reason:
					Math.abs(
						limit.geometricResiduals.find(({ contactId }) => contactId === contact.id)
							?.separation ?? 0
					) <= tolerance
						? 'accumulation-limit-active'
						: 'accumulation-limit-rejected'
			}))
		]
	};
}
