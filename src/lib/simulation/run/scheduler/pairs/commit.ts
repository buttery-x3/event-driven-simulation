import type { DynamicContactRecord, MotionSegment, RunTerminalReason } from '../../../contracts';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../../motion';
import { resolveIsolatedBodyImpact } from '../../dynamic-impact';
import { invalidateLocalPrediction, refreshBodyPrediction } from '../predictions';
import type { SchedulerState } from '../types';
import {
	invalidatePairDiagnostics,
	retainUnrelatedPairDiagnostics,
	selectPairDiagnostics,
	type PairContactSelection,
	type PairSchedulerSelection
} from './selection';

export type PairCommitResult =
	| { readonly type: 'continued' }
	| { readonly type: 'terminal'; readonly reason: RunTerminalReason };

export function commitBodyPairEvent(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>
): PairCommitResult {
	const connectedContacts = exactTimeConnectedContacts(selection);
	const connectedBodyIds = bodyIdsFor(connectedContacts);
	const unsupportedReason = unsupportedIsolationReason(state, selection, connectedBodyIds);
	if (unsupportedReason) {
		commitUnsupportedBoundary(state, selection, connectedContacts, connectedBodyIds);
		return {
			type: 'terminal',
			reason: {
				type: 'unsupported-body-body-response',
				time: selection.time,
				bodyIds: [selection.first.bodyId, selection.second.bodyId],
				contactId: contactId(selection),
				detail: unsupportedReason
			}
		};
	}

	const firstRuntime = state.runtimes.get(selection.first.bodyId)!;
	const secondRuntime = state.runtimes.get(selection.second.bodyId)!;
	const response = resolveIsolatedBodyImpact({
		firstMass: firstRuntime.body.mass,
		secondMass: secondRuntime.body.mass,
		firstVelocity: selection.state.firstVelocity,
		secondVelocity: selection.state.secondVelocity,
		normalFromFirstToSecond: selection.state.normalFromFirstToSecond,
		restitution: state.input.settings.restitution,
		tolerance: state.input.settings.tolerances.contactDistance
	});
	if (response.type === 'rejected') {
		commitUnsupportedBoundary(state, selection, [selection], connectedBodyIds);
		return {
			type: 'terminal',
			reason: {
				type: 'numerical-failure',
				time: selection.time,
				detail: `Isolated body impact failed closed: ${response.reason}`
			}
		};
	}

	selectPairDiagnostics(
		state,
		new Set([selection.diagnosticId]),
		'This is the earliest valid isolated dynamic-body impact.'
	);
	commitParticipantPrefix(state, selection.first, selection.time);
	commitParticipantPrefix(state, selection.second, selection.time);
	state.dynamicContacts.push(dynamicContact(selection, response.response));
	recordSchedulerSteps(state, selection, connectedBodyIds);
	invalidateAffectedFutures(
		state,
		connectedBodyIds,
		`Invalidated by isolated body impact at time ${selection.time}.`
	);
	setPostImpactState(state, selection.first.bodyId, response.response.firstVelocity);
	setPostImpactState(state, selection.second.bodyId, response.response.secondVelocity);
	for (const bodyId of [...connectedBodyIds].sort()) {
		const runtime = state.runtimes.get(bodyId)!;
		runtime.revision += 1;
		refreshBodyPrediction(state, runtime);
	}
	return { type: 'continued' };
}

function unsupportedIsolationReason(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>,
	connectedBodyIds: ReadonlySet<string>
): string | null {
	if (selection.state.response !== 'impact')
		return 'The earliest dynamic contact is not a certified incoming isolated impact.';
	if (connectedBodyIds.size > 2)
		return 'The earliest impact is exact-time connected to an additional dynamic body; coupled response is unsupported.';
	for (const participant of [selection.first, selection.second]) {
		const runtime = state.runtimes.get(participant.bodyId)!;
		if (
			participant.path.type === 'linear-contact' ||
			runtime.terminalReason?.type === 'resting-contact' ||
			runtime.state.retainedSupportCandidates.length > 0 ||
			runtime.state.pendingContactCandidates.length > 0
		)
			return 'The earliest impact is connected to an existing active fixed-world contact; coupled response is unsupported.';
		const local = state.predictions.get(participant.bodyId);
		if (local?.time === selection.time)
			return 'The earliest impact is exact-time connected to a participant fixed-world event; coupled response is unsupported.';
	}
	return null;
}

function exactTimeConnectedContacts(
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>
): readonly PairContactSelection[] {
	const bodyIds = new Set([selection.first.bodyId, selection.second.bodyId]);
	const connected = new Set<string>([selection.diagnosticId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const contact of selection.simultaneousContacts) {
			if (connected.has(contact.diagnosticId)) continue;
			if (!bodyIds.has(contact.first.bodyId) && !bodyIds.has(contact.second.bodyId)) continue;
			connected.add(contact.diagnosticId);
			bodyIds.add(contact.first.bodyId);
			bodyIds.add(contact.second.bodyId);
			changed = true;
		}
	}
	return selection.simultaneousContacts.filter(({ diagnosticId }) => connected.has(diagnosticId));
}

