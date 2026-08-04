import type {
	InitialDynamicCircleBodyState,
	RunTerminalReason,
	SimulationInput,
	SimulationRunRecord
} from '../../contracts';
import { getRunOutcome } from '../outcome';
import { toTerminalDiagnostic } from '../single-ball/diagnostics';
import { validateSimulationInput } from '../single-ball/input-validation';
import {
	commitLocalBodyPrediction,
	createLocalBodyRuntime,
	type LocalBodyPrediction,
	type LocalBodyRuntime
} from '../single-ball/local-events';
import { aggregateWorldReason, finishScheduledRun } from './assembly';
import { commitBodyPairEvent, invalidatePairDiagnostics, predictEarliestBodyPair } from './pairs';
import { refreshBodyPrediction, selectLocalPrediction } from './predictions';
import { releaseOverlapReasons } from './release';
import type { SchedulerState } from './types';

export function constructSimulationRun(input: SimulationInput): SimulationRunRecord {
	const state = createSchedulerState(input);
	const invalid = validateSimulationInput(input)[0];
	if (invalid) return invalidInputRun(state, invalid.path, invalid.message);

	while (true) {
		const nextPair = predictEarliestBodyPair(state);
		if (nextPair?.type === 'failure') {
			return finishScheduledRun(
				state,
				nextPair.reason.type === 'invalid-state' ? 'invalid' : 'valid',
				nextPair.reason
			);
		}
		const nextReleaseTime = state.scheduled[0]?.releaseTime ?? Number.POSITIVE_INFINITY;
		const nextLocalTime = Math.min(
			...[...state.predictions.values()].map(({ time }) => time),
			Number.POSITIVE_INFINITY
		);
		const nextPairTime = nextPair?.time ?? Number.POSITIVE_INFINITY;
		const nextTime = Math.min(
			nextReleaseTime,
			nextLocalTime,
			nextPairTime,
			input.settings.maximumSimulationTime
		);
		if (nextTime < state.worldTime) {
			return finishScheduledRun(state, 'valid', {
				type: 'numerical-failure',
				time: state.worldTime,
				detail: 'The global scheduler selected an event before committed world time.'
			});
		}
		state.worldTime = nextTime;

		if (
			nextTime === input.settings.maximumSimulationTime &&
			nextReleaseTime > nextTime &&
			nextLocalTime > nextTime &&
			nextPairTime > nextTime
		) {
			return finishScheduledRun(state, 'valid', timeLimit(input));
		}

		if (nextReleaseTime === nextTime) {
			const releaseFailure = commitReleaseBatch(state, nextTime);
			if (releaseFailure) return finishScheduledRun(state, 'invalid', releaseFailure);
			if (nextPairTime === nextTime) continue;
		}

		if (nextPair?.type === 'contact' && nextPair.time === nextTime) {
			const result = commitBodyPairEvent(state, nextPair);
			if (result.type === 'terminal') return finishScheduledRun(state, 'valid', result.reason);
			if (contactEventCount(state) >= input.settings.maximumEvents) {
				return finishScheduledRun(state, 'valid', {
					type: 'event-limit',
					time: state.worldTime,
					limit: input.settings.maximumEvents
				});
			}
			continue;
		}

		const selected = [...state.predictions.values()]
			.filter(({ time }) => time === nextTime)
			.sort((left, right) => left.bodyId.localeCompare(right.bodyId));
		if (selected.length > 0) {
			const failure = commitLocalBatch(state, selected);
			if (failure) {
				return finishScheduledRun(
					state,
					failure.type === 'invalid-state' ? 'invalid' : 'valid',
					failure
				);
			}
			if (contactEventCount(state) >= input.settings.maximumEvents) {
				return finishScheduledRun(state, 'valid', {
					type: 'event-limit',
					time: state.worldTime,
					limit: input.settings.maximumEvents
				});
			}
		}

		if (state.predictions.size === 0 && state.scheduled.length === 0) {
			return finishScheduledRun(state, 'valid', aggregateWorldReason(state));
		}
	}
}

function createSchedulerState(input: SimulationInput): SchedulerState {
	return {
		input,
		wallTimeStart: Date.now(),
		worldTime: 0,
		scheduled: [...input.initialDynamicBodies].sort(
			(left, right) => left.releaseTime - right.releaseTime || left.id.localeCompare(right.id)
		),
		runtimes: new Map(),
		predictions: new Map(),
		releases: [],
		horizons: [],
		steps: [],
		pairPredictions: [],
		dynamicContacts: [],
		rejectedBodyIds: new Set()
	};
}

