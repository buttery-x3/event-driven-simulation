import type { ContactParticipant, SimulationInput, Vec2 } from '../../contracts';
import { evaluateBodyTrajectoryPosition } from '../../motion';
import {
	reportRunValidationFailure,
	type RunValidationContext,
	type RunValidationFailureCode
} from '../results';

export function validateMultiBodyContracts(context: RunValidationContext): void {
	const bodies = context.submittedInput.initialDynamicBodies;
	const bodyIds = new Set<string>();
	for (const [index, body] of bodies.entries()) {
		if (bodyIds.has(body.id))
			fail(
				context,
				'DUPLICATE_BODY_ID',
				`Body ID ${JSON.stringify(body.id)} is duplicated.`,
				`$.input.initialDynamicBodies[${index}].id`
			);
		bodyIds.add(body.id);
		if (!Number.isFinite(body.mass) || body.mass <= 0)
			fail(
				context,
				'INVALID_BODY_MASS',
				'Body mass must be positive and finite.',
				`$.input.initialDynamicBodies[${index}].mass`
			);
		if (!Number.isFinite(body.releaseTime) || body.releaseTime < 0)
			fail(
				context,
				'INVALID_RELEASE_TIME',
				'Body release time must be finite and non-negative.',
				`$.input.initialDynamicBodies[${index}].releaseTime`
			);
	}
	validateBodyStates(context, bodyIds);
	validateTrajectories(context, bodyIds);
	validateReleaseStates(context, bodyIds);
	validateContacts(context, bodyIds);
	validateComponents(context, bodyIds);
	validatePredictionEvidence(context, bodyIds);
}

function validateBodyStates(context: RunValidationContext, bodyIds: ReadonlySet<string>): void {
	const seen = new Set<string>();
	for (const [index, state] of context.run.bodyStates.entries()) {
		const path = `$.bodyStates[${index}]`;
		if (!bodyIds.has(state.bodyId))
			fail(
				context,
				'UNRESOLVED_BODY_REFERENCE',
				'Body state references an unknown body.',
				`${path}.bodyId`,
				state.bodyId
			);
		if (seen.has(state.bodyId))
			fail(
				context,
				'DUPLICATE_BODY_ID',
				'A body has more than one lifecycle state.',
				`${path}.bodyId`,
				state.bodyId
			);
		seen.add(state.bodyId);
		const terminal = ['completed', 'escaped', 'invalid', 'unresolved'].includes(state.lifecycle);
		if (
			terminal !== (state.terminalOutcome !== null) ||
			(state.terminalOutcome !== null && state.terminalOutcome !== state.lifecycle)
		)
			fail(
				context,
				'BODY_WORLD_OUTCOME_MISMATCH',
				'Body lifecycle and terminal outcome disagree.',
				path,
				state.bodyId
			);
	}
	if (
		isCompleteWorldOutcome(context.run.outcome) &&
		context.run.bodyStates.some((state) =>
			[
				'scheduled',
				...(context.run.outcome === 'no-future-event' ? [] : ['active']),
				'invalid',
				'unresolved'
			].includes(state.lifecycle)
		)
	)
		fail(
			context,
			'BODY_WORLD_OUTCOME_MISMATCH',
			'A completed world cannot contain unfinished or failed bodies.',
			'$.bodyStates'
		);
}

