import type {
	AccumulationConnectedComponent,
	AccumulationDiagnostic,
	AccumulationLimit,
	Vec2
} from '../../../contracts';
import type { AccumulationObservation } from '../../accumulation';
import type { SchedulerState } from '../types';
import { commitCoupledImpact } from '../pairs/coupled-commit';
import {
	snapshotComponentBodyStates,
	type ActiveComponentContact,
	type ComponentBodyState,
	type ExactTimeComponent
} from '../pairs/component';
import type { PairCommitResult } from '../pairs/commit';

export interface AccumulationPromotionResult {
	readonly result: PairCommitResult;
	readonly impactComponentIds: readonly string[];
	readonly supportComponentIds: readonly string[];
	readonly classification: AccumulationDiagnostic['finalClassification'];
}

export function promoteAccumulationLimit(
	state: SchedulerState,
	limit: AccumulationLimit,
	observation: AccumulationObservation
): AccumulationPromotionResult | null {
	const snapshots = snapshotComponentBodyStates(state, limit.currentCertifiedTime);
	const components = promotedComponents(state, limit, snapshots);
	if (!components) return null;
	commitSourcePrefixes(state, limit, snapshots, observation);
	state.worldTime = limit.candidateLimitTime;
	const componentCount = state.contactComponents.length;
	let result: PairCommitResult = { type: 'continued' };
	for (const component of components) {
		result = commitCoupledImpact(state, null, component);
		if (result.type === 'terminal') break;
	}
	const created = state.contactComponents.slice(componentCount);
	const supportComponentIds = created
		.filter(({ type }) => type !== 'exact-time-impact')
		.map(({ id }) => id);
	const classification: AccumulationDiagnostic['finalClassification'] =
		result.type === 'terminal'
			? 'unresolved'
			: created.some(({ type }) => type === 'resting-anchored')
				? 'rest'
				: created.some(({ type }) => type === 'dynamic-sustained-support')
					? 'sustained'
					: hasPressingFixedContinuation(state, limit.participantBodyIds)
						? 'sustained'
						: hasRetainedLimitContact(state, limit)
							? 'release'
							: 'separation';
	for (const component of components)
		recordPromotedModeTransitions(state, component, classification);
	return {
		result,
		impactComponentIds: components.map(({ id }) => id),
		supportComponentIds,
		classification
	};
}

function hasRetainedLimitContact(state: SchedulerState, limit: AccumulationLimit): boolean {
	const componentIds = new Set(
		limit.activeLimitContacts.map((contact) => `${contact.id}:${limit.currentCertifiedTime}`)
	);
	return state.dynamicContacts.some(
		(contact) => componentIds.has(contact.id) && contact.state === 'retained'
	);
}

function hasPressingFixedContinuation(state: SchedulerState, bodyIds: readonly string[]): boolean {
	return bodyIds.some((bodyId) => {
		const runtime = state.runtimes.get(bodyId);
		return runtime?.state.pendingContactCandidates.some(
			({ normal }) => dot(state.input.settings.gravity, normal) < 0
		);
	});
}

function promotedComponents(
	state: SchedulerState,
	limit: AccumulationLimit,
	snapshots: readonly ComponentBodyState[]
): readonly ExactTimeComponent[] | null {
	const allBodies = limit.limitingBodyStates.flatMap((limitingState) => {
		const snapshot = snapshots.find(({ id }) => id === limitingState.bodyId);
		const residual = limit.stateResiduals.find(({ bodyId }) => bodyId === limitingState.bodyId);
		return snapshot
			? [
					{
						...snapshot,
						position: limitingState.position,
						velocity: limitingState.velocity,
						prefixSegment: residual
							? {
									type: 'accumulation-tail' as const,
									bodyId: limitingState.bodyId,
									startTime: limit.currentCertifiedTime,
									endTime: limit.candidateLimitTime,
									startPosition: snapshot.position,
									startVelocity: snapshot.velocity,
									endPosition: limitingState.position,
									endVelocity: limitingState.velocity,
									accumulationLimitId: limit.id,
									positionTailUpperBound: residual.positionTailUpperBound,
									velocityTailUpperBound: residual.velocityTailUpperBound
								}
							: null
					}
				]
			: [];
	});
	if (allBodies.length !== limit.participantBodyIds.length) return null;
	const components = limit.connectedComponents.map((connected) =>
		promotedComponent(state, limit, allBodies, connected)
	);
	if (components.some((component) => component === null)) return null;
	const coveredBodyIds = new Set(
		components.flatMap((component) => component?.bodies.map(({ id }) => id) ?? [])
	);
	return coveredBodyIds.size === limit.participantBodyIds.length
		? (components as readonly ExactTimeComponent[])
		: null;
}

