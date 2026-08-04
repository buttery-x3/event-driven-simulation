import { reportRunValidationFailure, type RunValidationContext } from '../results';
import { timeTolerance } from './temporal-continuity';

export function validateSchedulerHistory(context: RunValidationContext): void {
	validateReleaseChronology(context);
	validateLocalHorizons(context);
	validateSchedulerSteps(context);
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
			(prior !== undefined && horizon.revision.revision !== prior + 1)
		) {
			fail(
				context,
				'NON_MONOTONIC_TIME',
				'Local horizons must advance monotonically through consecutive body revisions.',
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
		if (step.eventType !== 'release' && (step.eventType === 'body-contact' ? !pair : !horizon)) {
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
	const ownEvent = context.run.events.some(
		(event) => event.bodyId === bodyId && Math.abs(event.time - time) <= tolerance
	);
	return boundary && !ownEvent;
}

function fail(
	context: RunValidationContext,
	code:
		| 'INVALID_INTERVAL'
		| 'INVALID_RELEASE_TIME'
		| 'NON_MONOTONIC_TIME'
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
