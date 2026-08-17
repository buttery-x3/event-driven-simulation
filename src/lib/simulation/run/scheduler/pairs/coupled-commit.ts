import type { DynamicContactRecord, RunTerminalReason, Vec2 } from '../../../contracts';
import {
	classifyPostResponseContacts,
	selectPostContactMode,
	type ExactContact,
	type ExactContactBodyState,
	type ResolvedContactRole,
	type ResolvedContactState
} from '../../contact-resolution';
import { resolveCoupledImpact, type CoupledImpactResponse } from '../../dynamic-impact';
import { invalidateLocalPrediction, refreshBodyPrediction } from '../predictions';
import type { SchedulerState } from '../types';
import { rebuildDormantComponents, upsertDynamicContacts } from '../dormancy';
import { admitCertifiedDynamicSupports, interruptDynamicSupports } from '../dynamic-support';
import type { PairCommitResult } from './commit';
import { coupledImpactInput, selectCoupledContactCapture } from './capture';
import type { ExactTimeComponent } from './component';
import {
	invalidatePairDiagnostics,
	retainUnrelatedPairDiagnostics,
	selectPairDiagnostics,
	type PairSchedulerSelection
} from './selection';

export function commitCoupledImpact(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>,
	component: ExactTimeComponent
): PairCommitResult {
	const tolerance = Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256);
	const result = resolveCoupledImpact(coupledImpactInput(state, component, tolerance));
	selectComponentDiagnostics(state, component, result.type === 'response');
	commitPrefixes(state, component.bodies);
	invalidateAffectedFutures(state, component);
	interruptDynamicSupports(state, component);
	recordSchedulerSteps(state, selection, component);
	if (result.type === 'rejected') {
		if (result.diagnostic)
			state.impactSolves.push({
				...result.diagnostic,
				componentId: component.id,
				candidateEvidence: component.candidateEvidence
			});
		upsertDynamicContacts(
			state,
			component.contacts.map((contact) => unresolvedContact(component, contact))
		);
		recordComponent(state, component);
		return {
			type: 'terminal',
			reason: {
				type: 'numerical-failure',
				time: component.time,
				detail: `Coupled impact failed closed: ${result.reason}`
			}
		};
	}
	const selected = selectCoupledContactCapture(state, component, result.response, tolerance);
	const response = selected.response;
	const resolvedContacts = classifyCoupledContacts(component, response, tolerance);
	if (!resolvedContacts) {
		return {
			type: 'terminal',
			reason: {
				type: 'numerical-failure',
				time: component.time,
				detail: 'The coupled response did not classify every exact-time contact.'
			}
		};
	}
	state.impactSolves.push({
		...response.diagnostic,
		componentId: component.id,
		candidateEvidence: component.candidateEvidence,
		contactCapture: selected.contactCapture
	});
	upsertDynamicContacts(
		state,
		resolvedContacts.contacts.map((contact) => resolvedContact(component, contact, response))
	);
	recordComponent(state, component);
	applyResponse(state, component, response, resolvedContacts);
	for (const body of component.bodies) state.runtimes.get(body.id)!.revision += 1;
	const dormantBodyIds = rebuildDormantComponents(state, resolvedContacts, response, tolerance);
	const admittedContactIds = admitCertifiedDynamicSupports(
		state,
		resolvedContacts,
		response,
		tolerance
	);
	const unsupported = persistentDynamicReason(resolvedContacts, dormantBodyIds, admittedContactIds);
	if (unsupported) return { type: 'terminal', reason: unsupported };
	for (const body of component.bodies) {
		const runtime = state.runtimes.get(body.id)!;
		if (
			!runtime.dormantComponentId &&
			![...state.dynamicSupports.values()].some(({ movingBodyId }) => movingBodyId === body.id)
		)
			refreshBodyPrediction(state, runtime);
	}
	return { type: 'continued' };
}

function commitPrefixes(state: SchedulerState, bodies: readonly ExactContactBodyState[]): void {
	for (const body of bodies) {
		const runtime = state.runtimes.get(body.id)!;
		if (body.prefixSegment && body.prefixSegment.endTime > body.prefixSegment.startTime)
			runtime.segments.push(body.prefixSegment);
		runtime.committedTime = state.worldTime;
		runtime.state = {
			...runtime.state,
			time: state.worldTime,
			position: body.position,
			velocity: body.velocity
		};
	}
}

function applyResponse(
	state: SchedulerState,
	component: ExactTimeComponent,
	response: CoupledImpactResponse,
	resolvedContacts: ResolvedContactState
): void {
	const velocities = new Map(
		response.bodyVelocities.map(({ bodyId, velocity }) => [bodyId, velocity])
	);
	const contactRoles = new Map(
		resolvedContacts.contacts.map((contact) => [contact.contact.id, contact])
	);
	for (const body of component.bodies) {
		const runtime = state.runtimes.get(body.id)!;
		const retainedFixed = component.contacts.filter(
			(contact): contact is Extract<ExactContact, { readonly type: 'body-fixed' }> =>
				contact.type === 'body-fixed' &&
				contact.bodyId === body.id &&
				contactRoles.get(contact.id)?.disposition === 'retained'
		);
		runtime.prepared = null;
		runtime.terminalReason = null;
		runtime.dormantComponentId = null;
		runtime.impactHistory.splice(0);
		runtime.state = {
			...runtime.state,
			time: component.time,
			position: body.position,
			velocity: velocities.get(body.id)!,
			releasedContactColliderId: null,
			releasedContactColliderIds: component.contacts
				.filter(
					(contact): contact is Extract<ExactContact, { readonly type: 'body-fixed' }> =>
						contact.type === 'body-fixed' &&
						contact.bodyId === body.id &&
						!retainedFixed.includes(contact)
				)
				.map((contact) => contact.colliderId),
			retainedSupportCandidates: [],
			pendingContactCandidates: retainedFixed.map(({ candidate }) => candidate),
			acceptInitialContact: retainedFixed.length > 0,
			toleranceContainedReleaseColliderIds: []
		};
	}
}

