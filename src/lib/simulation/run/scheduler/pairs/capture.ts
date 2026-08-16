import type { ContactCaptureDiagnostic, Vec2 } from '../../../contracts';
import {
	resolveCoupledImpact,
	selectContactCapture,
	type ContactCaptureEndpoint,
	type CoupledImpactInput,
	type CoupledImpactResponse
} from '../../dynamic-impact';
import type { SchedulerState } from '../types';
import type { ActiveComponentContact, ExactTimeComponent } from './component';

export interface SelectedCoupledImpact {
	readonly response: CoupledImpactResponse;
	readonly contactCapture: ContactCaptureDiagnostic;
}

export function coupledImpactInput(
	state: SchedulerState,
	component: ExactTimeComponent,
	tolerance: number,
	restitution = state.input.settings.restitution,
	contacts: readonly ActiveComponentContact[] = component.contacts
): CoupledImpactInput {
	return {
		bodies: component.bodies.map(({ id, mass, velocity }) => ({ id, mass, velocity })),
		contacts: contacts.map((contact) =>
			contact.type === 'body-body'
				? {
						type: 'body-body' as const,
						id: contact.id,
						firstBodyId: contact.firstBodyId,
						secondBodyId: contact.secondBodyId,
						normalFromFirstToSecond: contact.normalFromFirstToSecond
					}
				: {
						type: 'body-fixed' as const,
						id: contact.id,
						bodyId: contact.bodyId,
						colliderId: contact.colliderId,
						normal: contact.normal
					}
		),
		restitution,
		tolerances: {
			numerical: tolerance,
			absoluteNormalVelocityFloor: Math.max(tolerance, Number.EPSILON * 512),
			relativeViolationEpsilon: Math.max(Number.EPSILON * 512, tolerance * 1e-3),
			maximumReflections: Math.max(128, contacts.length * contacts.length * 32)
		}
	};
}

export function selectCoupledContactCapture(
	state: SchedulerState,
	component: ExactTimeComponent,
	ordinary: CoupledImpactResponse,
	tolerance: number
): SelectedCoupledImpact {
	const fullInelastic = solveInelastic(state, component, component.contacts, tolerance);
	if (!fullInelastic) return ordinaryFallback(state, component, ordinary, tolerance);
	const selected = selectContactCapture({
		bodies: component.bodies.map(({ id, mass, velocity }) => ({
			id,
			mass,
			incomingVelocity: velocity,
			freeAcceleration: state.input.settings.gravity
		})),
		contacts: component.contacts.map((contact) =>
			contact.type === 'body-body'
				? {
						id: contact.id,
						type: contact.type,
						firstBodyId: contact.firstBodyId,
						secondBodyId: contact.secondBodyId,
						normalFromFirstToSecond: contact.normalFromFirstToSecond,
						curvatureRadius:
							component.bodies.find(({ id }) => id === contact.firstBodyId)!.radius +
							component.bodies.find(({ id }) => id === contact.secondBodyId)!.radius
					}
				: {
						id: contact.id,
						type: contact.type,
						bodyId: contact.bodyId,
						normal: contact.normal,
						curvatureRadius: fixedCurvatureRadius(state, component, contact)
					}
		),
		ordinary: endpoint(ordinary),
		inelastic: endpoint(fullInelastic),
		contactCaptureDistance: state.input.settings.contactCaptureDistance,
		numericalTolerance: tolerance,
		solveInelastic: (contactIds) => {
			const contacts = component.contacts.filter((contact) => contactIds.includes(contact.id));
			const response = solveInelastic(state, component, contacts, tolerance);
			return response ? endpoint(response) : null;
		}
	});
	if (selected.diagnostic.selectedEndpoint === 'ordinary') {
		return { response: ordinary, contactCapture: selected.diagnostic };
	}
	const response = selectedResponse(component, ordinary, selected.endpoint);
	if (!response) return ordinaryFallback(state, component, ordinary, tolerance);
	return {
		response,
		contactCapture: selected.diagnostic
	};
}

function solveInelastic(
	state: SchedulerState,
	component: ExactTimeComponent,
	contacts: readonly ActiveComponentContact[],
	tolerance: number
): CoupledImpactResponse | null {
	if (contacts.length === 0) return null;
	const result = resolveCoupledImpact(coupledImpactInput(state, component, tolerance, 0, contacts));
	return result.type === 'response' ? result.response : null;
}

