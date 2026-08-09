import { reportRunValidationFailure, type RunValidationContext } from '../results';
import { timeTolerance } from './temporal-continuity';

export function validateSchedulerHistory(context: RunValidationContext): void {
	validateReleaseChronology(context);
	validateLocalHorizons(context);
	validateSchedulerSteps(context);
	validatePredictionDecisions(context);
}

function validateReleaseChronology(context: RunValidationContext): void {
	let previousTime = Number.NEGATIVE_INFINITY;
	let previousBodyId = '';
	for (const [index, release] of context.run.releases.entries()) {
		if (
			release.time < previousTime ||
			(release.time === previousTime && release.bodyId.localeCompare(previousBodyId) < 0)
		) {
			fail(
				context,
				'NON_MONOTONIC_TIME',
				'Releases must use monotonic time and deterministic body-ID order within a batch.',
				`$.releases[${index}]`,
				release.time,
				release.bodyId
			);
		}
		previousTime = release.time;
		previousBodyId = release.bodyId;
	}
	const releasesByBody = new Map<string, number>();
	for (const release of context.run.releases) {
		releasesByBody.set(release.bodyId, (releasesByBody.get(release.bodyId) ?? 0) + 1);
	}
	for (const state of context.run.bodyStates) {
		const expected = state.lifecycle === 'scheduled' ? 0 : 1;
		if ((releasesByBody.get(state.bodyId) ?? 0) !== expected) {
			fail(
				context,
				'INVALID_RELEASE_TIME',
				'A body must have exactly one release record unless it remains scheduled.',
				'$.releases',
				undefined,
				state.bodyId
			);
		}
	}
}

function validateLocalHorizons(context: RunValidationContext): void {
	const lastRevision = new Map<string, number>();
	const releaseTimes = new Map(
		context.submittedInput.initialDynamicBodies.map(({ id, releaseTime }) => [id, releaseTime])
	);
	for (const [index, horizon] of context.run.diagnostics.bodyEventHorizons.entries()) {
		const path = `$.diagnostics.bodyEventHorizons[${index}]`;
		const prior = lastRevision.get(horizon.bodyId);
		if (
			horizon.interval[0] > horizon.interval[1] ||
			horizon.interval[0] < (releaseTimes.get(horizon.bodyId) ?? Number.POSITIVE_INFINITY) ||
			(prior !== undefined && horizon.revision.revision <= prior)
		) {
			fail(
				context,
				'NON_MONOTONIC_TIME',
				'Local horizons must advance monotonically through increasing body revisions.',
				path,
				horizon.interval[0],
				horizon.bodyId
			);
		}
		lastRevision.set(horizon.bodyId, horizon.revision.revision);
	}
}

function validateSchedulerSteps(context: RunValidationContext): void {
	const steps = context.run.diagnostics.schedulerSteps ?? [];
	const bodyIds = new Set(context.submittedInput.initialDynamicBodies.map(({ id }) => id));
	let previousTime = Number.NEGATIVE_INFINITY;
	for (const [index, step] of steps.entries()) {
		const path = `$.diagnostics.schedulerSteps[${index}]`;
		const horizon = context.run.diagnostics.bodyEventHorizons.find(
			(candidate) =>
				candidate.bodyId === step.bodyId &&
				candidate.revision.revision === step.revision &&
				candidate.eventType === step.eventType &&
				candidate.interval[1] === step.worldTime
		);
		const pair = context.run.diagnostics.pairPredictions.find(
			(candidate) =>
				candidate.decision === 'selected' &&
				candidate.predictedTime === step.worldTime &&
				candidate.revisions.some(
					(revision) => revision.bodyId === step.bodyId && revision.revision === step.revision
				)
		);
		const component = context.run.contactComponents.find(
			(candidate) =>
				Math.abs(candidate.createdAtTime - step.worldTime) <= timeTolerance(context) &&
				candidate.bodyIds.includes(step.bodyId)
		);
		if (
			!bodyIds.has(step.bodyId) ||
			step.retainedBodyIds.some((bodyId) => !bodyIds.has(bodyId) || bodyId === step.bodyId) ||
			new Set(step.retainedBodyIds).size !== step.retainedBodyIds.length
		) {
			fail(
				context,
				'UNRESOLVED_BODY_REFERENCE',
				'Scheduler step body and retained-prediction references must be unique and resolved.',
				path,
				step.worldTime,
				step.bodyId
			);
		}
		if (
			step.eventType !== 'release' &&
			(step.eventType === 'body-contact' ? !pair && !component : !horizon && !component)
		) {
			fail(
				context,
				'NON_MONOTONIC_TIME',
				'A selected local scheduler step must match its body revision horizon.',
				path,
				step.worldTime,
				step.bodyId
			);
		}
		if (step.worldTime < previousTime) {
			fail(
				context,
				'NON_MONOTONIC_TIME',
				'Committed scheduler steps must never move world time backwards.',
				`${path}.worldTime`,
				step.worldTime,
				step.bodyId
			);
		}
		previousTime = step.worldTime;
		for (const retainedBodyId of step.retainedBodyIds) {
			if (hasUnrelatedBoundary(context, retainedBodyId, step.worldTime)) {
				fail(
					context,
					'INVALID_INTERVAL',
					'An unrelated scheduler step must not split a retained body prediction.',
					path,
					step.worldTime,
					retainedBodyId
				);
			}
		}
	}
}