function commitReleaseBatch(state: SchedulerState, time: number): RunTerminalReason | null {
	const batch = state.scheduled
		.filter(({ releaseTime }) => releaseTime === time)
		.sort((left, right) => left.id.localeCompare(right.id));
	state.scheduled.splice(0, batch.length);
	const overlaps = releaseOverlapReasons(state, batch);
	for (const body of batch) {
		const reason = overlaps.get(body.id) ?? null;
		state.releases.push({
			type: 'body-release',
			time,
			bodyId: body.id,
			position: body.position,
			velocity: body.velocity,
			status: reason ? 'rejected' : 'released',
			reason
		});
		state.steps.push({
			worldTime: time,
			bodyId: body.id,
			revision: 0,
			eventType: 'release',
			retainedBodyIds: [...state.predictions.keys()].sort()
		});
		if (reason) state.rejectedBodyIds.add(body.id);
		else activateBody(state, body);
	}
	if (overlaps.size === 0) return null;
	return {
		type: 'invalid-state',
		time,
		detail: [...overlaps.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([bodyId, reason]) => `${bodyId}: ${reason}`)
			.join(' ')
	};
}

function activateBody(state: SchedulerState, body: InitialDynamicCircleBodyState): void {
	const runtime = createLocalBodyRuntime(state.input, body);
	state.runtimes.set(body.id, runtime);
	refreshBodyPrediction(state, runtime);
}

function commitLocalBatch(
	state: SchedulerState,
	selected: readonly LocalBodyPrediction[]
): RunTerminalReason | null {
	const selectedIds = new Set(selected.map(({ bodyId }) => bodyId));
	invalidatePairDiagnostics(
		state,
		selectedIds,
		`Invalidated because a participant local event was selected at time ${state.worldTime}.`
	);
	const retainedBodyIds = [...state.predictions.keys()]
		.filter((bodyId) => !selectedIds.has(bodyId))
		.sort();
	const failures: { readonly bodyId: string; readonly reason: RunTerminalReason }[] = [];
	for (const prediction of selected) {
		const runtime = state.runtimes.get(prediction.bodyId)!;
		selectLocalPrediction(state, prediction);
		state.steps.push({
			worldTime: state.worldTime,
			bodyId: prediction.bodyId,
			revision: prediction.revision,
			eventType: prediction.eventType,
			retainedBodyIds
		});
		commitLocalBodyPrediction(runtime, prediction);
		state.predictions.delete(prediction.bodyId);
		if (runtime.terminalReason) {
			recordBodyTerminal(runtime);
			if (worldMustFail(runtime.terminalReason)) {
				failures.push({ bodyId: prediction.bodyId, reason: runtime.terminalReason });
			}
		} else refreshBodyPrediction(state, runtime);
	}
	return failures.sort((left, right) => left.bodyId.localeCompare(right.bodyId))[0]?.reason ?? null;
}

function recordBodyTerminal(runtime: LocalBodyRuntime): void {
	const reason = runtime.terminalReason!;
	const code = `RUN_${getRunOutcome(reason).replaceAll('-', '_').toUpperCase()}`;
	if (runtime.entries.some((entry) => entry.code === code && entry.time === reason.time)) return;
	runtime.entries.push(toTerminalDiagnostic(getRunOutcome(reason), reason, runtime.body));
}

function worldMustFail(reason: RunTerminalReason): boolean {
	return [
		'invalid-state',
		'unresolved-collision-search',
		'unsupported-body-body-response',
		'zero-time-loop',
		'numerical-failure',
		'time-limit',
		'event-limit'
	].includes(reason.type);
}

function invalidInputRun(
	state: SchedulerState,
	path: string,
	message: string
): SimulationRunRecord {
	const reason: RunTerminalReason = {
		type: 'invalid-state',
		time: null,
		detail: `${path}: ${message}`
	};
	state.scheduled.splice(0);
	for (const body of state.input.initialDynamicBodies) {
		state.rejectedBodyIds.add(body.id);
		state.releases.push({
			type: 'body-release',
			time: Number.isFinite(body.releaseTime) ? body.releaseTime : 0,
			bodyId: body.id,
			position: body.position,
			velocity: body.velocity,
			status: 'rejected',
			reason: reason.detail
		});
	}
	return finishScheduledRun(state, 'invalid', reason);
}

function contactEventCount(state: SchedulerState): number {
	return (
		state.dynamicContacts.length +
		[...state.runtimes.values()].reduce(
			(total, runtime) => total + runtime.events.filter(({ type }) => type === 'contact').length,
			0
		)
	);
}

function timeLimit(input: SimulationInput): RunTerminalReason {
	return {
		type: 'time-limit',
		time: input.settings.maximumSimulationTime,
		limit: input.settings.maximumSimulationTime
	};
}
