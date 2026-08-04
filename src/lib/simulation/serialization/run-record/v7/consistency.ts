import type { BodyRunState, ContactParticipant, SimulationRunRecord } from '../../../contracts';
import {
	getRunOutcome,
	getTerminalDiagnosticCode,
	isOutcomeConsistentWithValidity
} from '../../../run';
import { invalidRunRecordField } from '../../structural-validation';

export function validateRunConsistencyV7(record: SimulationRunRecord): void {
	if (record.outcome !== getRunOutcome(record.terminalReason)) {
		invalidRunRecordField('$.outcome', 'must agree with the world terminal reason');
	}
	if (!isOutcomeConsistentWithValidity(record.outcome, record.validity)) {
		invalidRunRecordField('$.validity', 'must agree with the world outcome');
	}
	validateCounts(record);
	validateBodyStates(record);
	validateTrajectories(record);
	validateReleases(record);
	validateContactsAndComponents(record);
	validatePredictions(record);
	validateTerminalReferences(record);
	const terminalEntry = record.diagnostics.entries.at(-1);
	if (!terminalEntry || terminalEntry.code !== getTerminalDiagnosticCode(record.outcome)) {
		invalidRunRecordField(
			'$.diagnostics.entries',
			`must end with ${getTerminalDiagnosticCode(record.outcome)}`
		);
	}
}

function validateCounts(record: SimulationRunRecord): void {
	if (record.diagnostics.eventCount !== record.events.length)
		invalidRunRecordField('$.diagnostics.eventCount', 'must equal the physical event count');
	if (record.diagnostics.iterations !== record.diagnostics.contactSearches.length)
		invalidRunRecordField('$.diagnostics.iterations', 'must equal the fixed-world search count');
	const candidates = record.diagnostics.contactSearches.reduce(
		(sum, search) => sum + search.candidates.length,
		0
	);
	if (record.diagnostics.candidateCount !== candidates)
		invalidRunRecordField(
			'$.diagnostics.candidateCount',
			'must equal the fixed-world candidate count'
		);
	const segments = record.trajectories.reduce(
		(sum, trajectory) => sum + trajectory.segments.length,
		0
	);
	if (record.diagnostics.segmentCount !== segments)
		invalidRunRecordField('$.diagnostics.segmentCount', 'must equal the trajectory segment count');
	if (
		record.terminalReason.time !== null &&
		record.terminalReason.time !== record.diagnostics.simulatedUntilTime
	)
		invalidRunRecordField('$.diagnostics.simulatedUntilTime', 'must equal the world terminal time');
}

function validateBodyStates(record: SimulationRunRecord): void {
	const inputById = new Map(record.input.initialDynamicBodies.map((body) => [body.id, body]));
	const seen = new Set<string>();
	for (const [index, state] of record.bodyStates.entries()) {
		const path = `$.bodyStates[${index}]`;
		const input = inputById.get(state.bodyId);
		if (!input) invalidRunRecordField(`${path}.bodyId`, 'must identify an input body');
		if (seen.has(state.bodyId)) invalidRunRecordField(`${path}.bodyId`, 'must be unique');
		seen.add(state.bodyId);
		if (state.releaseTime !== input.releaseTime)
			invalidRunRecordField(`${path}.releaseTime`, 'must equal the declared release time');
		validateLifecycleTimes(state, path, record.diagnostics.simulatedUntilTime);
	}
	if (seen.size !== inputById.size)
		invalidRunRecordField('$.bodyStates', 'must contain exactly one state for every input body');
	if (
		isCompleteWorldOutcome(record.outcome) &&
		record.bodyStates.some(
			(state) =>
				state.lifecycle === 'scheduled' ||
				(state.lifecycle === 'active' && record.outcome !== 'no-future-event') ||
				state.lifecycle === 'invalid' ||
				state.lifecycle === 'unresolved'
		)
	) {
		invalidRunRecordField(
			'$.bodyStates',
			'must contain no unfinished body when the world is complete'
		);
	}
}