function commitUnsupportedBoundary(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>,
	contacts: readonly PairContactSelection[],
	bodyIds: ReadonlySet<string>
): void {
	selectPairDiagnostics(
		state,
		new Set(contacts.map(({ diagnosticId }) => diagnosticId)),
		'This contact belongs to the earliest unsupported exact-time component.'
	);
	const participants = new Map(
		contacts
			.flatMap((contact) => [contact.first, contact.second])
			.map((item) => [item.bodyId, item])
	);
	for (const participant of [...participants.values()].sort((a, b) =>
		a.bodyId.localeCompare(b.bodyId)
	))
		commitParticipantPrefix(state, participant, selection.time);
	for (const contact of contacts) state.dynamicContacts.push(dynamicContact(contact));
	recordSchedulerSteps(state, selection, bodyIds);
	invalidateAffectedFutures(
		state,
		bodyIds,
		`Invalidated by unsupported exact-time contact at time ${selection.time}.`
	);
}

function invalidateAffectedFutures(
	state: SchedulerState,
	bodyIds: ReadonlySet<string>,
	reason: string
): void {
	retainUnrelatedPairDiagnostics(state, bodyIds, state.worldTime);
	for (const bodyId of bodyIds) {
		invalidateLocalPrediction(state, bodyId, reason);
		const runtime = state.runtimes.get(bodyId);
		if (runtime) runtime.prepared = null;
	}
	invalidatePairDiagnostics(state, bodyIds, reason);
}

function setPostImpactState(
	state: SchedulerState,
	bodyId: string,
	velocity: readonly [number, number]
): void {
	const runtime = state.runtimes.get(bodyId)!;
	runtime.prepared = null;
	runtime.terminalReason = null;
	runtime.impactHistory.splice(0);
	runtime.state = {
		...runtime.state,
		time: state.worldTime,
		velocity,
		releasedContactColliderId: null,
		releasedContactColliderIds: [],
		retainedSupportCandidates: [],
		pendingContactCandidates: [],
		acceptInitialContact: false,
		toleranceContainedReleaseColliderIds: []
	};
}

function recordSchedulerSteps(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>,
	changedBodyIds: ReadonlySet<string>
): void {
	const retainedBodyIds = [...state.predictions.keys()]
		.filter((bodyId) => !changedBodyIds.has(bodyId))
		.sort();
	for (const bodyId of [...changedBodyIds].sort()) {
		const runtime = state.runtimes.get(bodyId)!;
		state.steps.push({
			worldTime: selection.time,
			bodyId,
			revision: runtime.revision,
			eventType: 'body-contact',
			retainedBodyIds
		});
	}
}

function commitParticipantPrefix(
	state: SchedulerState,
	participant: PairContactSelection['first'],
	time: number
): void {
	const runtime = state.runtimes.get(participant.bodyId)!;
	if (runtime.terminalReason && runtime.terminalReason.type !== 'no-future-event') return;
	if (time > participant.path.startTime) {
		const segment: MotionSegment = { ...participant.path, endTime: time };
		runtime.segments.push(segment);
	}
	runtime.committedTime = time;
	runtime.state = {
		...runtime.state,
		time,
		position: evaluateMotionSegmentPosition(participant.path, time),
		velocity: evaluateMotionSegmentVelocity(participant.path, time)
	};
	if (runtime.terminalReason?.type === 'no-future-event') runtime.terminalReason = null;
}

function dynamicContact(
	selection: PairContactSelection,
	response?: {
		readonly impulseMagnitude: number;
		readonly postImpactNormalVelocity: number;
		readonly firstVelocity: readonly [number, number];
		readonly secondVelocity: readonly [number, number];
	}
): DynamicContactRecord {
	return {
		id: contactId(selection),
		time: selection.time,
		participants: [
			{ type: 'body', bodyId: selection.first.bodyId },
			{ type: 'body', bodyId: selection.second.bodyId }
		],
		contactPoint: selection.state.contactPoint,
		normalFromFirstToSecond: selection.state.normalFromFirstToSecond,
		preImpactNormalVelocity: selection.state.relativeNormalMotion,
		postImpactNormalVelocity: response?.postImpactNormalVelocity ?? null,
		impulse: response?.impulseMagnitude ?? null,
		preImpactVelocities: [selection.state.firstVelocity, selection.state.secondVelocity],
		...(response
			? {
					postImpactVelocities: [response.firstVelocity, response.secondVelocity] as const,
					impulseOnFirst: scaledVector(
						selection.state.normalFromFirstToSecond,
						-response.impulseMagnitude
					),
					impulseOnSecond: scaledVector(
						selection.state.normalFromFirstToSecond,
						response.impulseMagnitude
					)
				}
			: {}),
		state: response ? 'released' : 'incoming'
	};
}

function bodyIdsFor(contacts: readonly PairContactSelection[]): ReadonlySet<string> {
	return new Set(contacts.flatMap(({ first, second }) => [first.bodyId, second.bodyId]));
}

function contactId(selection: PairContactSelection): string {
	return `body-contact:${selection.first.bodyId}:${selection.second.bodyId}:${selection.time}`;
}

function scaledVector(vector: readonly [number, number], scale: number): readonly [number, number] {
	const x = scale * vector[0];
	const y = scale * vector[1];
	return [x === 0 ? 0 : x, y === 0 ? 0 : y];
}