function validatePredictionDecisions(context: RunValidationContext): void {
	const tolerance = timeTolerance(context);
	for (const [index, horizon] of context.run.diagnostics.bodyEventHorizons.entries()) {
		if (horizon.decisionWorldTime === undefined) continue;
		if (
			horizon.decision === 'selected' &&
			Math.abs(horizon.interval[1] - horizon.decisionWorldTime) > tolerance
		)
			fail(
				context,
				'INVALID_INTERVAL',
				'A selected local future must end at its recorded decision time.',
				`$.diagnostics.bodyEventHorizons[${index}]`,
				horizon.decisionWorldTime,
				horizon.bodyId
			);
		if (horizon.decision !== 'invalidated') continue;
		const trajectory = context.run.trajectories.find(({ bodyId }) => bodyId === horizon.bodyId);
		if (
			trajectory?.segments.some(
				(segment) =>
					segment.startTime < horizon.decisionWorldTime! - tolerance &&
					segment.endTime > horizon.decisionWorldTime! + tolerance
			)
		)
			fail(
				context,
				'PREFIX_AFTER_TERMINAL',
				'A trajectory computed under an invalidated local future survives beyond the invalidating event.',
				`$.diagnostics.bodyEventHorizons[${index}]`,
				horizon.decisionWorldTime,
				horizon.bodyId
			);
	}

	const steps = context.run.diagnostics.schedulerSteps ?? [];
	for (const [index, prediction] of context.run.diagnostics.pairPredictions.entries()) {
		if (prediction.decision === 'selected' && prediction.decisionWorldTime !== undefined) {
			const authoritative =
				prediction.predictedTime !== null &&
				prediction.decisionWorldTime !== undefined &&
				Math.abs(prediction.predictedTime - prediction.decisionWorldTime) <= tolerance &&
				prediction.revisions.every((revision) =>
					steps.some(
						(step) =>
							step.eventType === 'body-contact' &&
							step.bodyId === revision.bodyId &&
							step.revision === revision.revision &&
							Math.abs(step.worldTime - prediction.decisionWorldTime!) <= tolerance
					)
				);
			if (!authoritative)
				fail(
					context,
					'INVALID_INTERVAL',
					'A selected pair prediction must match both current participant revisions at the authoritative event.',
					`$.diagnostics.pairPredictions[${index}]`,
					prediction.decisionWorldTime,
					prediction.bodyIds[0]
				);
		}
		for (const retainedTime of prediction.retainedThroughWorldTimes ?? []) {
			const retainedByStep = steps.some(
				(step) =>
					step.eventType === 'body-contact' &&
					Math.abs(step.worldTime - retainedTime) <= tolerance &&
					!prediction.bodyIds.includes(step.bodyId) &&
					prediction.bodyIds.every((bodyId) => step.retainedBodyIds.includes(bodyId))
			);
			const retainedByComponent = context.run.contactComponents.some(
				(component) =>
					Math.abs(component.createdAtTime - retainedTime) <= tolerance &&
					prediction.bodyIds.every((bodyId) => !component.bodyIds.includes(bodyId))
			);
			if (!retainedByStep && !retainedByComponent)
				fail(
					context,
					'INVALID_INTERVAL',
					'Retained pair evidence must identify an unrelated event that preserved both participant revisions.',
					`$.diagnostics.pairPredictions[${index}].retainedThroughWorldTimes`,
					retainedTime
				);
		}
	}
}

function hasUnrelatedBoundary(
	context: RunValidationContext,
	bodyId: string,
	time: number
): boolean {
	const trajectory = context.run.trajectories.find((candidate) => candidate.bodyId === bodyId);
	if (!trajectory) return false;
	const tolerance = timeTolerance(context);
	const boundary = trajectory.segments.some(
		(segment, index) =>
			index < trajectory.segments.length - 1 && Math.abs(segment.endTime - time) <= tolerance
	);
	const ownEvent =
		context.run.events.some(
			(event) => event.bodyId === bodyId && Math.abs(event.time - time) <= tolerance
		) ||
		context.run.dynamicContacts.some(
			(contact) =>
				Math.abs(contact.time - time) <= tolerance &&
				contact.participants.some(
					(participant) => participant.type === 'body' && participant.bodyId === bodyId
				)
		);
	return boundary && !ownEvent;
}

function fail(
	context: RunValidationContext,
	code:
		| 'INVALID_INTERVAL'
		| 'INVALID_RELEASE_TIME'
		| 'NON_MONOTONIC_TIME'
		| 'PREFIX_AFTER_TERMINAL'
		| 'UNRESOLVED_BODY_REFERENCE',
	message: string,
	path: string,
	time?: number,
	bodyId?: string
): void {
	reportRunValidationFailure(context, 'temporal-continuity', code, message, {
		path,
		...(time === undefined ? {} : { time }),
		...(bodyId === undefined ? {} : { bodyId })
	});
}
