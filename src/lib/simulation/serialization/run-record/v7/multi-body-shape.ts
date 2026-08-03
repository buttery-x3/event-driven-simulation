import { createUnknownDataAssertions, invalidRunRecordField } from '../../structural-validation';

const assertions = createUnknownDataAssertions(invalidRunRecordField);

export function validateMultiBodyHistoryShape(run: Record<string, unknown>): void {
	assertions.requireArray(run.bodyStates, '$.bodyStates').forEach((entry, index) => {
		const path = `$.bodyStates[${index}]`;
		const state = assertions.requireRecord(entry, path);
		assertions.requireString(state.bodyId, `${path}.bodyId`);
		assertions.requireOneOf(
			state.lifecycle,
			['scheduled', 'active', 'resting', 'completed', 'escaped', 'invalid', 'unresolved'],
			`${path}.lifecycle`
		);
		assertions.requireFiniteNumber(state.releaseTime, `${path}.releaseTime`);
		assertions.requireNullableFiniteNumber(state.activeFromTime, `${path}.activeFromTime`);
		assertions.requireNullableFiniteNumber(state.recordedUntilTime, `${path}.recordedUntilTime`);
		if (state.terminalOutcome !== null) {
			assertions.requireOneOf(
				state.terminalOutcome,
				['completed', 'escaped', 'invalid', 'unresolved'],
				`${path}.terminalOutcome`
			);
		}
	});
	assertions.requireArray(run.releases, '$.releases').forEach((entry, index) => {
		const path = `$.releases[${index}]`;
		const event = assertions.requireRecord(entry, path);
		assertions.requireLiteral(event.type, 'body-release', `${path}.type`);
		assertions.requireFiniteNumber(event.time, `${path}.time`);
		assertions.requireString(event.bodyId, `${path}.bodyId`);
		assertions.validateVec2(event.position, `${path}.position`);
		assertions.validateVec2(event.velocity, `${path}.velocity`);
		assertions.requireOneOf(event.status, ['released', 'rejected'], `${path}.status`);
		assertions.requireNullableString(event.reason, `${path}.reason`);
	});
	assertions.requireArray(run.dynamicContacts, '$.dynamicContacts').forEach((entry, index) => {
		const path = `$.dynamicContacts[${index}]`;
		const contact = assertions.requireRecord(entry, path);
		assertions.requireString(contact.id, `${path}.id`);
		assertions.requireFiniteNumber(contact.time, `${path}.time`);
		const participants = assertions.requireArray(contact.participants, `${path}.participants`);
		if (participants.length !== 2)
			invalidRunRecordField(`${path}.participants`, 'must contain two participants');
		participants.forEach((participant, participantIndex) =>
			validateParticipant(participant, `${path}.participants[${participantIndex}]`)
		);
		assertions.validateVec2(contact.contactPoint, `${path}.contactPoint`);
		assertions.validateVec2(contact.normalFromFirstToSecond, `${path}.normalFromFirstToSecond`);
		assertions.requireNullableFiniteNumber(
			contact.preImpactNormalVelocity,
			`${path}.preImpactNormalVelocity`
		);
		assertions.requireNullableFiniteNumber(
			contact.postImpactNormalVelocity,
			`${path}.postImpactNormalVelocity`
		);
		assertions.requireNullableFiniteNumber(contact.impulse, `${path}.impulse`);
		assertions.requireOneOf(
			contact.state,
			['incoming', 'retained', 'released', 'rejected'],
			`${path}.state`
		);
	});
	assertions
		.requireArray(run.contactComponents, '$.contactComponents')
		.forEach((entry, index) => validateComponent(entry, `$.contactComponents[${index}]`));
	assertions.requireArray(run.componentEvents, '$.componentEvents').forEach((entry, index) => {
		const path = `$.componentEvents[${index}]`;
		const event = assertions.requireRecord(entry, path);
		assertions.requireLiteral(event.type, 'contact-component-lifecycle', `${path}.type`);
		assertions.requireFiniteNumber(event.time, `${path}.time`);
		assertions.requireOneOf(
			event.change,
			['created', 'split', 'merged', 'dissolved'],
			`${path}.change`
		);
		for (const field of ['componentIds', 'resultingComponentIds'] as const) {
			assertions
				.requireArray(event[field], `${path}.${field}`)
				.forEach((id, idIndex) => assertions.requireString(id, `${path}.${field}[${idIndex}]`));
		}
	});
}

function validateParticipant(value: unknown, path: string): void {
	const participant = assertions.requireRecord(value, path);
	if (participant.type === 'body') assertions.requireString(participant.bodyId, `${path}.bodyId`);
	else if (participant.type === 'fixed-collider')
		assertions.requireString(participant.colliderId, `${path}.colliderId`);
	else invalidRunRecordField(`${path}.type`, 'must be "body" or "fixed-collider"');
}

function validateComponent(value: unknown, path: string): void {
	const component = assertions.requireRecord(value, path);
	assertions.requireString(component.id, `${path}.id`);
	assertions.requireOneOf(
		component.type,
		['exact-time-impact', 'resting-anchored'],
		`${path}.type`
	);
	assertions.requireFiniteNumber(component.createdAtTime, `${path}.createdAtTime`);
	assertions.requireNullableFiniteNumber(component.dissolvedAtTime, `${path}.dissolvedAtTime`);
	for (const field of ['bodyIds', 'fixedColliderIds', 'activeContactIds'] as const) {
		assertions
			.requireArray(component[field], `${path}.${field}`)
			.forEach((id, index) => assertions.requireString(id, `${path}.${field}[${index}]`));
	}
	assertions
		.requireArray(component.retainedSupportReactions, `${path}.retainedSupportReactions`)
		.forEach((entry, index) => {
			const reactionPath = `${path}.retainedSupportReactions[${index}]`;
			const reaction = assertions.requireRecord(entry, reactionPath);
			assertions.requireString(reaction.contactId, `${reactionPath}.contactId`);
			assertions.requireFiniteNumber(reaction.impulsePerTime, `${reactionPath}.impulsePerTime`);
		});
}