function promotedComponent(
	state: SchedulerState,
	limit: AccumulationLimit,
	allBodies: readonly ComponentBodyState[],
	connected: AccumulationConnectedComponent
): ExactTimeComponent | null {
	const bodies = allBodies.filter(({ id }) => connected.bodyIds.includes(id));
	const contacts = limit.activeLimitContacts
		.filter((contact) => connected.contactIds.includes(contact.id))
		.map((contact) => limitContact(state, limit, bodies, contact));
	if (bodies.length !== connected.bodyIds.length || contacts.some((contact) => contact === null))
		return null;
	return {
		id: `accumulation-impact:${limit.currentCertifiedTime}:${connected.id}`,
		time: limit.candidateLimitTime,
		bodies,
		contacts: contacts as ActiveComponentContact[],
		candidateEvidence: limit.geometricResiduals
			.filter(({ contactId }) => connected.contactIds.includes(contactId))
			.map((residual) => ({
				id: residual.contactId,
				type: residual.contactId.includes('body-contact') ? 'body-body' : 'body-fixed',
				separation: residual.separation,
				active: residual.activeAtLimit,
				reason: residual.activeAtLimit
					? 'Reconstructed as geometrically active at the certified limit.'
					: 'Rejected by complete limiting-geometry re-query.'
			}))
	};
}

function commitSourcePrefixes(
	state: SchedulerState,
	limit: AccumulationLimit,
	snapshots: readonly ComponentBodyState[],
	observation: AccumulationObservation
): void {
	for (const bodyId of limit.participantBodyIds) {
		const runtime = state.runtimes.get(bodyId)!;
		const snapshot = snapshots.find(({ id }) => id === bodyId)!;
		if (snapshot.prefixSegment && snapshot.prefixSegment.endTime > snapshot.prefixSegment.startTime)
			runtime.segments.push(snapshot.prefixSegment);
		runtime.committedTime = limit.currentCertifiedTime;
		runtime.state = {
			...runtime.state,
			time: limit.currentCertifiedTime,
			position: snapshot.position,
			velocity: snapshot.velocity
		};
		const fixedContact = observation.contacts.find(
			(contact) => contact.type === 'body-fixed' && contact.bodyId === bodyId
		);
		if (fixedContact?.type === 'body-fixed') {
			runtime.events.push({
				type: 'contact',
				time: observation.time,
				bodyId,
				colliderId: fixedContact.colliderId,
				position: snapshot.position,
				normal: fixedContact.normal,
				preContactVelocity: snapshot.velocity,
				postContactVelocity: snapshot.velocity
			});
		}
	}
}

function limitContact(
	state: SchedulerState,
	limit: AccumulationLimit,
	bodies: readonly ComponentBodyState[],
	contact: AccumulationLimit['activeLimitContacts'][number]
): ActiveComponentContact | null {
	const id = `${contact.id}:${limit.currentCertifiedTime}`;
	if (contact.type === 'body-body') {
		return {
			type: 'body-body',
			id,
			firstBodyId: contact.firstBodyId,
			secondBodyId: contact.secondBodyId,
			normalFromFirstToSecond: contact.normalFromFirstToSecond,
			contactPoint: contact.contactPoint,
			selection: null
		};
	}
	const body = bodies.find(({ id: bodyId }) => bodyId === contact.bodyId);
	if (!body) return null;
	const normalVelocity = dot(body.velocity, contact.normal);
	return {
		type: 'body-fixed',
		id,
		bodyId: contact.bodyId,
		colliderId: contact.colliderId,
		normal: contact.normal,
		contactPoint: contact.contactPoint,
		candidate: {
			type: 'contact-candidate',
			bodyId: contact.bodyId,
			colliderId: contact.colliderId,
			colliderKind:
				state.input.scene.staticColliders.find(
					({ id: colliderId }) => colliderId === contact.colliderId
				)?.physicalShape.type === 'circle'
					? 'circle'
					: 'boundary',
			feature: contact.feature as never,
			time: limit.candidateLimitTime,
			position: body.position,
			contactPoint: contact.contactPoint,
			normal: contact.normal,
			normalVelocity,
			response:
				normalVelocity < -state.input.settings.tolerances.eventTime
					? 'impact'
					: 'non-impulsive-contact'
		}
	};
}

function recordPromotedModeTransitions(
	state: SchedulerState,
	component: ExactTimeComponent,
	classification: AccumulationDiagnostic['finalClassification']
): void {
	if (classification !== 'rest' && classification !== 'release') return;
	for (const body of component.bodies) {
		const fixedContacts = component.contacts.filter(
			(contact): contact is Extract<ActiveComponentContact, { readonly type: 'body-fixed' }> =>
				contact.type === 'body-fixed' && contact.bodyId === body.id
		);
		const representative = fixedContacts[0];
		if (!representative) continue;
		const contacts = fixedContacts.map((contact) => {
			const dynamic = state.dynamicContacts.find(({ id }) => id === contact.id)!;
			return {
				colliderId: contact.colliderId,
				feature: contact.candidate.feature,
				contactPoint: contact.contactPoint,
				normal: contact.normal,
				preImpactNormalVelocity: dynamic.preImpactNormalVelocity ?? 0,
				postImpactNormalVelocity: dynamic.postImpactNormalVelocity ?? 0,
				impulse: dynamic.impulse ?? 0
			};
		});
		state.runtimes.get(body.id)!.events.push({
			type: 'contact-mode-transition',
			time: component.time,
			bodyId: body.id,
			colliderId: representative.colliderId,
			from: 'impact',
			to: classification === 'rest' ? 'resting' : 'free-flight',
			reason: 'impact-collapse',
			position: body.position,
			normal: representative.normal,
			contacts
		});
	}
}

function dot(left: Vec2, right: Vec2): number {
	return left[0] * right[0] + left[1] * right[1];
}