function validateLifecycleTimes(state: BodyRunState, path: string, worldTime: number): void {
	if (state.lifecycle === 'scheduled') {
		if (
			state.releaseTime <= worldTime ||
			state.activeFromTime !== null ||
			state.recordedUntilTime !== null ||
			state.terminalOutcome !== null
		)
			invalidRunRecordField(path, 'has inconsistent scheduled lifecycle fields');
		return;
	}
	if (
		state.lifecycle === 'invalid' &&
		state.activeFromTime === null &&
		state.recordedUntilTime === null &&
		state.terminalOutcome === 'invalid'
	) {
		return;
	}
	if (state.activeFromTime !== state.releaseTime)
		invalidRunRecordField(`${path}.activeFromTime`, 'must equal release time after release');
	if (
		state.recordedUntilTime === null ||
		state.recordedUntilTime < state.releaseTime ||
		state.recordedUntilTime > worldTime
	)
		invalidRunRecordField(`${path}.recordedUntilTime`, 'must lie within the released world prefix');
	const terminalLifecycle = ['completed', 'escaped', 'invalid', 'unresolved'].includes(
		state.lifecycle
	);
	if (terminalLifecycle !== (state.terminalOutcome !== null))
		invalidRunRecordField(`${path}.terminalOutcome`, 'must exist exactly for a terminal lifecycle');
	if (state.terminalOutcome !== null && state.terminalOutcome !== state.lifecycle)
		invalidRunRecordField(`${path}.terminalOutcome`, 'must agree with the terminal lifecycle');
}

function validateTrajectories(record: SimulationRunRecord): void {
	const stateById = new Map(record.bodyStates.map((state) => [state.bodyId, state]));
	const seen = new Set<string>();
	for (const [trajectoryIndex, trajectory] of record.trajectories.entries()) {
		const path = `$.trajectories[${trajectoryIndex}]`;
		const state = stateById.get(trajectory.bodyId);
		if (!state) invalidRunRecordField(`${path}.bodyId`, 'must identify a body state');
		if (seen.has(trajectory.bodyId)) invalidRunRecordField(`${path}.bodyId`, 'must be unique');
		seen.add(trajectory.bodyId);
		let previousEnd: number | null = null;
		for (const [segmentIndex, segment] of trajectory.segments.entries()) {
			const segmentPath = `${path}.segments[${segmentIndex}]`;
			if (segment.bodyId !== trajectory.bodyId)
				invalidRunRecordField(`${segmentPath}.bodyId`, 'must equal the trajectory body ID');
			if (segment.endTime <= segment.startTime)
				invalidRunRecordField(segmentPath, 'must advance time');
			if (
				segment.startTime < state.releaseTime ||
				state.recordedUntilTime === null ||
				segment.endTime > state.recordedUntilTime
			)
				invalidRunRecordField(segmentPath, 'must remain inside the body active lifetime');
			if (previousEnd !== null && segment.startTime !== previousEnd)
				invalidRunRecordField(
					`${segmentPath}.startTime`,
					'must continue the preceding segment without a gap'
				);
			previousEnd = segment.endTime;
		}
		if (trajectory.segments.length > 0 && trajectory.segments[0]!.startTime !== state.releaseTime)
			invalidRunRecordField(`${path}.segments[0].startTime`, 'must begin at body release time');
		if (previousEnd !== null && previousEnd !== state.recordedUntilTime)
			invalidRunRecordField(`${path}.segments`, 'must cover through the body recorded-until time');
	}
}

function validateReleases(record: SimulationRunRecord): void {
	const inputById = new Map(record.input.initialDynamicBodies.map((body) => [body.id, body]));
	const seen = new Set<string>();
	for (const [index, release] of record.releases.entries()) {
		const path = `$.releases[${index}]`;
		const body = inputById.get(release.bodyId);
		if (!body) invalidRunRecordField(`${path}.bodyId`, 'must identify an input body');
		if (seen.has(release.bodyId)) invalidRunRecordField(`${path}.bodyId`, 'must be unique');
		seen.add(release.bodyId);
		if (
			release.time !== body.releaseTime ||
			release.position[0] !== body.position[0] ||
			release.position[1] !== body.position[1]
		)
			invalidRunRecordField(path, 'must agree with the declared release state');
	}
	for (const state of record.bodyStates) {
		if (state.lifecycle !== 'scheduled' && !seen.has(state.bodyId))
			invalidRunRecordField('$.releases', `must record release of ${JSON.stringify(state.bodyId)}`);
	}
}