function selectedResponse(
	component: ExactTimeComponent,
	ordinary: CoupledImpactResponse,
	selected: ContactCaptureEndpoint
): CoupledImpactResponse | null {
	const velocityByBody = new Map(
		selected.bodyVelocities.map(({ bodyId, velocity }) => [bodyId, velocity])
	);
	const bodyVelocities = component.bodies.map(({ id }) => ({
		bodyId: id,
		velocity: velocityByBody.get(id)
	}));
	if (bodyVelocities.some(({ velocity }) => velocity === undefined)) return null;
	const selectedByContact = new Map(
		selected.contacts.map((contact) => [contact.contactId, contact])
	);
	const ordinaryByContact = new Map(
		ordinary.contacts.map((contact) => [contact.contactId, contact])
	);
	const finalVelocity = bodyVelocities.flatMap(({ velocity }) => velocity!);
	return {
		...ordinary,
		bodyVelocities: bodyVelocities.map(({ bodyId, velocity }) => ({
			bodyId,
			velocity: velocity!
		})),
		contacts: component.contacts.map((contact) => {
			const selectedContact = selectedByContact.get(contact.id);
			return {
				...ordinaryByContact.get(contact.id)!,
				impulse: selectedContact?.impulse ?? 0,
				postImpactNormalVelocity: relativeNormal(component, contact, velocityByBody)
			};
		}),
		finalVelocity,
		diagnostic: {
			...ordinary.diagnostic,
			finalVelocity
		}
	};
}

function endpoint(response: CoupledImpactResponse): ContactCaptureEndpoint {
	return { bodyVelocities: response.bodyVelocities, contacts: response.contacts };
}

function fixedCurvatureRadius(
	state: SchedulerState,
	component: ExactTimeComponent,
	contact: Extract<ActiveComponentContact, { readonly type: 'body-fixed' }>
): number | null {
	const bodyRadius = component.bodies.find(({ id }) => id === contact.bodyId)!.radius;
	if (
		contact.candidate.feature === 'start-endpoint' ||
		contact.candidate.feature === 'end-endpoint'
	) {
		return bodyRadius;
	}
	if (contact.candidate.feature !== 'circle') return null;
	const collider = state.input.scene.staticColliders.find(({ id }) => id === contact.colliderId);
	return collider?.physicalShape.type === 'circle'
		? bodyRadius + collider.physicalShape.radius
		: null;
}

function relativeNormal(
	component: ExactTimeComponent,
	contact: ActiveComponentContact,
	velocityByBody: ReadonlyMap<string, Vec2>
): number {
	if (contact.type === 'body-fixed') {
		const velocity = velocityByBody.get(contact.bodyId)!;
		return velocity[0] * contact.normal[0] + velocity[1] * contact.normal[1];
	}
	const first = velocityByBody.get(contact.firstBodyId)!;
	const second = velocityByBody.get(contact.secondBodyId)!;
	return (
		(second[0] - first[0]) * contact.normalFromFirstToSecond[0] +
		(second[1] - first[1]) * contact.normalFromFirstToSecond[1]
	);
}

function ordinaryFallback(
	state: SchedulerState,
	component: ExactTimeComponent,
	ordinary: CoupledImpactResponse,
	tolerance: number
): SelectedCoupledImpact {
	const retainedContactIds = ordinary.contacts
		.filter(({ postImpactNormalVelocity }) => postImpactNormalVelocity <= tolerance)
		.map(({ contactId }) => contactId);
	const retainedContactIdSet = new Set(retainedContactIds);
	return {
		response: ordinary,
		contactCapture: {
			captureDistance: state.input.settings.contactCaptureDistance,
			selectedEndpoint: 'ordinary',
			meaningfulReboundVeto: false,
			meaningfulReboundContactIds: [],
			activeSetRemovalSequence: [],
			retainedContactIds,
			releasedContactIds: ordinary.contacts
				.filter(({ contactId }) => !retainedContactIdSet.has(contactId))
				.map(({ contactId }) => contactId),
			contacts: component.contacts.map((contact) => ({
				contactId: contact.id,
				ordinaryPostImpactNormalVelocity: ordinary.contacts.find(
					({ contactId }) => contactId === contact.id
				)!.postImpactNormalVelocity,
				geometricNormalAcceleration: 0,
				pressingNormalAcceleration: null,
				reboundExcursion: null,
				withinCaptureDistance: null,
				impulsivelyActive: false,
				supportReaction: 0,
				retained: retainedContactIdSet.has(contact.id)
			}))
		}
	};
}