function validateTrajectories(context: RunValidationContext, bodyIds: ReadonlySet<string>): void {
	const states = new Map(context.run.bodyStates.map((state) => [state.bodyId, state]));
	for (const [trajectoryIndex, trajectory] of context.run.trajectories.entries()) {
		if (!bodyIds.has(trajectory.bodyId))
			fail(
				context,
				'UNRESOLVED_BODY_REFERENCE',
				'Trajectory references an unknown body.',
				`$.trajectories[${trajectoryIndex}].bodyId`,
				trajectory.bodyId
			);
		const state = states.get(trajectory.bodyId);
		for (const [segmentIndex, segment] of trajectory.segments.entries()) {
			const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`;
			if (
				!state ||
				segment.startTime < state.releaseTime ||
				state.recordedUntilTime === null ||
				segment.endTime > state.recordedUntilTime
			)
				fail(
					context,
					'TRAJECTORY_OUTSIDE_BODY_LIFETIME',
					'Trajectory data lies outside the body active lifetime.',
					path,
					trajectory.bodyId
				);
		}
		if (state?.lifecycle === 'resting' && state.recordedUntilTime !== null) {
			const final = trajectory.segments.at(-1);
			if (
				final &&
				final.endTime < context.run.diagnostics.simulatedUntilTime &&
				final.type !== 'stationary'
			)
				fail(
					context,
					'TRAJECTORY_OUTSIDE_BODY_LIFETIME',
					'A resting body requires explicit stationary coverage while the world continues.',
					`$.trajectories[${trajectoryIndex}].segments`,
					trajectory.bodyId
				);
		}
	}
}

function validateReleaseStates(context: RunValidationContext, bodyIds: ReadonlySet<string>): void {
	const byId = new Map(context.submittedInput.initialDynamicBodies.map((body) => [body.id, body]));
	for (const [index, release] of context.run.releases.entries()) {
		const body = byId.get(release.bodyId);
		if (!body) {
			fail(
				context,
				'UNRESOLVED_BODY_REFERENCE',
				'Release references an unknown body.',
				`$.releases[${index}].bodyId`,
				release.bodyId
			);
			continue;
		}
		if (release.time !== body.releaseTime)
			fail(
				context,
				'INVALID_RELEASE_TIME',
				'Release event time must equal the declared release time.',
				`$.releases[${index}].time`,
				body.id
			);
		if (![...body.position, ...body.velocity, release.time].every(Number.isFinite))
			fail(
				context,
				'NON_FINITE_MULTIBODY_DATA',
				'Release evidence must be finite.',
				`$.releases[${index}]`,
				body.id
			);
	}
	for (const [index, body] of context.submittedInput.initialDynamicBodies.entries()) {
		if (!Number.isFinite(body.releaseTime) || !Number.isFinite(body.mass)) continue;
		for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
			const other = context.submittedInput.initialDynamicBodies[otherIndex]!;
			const otherPosition = positionAtRelease(context, other.id, body.releaseTime, other, body);
			if (!otherPosition) continue;
			const distance = Math.hypot(
				body.position[0] - otherPosition[0],
				body.position[1] - otherPosition[1]
			);
			if (
				distance <
				body.physicalShape.radius +
					other.physicalShape.radius -
					context.submittedInput.settings.tolerances.contactDistance
			)
				fail(
					context,
					'OVERLAPPING_RELEASE_STATE',
					`Body ${JSON.stringify(body.id)} overlaps ${JSON.stringify(other.id)} at release.`,
					`$.input.initialDynamicBodies[${index}].position`,
					body.id
				);
		}
	}
	void bodyIds;
}

function positionAtRelease(
	context: RunValidationContext,
	otherId: string,
	time: number,
	other: SimulationInput['initialDynamicBodies'][number],
	body: SimulationInput['initialDynamicBodies'][number]
): Vec2 | null {
	if (other.releaseTime > time) return null;
	if (other.releaseTime === time) return other.position;
	const trajectory = context.run.trajectories.find(({ bodyId }) => bodyId === otherId);
	return trajectory ? evaluateBodyTrajectoryPosition(trajectory, body.releaseTime) : null;
}

function validateContacts(context: RunValidationContext, bodyIds: ReadonlySet<string>): void {
	const colliderIds = new Set(context.submittedInput.scene.staticColliders.map(({ id }) => id));
	const contactIds = new Set<string>();
	for (const [index, contact] of context.run.dynamicContacts.entries()) {
		const path = `$.dynamicContacts[${index}]`;
		if (contactIds.has(contact.id))
			fail(context, 'INVALID_CONTACT_PARTICIPANT', 'Contact IDs must be unique.', `${path}.id`);
		contactIds.add(contact.id);
		contact.participants.forEach((participant, participantIndex) =>
			validateParticipant(
				context,
				participant,
				bodyIds,
				colliderIds,
				`${path}.participants[${participantIndex}]`
			)
		);
		if (!contact.participants.some((participant) => participant.type === 'body'))
			fail(
				context,
				'INVALID_CONTACT_PARTICIPANT',
				'A dynamic contact must include a body.',
				`${path}.participants`
			);
		if (
			![
				contact.time,
				...contact.contactPoint,
				...contact.normalFromFirstToSecond,
				contact.impulse ?? 0
			].every(Number.isFinite)
		)
			fail(context, 'NON_FINITE_MULTIBODY_DATA', 'Dynamic contact evidence must be finite.', path);
	}
}

function validateParticipant(
	context: RunValidationContext,
	participant: ContactParticipant,
	bodyIds: ReadonlySet<string>,
	colliderIds: ReadonlySet<string>,
	path: string
): void {
	const valid =
		participant.type === 'body'
			? bodyIds.has(participant.bodyId)
			: colliderIds.has(participant.colliderId);
	if (!valid)
		fail(context, 'INVALID_CONTACT_PARTICIPANT', 'Contact participant does not resolve.', path);
}

function validateComponents(context: RunValidationContext, bodyIds: ReadonlySet<string>): void {
	const colliderIds = new Set(context.submittedInput.scene.staticColliders.map(({ id }) => id));
	const contactIds = new Set(context.run.dynamicContacts.map(({ id }) => id));
	const componentIds = new Set<string>();
	for (const [index, component] of context.run.contactComponents.entries()) {
		const path = `$.contactComponents[${index}]`;
		const duplicateMembership =
			new Set(component.bodyIds).size !== component.bodyIds.length ||
			new Set(component.fixedColliderIds).size !== component.fixedColliderIds.length ||
			new Set(component.activeContactIds).size !== component.activeContactIds.length;
		const invalidRuntimeEvidence =
			(component.revision !== undefined &&
				(!Number.isInteger(component.revision) || component.revision < 0)) ||
			(component.futureScheduledEventTimes ?? []).some(
				(time, eventIndex, times) =>
					time < component.createdAtTime || (eventIndex > 0 && time < times[eventIndex - 1]!)
			);
		if (
			componentIds.has(component.id) ||
			duplicateMembership ||
			invalidRuntimeEvidence ||
			component.bodyIds.some((id) => !bodyIds.has(id)) ||
			component.fixedColliderIds.some((id) => !colliderIds.has(id)) ||
			component.activeContactIds.some((id) => !contactIds.has(id))
		)
			fail(
				context,
				'MALFORMED_COMPONENT_MEMBERSHIP',
				'Contact component membership is duplicated or unresolved.',
				path
			);
		componentIds.add(component.id);
	}
	for (const [index, event] of context.run.componentEvents.entries()) {
		if ([...event.componentIds, ...event.resultingComponentIds].some((id) => !componentIds.has(id)))
			fail(
				context,
				'MALFORMED_COMPONENT_MEMBERSHIP',
				'Component lifecycle event references an unknown component.',
				`$.componentEvents[${index}]`
			);
		if ((event.reactivatedBodyIds ?? []).some((id) => !bodyIds.has(id)))
			fail(
				context,
				'UNRESOLVED_BODY_REFERENCE',
				'Reactivated component members must identify dynamic input bodies.',
				`$.componentEvents[${index}].reactivatedBodyIds`
			);
	}
}

function validatePredictionEvidence(
	context: RunValidationContext,
	bodyIds: ReadonlySet<string>
): void {
	for (const [index, prediction] of context.run.diagnostics.pairPredictions.entries()) {
		if (
			prediction.bodyIds[0] === prediction.bodyIds[1] ||
			prediction.bodyIds.some((id) => !bodyIds.has(id)) ||
			prediction.revisions.some(
				(revision, revisionIndex) => revision.bodyId !== prediction.bodyIds[revisionIndex]
			)
		)
			fail(
				context,
				'UNRESOLVED_BODY_REFERENCE',
				'Pair prediction body and revision references must resolve.',
				`$.diagnostics.pairPredictions[${index}]`
			);
	}
}

function isCompleteWorldOutcome(outcome: RunValidationContext['run']['outcome']): boolean {
	return ['exited', 'escaped', 'settled', 'no-future-event'].includes(outcome);
}

function fail(
	context: RunValidationContext,
	code: RunValidationFailureCode,
	message: string,
	path: string,
	bodyId?: string
): void {
	reportRunValidationFailure(context, 'multi-body-structure', code, message, {
		path,
		...(bodyId ? { bodyId } : {})
	});
}