function validateContactsAndComponents(record: SimulationRunRecord): void {
	const bodyIds = new Set(record.input.initialDynamicBodies.map(({ id }) => id));
	const colliderIds = new Set(record.input.scene.staticColliders.map(({ id }) => id));
	const contactById = uniqueMap(record.dynamicContacts, '$.dynamicContacts');
	for (const [index, contact] of record.dynamicContacts.entries()) {
		const path = `$.dynamicContacts[${index}]`;
		contact.participants.forEach((participant, participantIndex) =>
			validateParticipant(
				participant,
				`${path}.participants[${participantIndex}]`,
				bodyIds,
				colliderIds
			)
		);
		if (!contact.participants.some((participant) => participant.type === 'body'))
			invalidRunRecordField(`${path}.participants`, 'must include at least one dynamic body');
		if (contact.impulse !== null && contact.impulse < 0)
			invalidRunRecordField(`${path}.impulse`, 'must be non-negative');
	}
	const componentById = uniqueMap(record.contactComponents, '$.contactComponents');
	for (const [index, component] of record.contactComponents.entries()) {
		const path = `$.contactComponents[${index}]`;
		if (
			new Set(component.bodyIds).size !== component.bodyIds.length ||
			new Set(component.fixedColliderIds).size !== component.fixedColliderIds.length ||
			new Set(component.activeContactIds).size !== component.activeContactIds.length
		)
			invalidRunRecordField(path, 'must not duplicate component membership');
		if (
			(component.revision !== undefined &&
				(!Number.isInteger(component.revision) || component.revision < 0)) ||
			(component.futureScheduledEventTimes ?? []).some(
				(time, eventIndex, times) =>
					time < component.createdAtTime || (eventIndex > 0 && time < times[eventIndex - 1]!)
			)
		)
			invalidRunRecordField(path, 'contains invalid dormant runtime revision or future events');
		component.bodyIds.forEach((id) => {
			if (!bodyIds.has(id))
				invalidRunRecordField(`${path}.bodyIds`, 'contains an unresolved body reference');
		});
		component.fixedColliderIds.forEach((id) => {
			if (!colliderIds.has(id))
				invalidRunRecordField(
					`${path}.fixedColliderIds`,
					'contains an unresolved collider reference'
				);
		});
		component.activeContactIds.forEach((id) => {
			if (!contactById.has(id))
				invalidRunRecordField(
					`${path}.activeContactIds`,
					'contains an unresolved contact reference'
				);
		});
		component.retainedSupportReactions.forEach((reaction) => {
			if (!contactById.has(reaction.contactId) || reaction.impulsePerTime < 0)
				invalidRunRecordField(
					`${path}.retainedSupportReactions`,
					'contains invalid support evidence'
				);
		});
		if (component.type === 'dynamic-sustained-support') {
			const support = component.dynamicSupport;
			if (
				!support ||
				!component.bodyIds.includes(support.movingBodyId) ||
				!component.bodyIds.includes(support.supportBodyId) ||
				!support.anchoredBodyIds.includes(support.supportBodyId) ||
				support.anchoredBodyIds.some((bodyId) => !component.bodyIds.includes(bodyId)) ||
				!component.activeContactIds.includes(support.bodyBodyContactId)
			)
				invalidRunRecordField(
					`${path}.dynamicSupport`,
					'must identify the moving body, dynamic support and anchored contact membership'
				);
		} else if (component.dynamicSupport !== undefined) {
			invalidRunRecordField(
				`${path}.dynamicSupport`,
				'may appear only on a dynamic sustained-support component'
			);
		}
	}
	for (const [index, event] of record.componentEvents.entries()) {
		for (const id of [...event.componentIds, ...event.resultingComponentIds])
			if (!componentById.has(id))
				invalidRunRecordField(
					`$.componentEvents[${index}]`,
					'contains an unresolved component reference'
				);
		for (const bodyId of event.reactivatedBodyIds ?? [])
			if (!bodyIds.has(bodyId))
				invalidRunRecordField(
					`$.componentEvents[${index}].reactivatedBodyIds`,
					'contains an unresolved body reference'
				);
	}
}

