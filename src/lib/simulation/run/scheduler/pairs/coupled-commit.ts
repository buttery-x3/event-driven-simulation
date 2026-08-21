import type { RunTerminalReason } from '../../../contracts';
import {
	selectPostContactMode,
	type ExactContact,
	type ResolvedContactState
} from '../../contact-resolution';
import { resolveCoupledImpact } from '../../dynamic-impact';
import { invalidateLocalPrediction, refreshBodyPrediction } from '../predictions';
import type { SchedulerState } from '../types';
import { rebuildDormantComponents, upsertDynamicContacts } from '../dormancy';
import { admitCertifiedDynamicSupports, interruptDynamicSupports } from '../dynamic-support';
import type { PairCommitResult } from './commit';
import {
	classifySelectedCoupledContacts,
	coupledImpactInput,
	selectCoupledContactCapture
} from './capture';
import type { ExactTimeComponent, PairComponentBodyState } from './component';
import {
	resolvedCoupledContactRecord,
	unresolvedCoupledContactRecord,
	type CommittedCoupledResponse
} from './coupled-contact-records';
import { selectLowSpeedEscape } from './low-speed-escape';
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
	if (result.type === 'rejected') {
		selectComponentDiagnostics(state, component, false);
		commitPrefixes(state, component.bodies);
		invalidateAffectedFutures(state, component);
		interruptDynamicSupports(state, component);
		recordSchedulerSteps(state, selection, component);
		if (result.diagnostic)
			state.impactSolves.push({
				...result.diagnostic,
				componentId: component.id,
				candidateEvidence: component.candidateEvidence
			});
		upsertDynamicContacts(
			state,
			component.contacts.map((contact) => unresolvedCoupledContactRecord(component, contact))
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
	const ordinary = selectCoupledContactCapture(state, component, result.response, tolerance);
	const selected = selectLowSpeedEscape(state, component, ordinary, tolerance);
	if (selected.type === 'rejected') {
		selectComponentDiagnostics(state, component, false);
		commitPrefixes(state, component.bodies);
		invalidateAffectedFutures(state, component);
		interruptDynamicSupports(state, component);
		recordSchedulerSteps(state, selection, component);
		upsertDynamicContacts(
			state,
			component.contacts.map((contact) => unresolvedCoupledContactRecord(component, contact))
		);
		recordComponent(state, component);
		return {
			type: 'terminal',
			reason: {
				type: 'numerical-failure',
				time: component.time,
				detail: `Low-speed constrained response failed closed: ${selected.reason}`
			}
		};
	}
	const constrained = selected.type === 'constrained';
	selectComponentDiagnostics(state, component, true);
	const response: CommittedCoupledResponse = constrained
		? constrainedResponse(selected.response)
		: selected.selected.response;
	const resolvedContacts = constrained
		? selected.resolvedContacts
		: classifySelectedCoupledContacts(component, selected.selected, tolerance);
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
	const preservedBodyIds = new Set(
		constrained ? selected.preservedAnchoredComponents.flatMap(({ record }) => record.bodyIds) : []
	);
	commitPrefixes(
		state,
		component.bodies.filter(({ id }) => !preservedBodyIds.has(id))
	);
	invalidateAffectedFutures(state, component, preservedBodyIds);
	interruptDynamicSupports(state, component);
	recordSchedulerSteps(state, selection, component);
	if (constrained) state.constrainedImpactSolves.push(selected.diagnostic);
	else {
		state.impactSolves.push({
			...selected.selected.response.diagnostic,
			componentId: component.id,
			candidateEvidence: component.candidateEvidence,
			contactCapture: selected.selected.contactCapture
		});
	}
	upsertDynamicContacts(
		state,
		resolvedContacts.contacts.map((contact) =>
			resolvedCoupledContactRecord(component, contact, response)
		)
	);
	recordComponent(state, component);
	applyResponse(state, component, response, resolvedContacts, preservedBodyIds);
	for (const body of component.bodies) {
		if (!preservedBodyIds.has(body.id)) state.runtimes.get(body.id)!.revision += 1;
	}
	const lifecycleContacts = withoutPreservedBodies(resolvedContacts, preservedBodyIds);
	const dormantBodyIds = rebuildDormantComponents(state, lifecycleContacts, response, tolerance);
	const admittedContactIds = admitCertifiedDynamicSupports(
		state,
		lifecycleContacts,
		response,
		tolerance
	);
	const unsupported = persistentDynamicReason(
		lifecycleContacts,
		dormantBodyIds,
		admittedContactIds
	);
	if (unsupported) return { type: 'terminal', reason: unsupported };
	for (const body of component.bodies) {
		if (preservedBodyIds.has(body.id)) continue;
		const runtime = state.runtimes.get(body.id)!;
		if (
			!runtime.dormantComponentId &&
			![...state.dynamicSupports.values()].some(({ movingBodyId }) => movingBodyId === body.id)
		)
			refreshBodyPrediction(state, runtime);
	}
	return { type: 'continued' };
}

function commitPrefixes(state: SchedulerState, bodies: readonly PairComponentBodyState[]): void {
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
	response: CommittedCoupledResponse,
	resolvedContacts: ResolvedContactState,
	preservedBodyIds: ReadonlySet<string>
): void {
	const velocities = new Map(
		response.bodyVelocities.map(({ bodyId, velocity }) => [bodyId, velocity])
	);
	const contactRoles = new Map(
		resolvedContacts.contacts.map((contact) => [contact.contact.id, contact])
	);
	for (const body of component.bodies) {
		if (preservedBodyIds.has(body.id)) continue;
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

function invalidateAffectedFutures(
	state: SchedulerState,
	component: ExactTimeComponent,
	preservedBodyIds: ReadonlySet<string> = new Set()
): void {
	const componentBodyIds = new Set(component.bodies.map(({ id }) => id));
	const bodyIds = new Set(
		component.bodies.flatMap(({ id }) => (preservedBodyIds.has(id) ? [] : [id]))
	);
	retainUnrelatedPairDiagnostics(state, componentBodyIds, state.worldTime);
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
		componentBodyIds,
		`Invalidated by coupled impact component ${component.id}.`
	);
}

function constrainedResponse(
	response: import('../../dynamic-impact').LowSpeedElasticResponse
): CommittedCoupledResponse {
	return {
		bodyVelocities: response.bodyVelocities,
		contacts: response.contacts.map((contact) => ({
			contactId: contact.contactId,
			preImpactNormalVelocity: contact.preImpactNormalVelocity,
			postImpactNormalVelocity: contact.postImpactNormalVelocity,
			impulse:
				response.impactImpulses.find(({ contactId }) => contactId === contact.contactId)?.impulse ??
				0
		}))
	};
}

function withoutPreservedBodies(
	resolved: ResolvedContactState,
	preservedBodyIds: ReadonlySet<string>
): ResolvedContactState {
	if (preservedBodyIds.size === 0) return resolved;
	const bodies = resolved.eventState.bodies.filter(({ id }) => !preservedBodyIds.has(id));
	const contacts = resolved.eventState.contacts.filter((contact) =>
		contact.type === 'body-fixed'
			? !preservedBodyIds.has(contact.bodyId)
			: !preservedBodyIds.has(contact.firstBodyId) && !preservedBodyIds.has(contact.secondBodyId)
	);
	const contactIds = new Set(contacts.map(({ id }) => id));
	return {
		eventState: { ...resolved.eventState, bodies, contacts },
		contacts: resolved.contacts.filter(({ contact }) => contactIds.has(contact.id))
	};
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