function resolvedContact(
	component: ExactTimeComponent,
	resolved: ResolvedContactRole,
	response: CoupledImpactResponse
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
		state: resolved.disposition
	};
}

function unresolvedContact(
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
	response?: CoupledImpactResponse
): readonly [Vec2, Vec2] {
	const velocity = (bodyId: string): Vec2 =>
		response?.bodyVelocities.find((body) => body.bodyId === bodyId)?.velocity ??
		component.bodies.find((body) => body.id === bodyId)!.velocity;
	return contact.type === 'body-body'
		? [velocity(contact.firstBodyId), velocity(contact.secondBodyId)]
		: [[0, 0], velocity(contact.bodyId)];
}

function persistentDynamicReason(
	resolvedContacts: ResolvedContactState,
	dormantBodyIds: ReadonlySet<string>,
	admittedContactIds: ReadonlySet<string>
): RunTerminalReason | null {
	const component = resolvedContacts.eventState;
	const retainedDynamic = resolvedContacts.contacts.find(
		({ contact, disposition }) =>
			contact.type === 'body-body' &&
			!admittedContactIds.has(contact.id) &&
			disposition === 'retained' &&
			(!dormantBodyIds.has(contact.firstBodyId) || !dormantBodyIds.has(contact.secondBodyId))
	)?.contact;
	const retainedFixed = resolvedContacts.contacts.some(
		({ contact, disposition }) => contact.type === 'body-fixed' && disposition === 'retained'
	);
	if (!retainedDynamic || !retainedFixed || retainedDynamic.type !== 'body-body') return null;
	const mode = selectPostContactMode({
		contacts: resolvedContacts,
		unsupportedBodyContactId: retainedDynamic.id
	});
	if (mode.type !== 'unsupported') return null;
	return {
		type: 'unsupported-body-body-response',
		time: component.time,
		bodyIds: mode.bodyIds,
		contactId: mode.contactId,
		detail:
			'The instantaneous coupled impact succeeded, but retained dynamic contact with fixed support requires a persistent body-body mode.'
	};
}

function classifyCoupledContacts(
	component: ExactTimeComponent,
	response: CoupledImpactResponse,
	tolerance: number
): ResolvedContactState | null {
	return classifyPostResponseContacts(
		component,
		response.contacts.map((contact) => ({
			contactId: contact.contactId,
			preResponseNormalVelocity: contact.preImpactNormalVelocity,
			postResponseNormalVelocity: contact.postImpactNormalVelocity,
			impulse: contact.impulse
		})),
		tolerance
	);
}

function invalidateAffectedFutures(state: SchedulerState, component: ExactTimeComponent): void {
	const bodyIds = new Set(component.bodies.map(({ id }) => id));
	retainUnrelatedPairDiagnostics(state, bodyIds, state.worldTime);
	for (const bodyId of bodyIds) {
		invalidateLocalPrediction(
			state,
			bodyId,
			`Invalidated by coupled impact component ${component.id}.`
		);
		const runtime = state.runtimes.get(bodyId);
		if (runtime) runtime.prepared = null;
	}
	invalidatePairDiagnostics(
		state,
		bodyIds,
		`Invalidated by coupled impact component ${component.id}.`
	);
}

function selectComponentDiagnostics(
	state: SchedulerState,
	component: ExactTimeComponent,
	resolved: boolean
): void {
	const diagnosticIds = component.selectionDiagnosticIds;
	selectPairDiagnostics(
		state,
		new Set(diagnosticIds),
		resolved
			? 'This contact belongs to the earliest resolved exact-time component.'
			: 'This contact belongs to the earliest exact-time component that failed closed.'
	);
}

function recordSchedulerSteps(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>,
	component: ExactTimeComponent
): void {
	const bodyIds = new Set(component.bodies.map(({ id }) => id));
	const retainedBodyIds = [...state.predictions.keys()].filter((id) => !bodyIds.has(id)).sort();
	for (const bodyId of [...bodyIds].sort()) {
		state.steps.push({
			worldTime: selection.time,
			bodyId,
			revision: state.runtimes.get(bodyId)!.revision,
			eventType: 'body-contact',
			retainedBodyIds
		});
	}
}

function recordComponent(state: SchedulerState, component: ExactTimeComponent): void {
	state.contactComponents.push({
		id: component.id,
		type: 'exact-time-impact',
		createdAtTime: component.time,
		dissolvedAtTime: component.time,
		bodyIds: component.bodies.map(({ id }) => id).sort(),
		fixedColliderIds: [
			...new Set(
				component.contacts
					.filter((contact) => contact.type === 'body-fixed')
					.map(({ colliderId }) => colliderId)
			)
		].sort(),
		activeContactIds: component.contacts.map(({ id }) => id).sort(),
		retainedSupportReactions: [],
		revision: 0,
		futureScheduledEventTimes: []
	});
	state.componentEvents.push(
		{
			type: 'contact-component-lifecycle',
			time: component.time,
			change: 'created',
			componentIds: [],
			resultingComponentIds: [component.id]
		},
		{
			type: 'contact-component-lifecycle',
			time: component.time,
			change: 'dissolved',
			componentIds: [component.id],
			resultingComponentIds: []
		}
	);
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