function validatePredictions(record: SimulationRunRecord): void {
	const bodyIds = new Set(record.input.initialDynamicBodies.map(({ id }) => id));
	for (const [index, horizon] of record.diagnostics.bodyEventHorizons.entries()) {
		if (
			!bodyIds.has(horizon.bodyId) ||
			horizon.revision.bodyId !== horizon.bodyId ||
			horizon.revision.revision < 0 ||
			horizon.interval[0] > horizon.interval[1]
		)
			invalidRunRecordField(
				`$.diagnostics.bodyEventHorizons[${index}]`,
				'contains invalid body horizon evidence'
			);
	}
	for (const [index, prediction] of record.diagnostics.pairPredictions.entries()) {
		if (
			prediction.bodyIds[0] === prediction.bodyIds[1] ||
			prediction.bodyIds.some((id) => !bodyIds.has(id)) ||
			prediction.validInterval[0] > prediction.validInterval[1] ||
			prediction.revisions.some(
				(revision, revisionIndex) =>
					revision.bodyId !== prediction.bodyIds[revisionIndex] || revision.revision < 0
			)
		)
			invalidRunRecordField(
				`$.diagnostics.pairPredictions[${index}]`,
				'contains invalid pair prediction evidence'
			);
	}
}

function validateTerminalReferences(record: SimulationRunRecord): void {
	const reason = record.terminalReason;
	if (reason.type === 'unsupported-body-body-response') {
		const contact = record.dynamicContacts.find(({ id }) => id === reason.contactId);
		if (
			!contact ||
			reason.bodyIds.some(
				(bodyId) =>
					!contact.participants.some(
						(participant) => participant.type === 'body' && participant.bodyId === bodyId
					)
			)
		)
			invalidRunRecordField(
				'$.terminalReason.contactId',
				'must identify the terminal body-body contact'
			);
	}
	if (reason.type === 'completion-region' || reason.type === 'escape-region') {
		const purpose = reason.type === 'completion-region' ? 'complete' : 'escape';
		if (
			!record.input.scene.terminationRegions.some(
				(region) => region.id === reason.regionId && region.purpose === purpose
			)
		)
			invalidRunRecordField('$.terminalReason.regionId', `must identify a ${purpose} region`);
	}
	if (
		(reason.type === 'resting-contact' || reason.type === 'zero-time-loop') &&
		!record.input.scene.staticColliders.some(({ id }) => id === reason.colliderId)
	)
		invalidRunRecordField('$.terminalReason.colliderId', 'must identify a fixed collider');
}

function validateParticipant(
	participant: ContactParticipant,
	path: string,
	bodyIds: ReadonlySet<string>,
	colliderIds: ReadonlySet<string>
): void {
	if (
		participant.type === 'body'
			? !bodyIds.has(participant.bodyId)
			: !colliderIds.has(participant.colliderId)
	)
		invalidRunRecordField(path, 'contains an unresolved participant');
}

function uniqueMap<T extends { readonly id: string }>(
	items: readonly T[],
	path: string
): Map<string, T> {
	const result = new Map<string, T>();
	items.forEach((item, index) => {
		if (result.has(item.id)) invalidRunRecordField(`${path}[${index}].id`, 'must be unique');
		result.set(item.id, item);
	});
	return result;
}

function isCompleteWorldOutcome(outcome: SimulationRunRecord['outcome']): boolean {
	return (
		outcome === 'exited' ||
		outcome === 'escaped' ||
		outcome === 'settled' ||
		outcome === 'no-future-event'
	);
}
