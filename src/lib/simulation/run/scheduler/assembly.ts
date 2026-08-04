import type {
	BodyRunState,
	InitialDynamicCircleBodyState,
	MotionSegment,
	RunOutcome,
	RunTerminalReason,
	RunValidity,
	SimulationRunRecord,
	StationaryMotionSegment
} from '../../contracts';
import { getRunOutcome } from '../outcome';
import { toTerminalDiagnostic } from '../single-ball/diagnostics';
import type { LocalBodyRuntime } from '../single-ball/local-events';
import type { SchedulerState } from './types';

export function finishScheduledRun(
	state: SchedulerState,
	validity: RunValidity,
	reason: RunTerminalReason
): SimulationRunRecord {
	const outcome = getRunOutcome(reason);
	const bodyStates = [...state.input.initialDynamicBodies]
		.sort((left, right) => left.id.localeCompare(right.id))
		.map((body) => bodyState(state, body));
	const trajectories = [...state.runtimes.values()]
		.sort((left, right) => left.body.id.localeCompare(right.body.id))
		.map((runtime) => ({
			bodyId: runtime.body.id,
			segments: trajectorySegments(runtime, state.worldTime)
		}));
	const events = [...state.runtimes.values()]
		.flatMap(({ events: localEvents }) => localEvents)
		.sort(eventOrder);
	const contactSearches = [...state.runtimes.values()]
		.sort((left, right) => left.body.id.localeCompare(right.body.id))
		.flatMap(({ contactSearches: searches }) => searches);
	const entries = [...state.runtimes.values()].flatMap(({ entries: localEntries }) => localEntries);
	const terminalCode = `RUN_${outcome.replaceAll('-', '_').toUpperCase()}`;
	if (entries.at(-1)?.code !== terminalCode) {
		entries.push(
			toTerminalDiagnostic(
				outcome,
				reason,
				state.input.initialDynamicBodies.length === 1 ? state.input.initialDynamicBodies[0]! : null
			)
		);
	}
	const candidateCount = contactSearches.reduce(
		(total, search) => total + search.candidates.length,
		0
	);
	return {
		contractVersion: 7,
		input: state.input,
		validity,
		outcome,
		terminalReason: reason,
		bodyStates,
		trajectories,
		events,
		releases: [...state.releases].sort(
			(left, right) => left.time - right.time || left.bodyId.localeCompare(right.bodyId)
		),
		dynamicContacts: state.dynamicContacts,
		contactComponents: state.contactComponents,
		componentEvents: state.componentEvents,
		diagnostics: {
			iterations: contactSearches.length,
			simulatedUntilTime: state.worldTime,
			eventCount: events.length,
			candidateCount,
			segmentCount: trajectories.reduce(
				(total, trajectory) => total + trajectory.segments.length,
				0
			),
			simulationWallTimeMilliseconds: Math.max(0, Date.now() - state.wallTimeStart),
			contactSearches,
			bodyEventHorizons: state.horizons,
			pairPredictions: state.pairPredictions,
			impactSolves: state.impactSolves,
			dynamicSupports: state.dynamicSupportDiagnostics,
			schedulerSteps: state.steps,
			entries
		}
	};
}

export function aggregateWorldReason(state: SchedulerState): RunTerminalReason {
	const runtimes = [...state.runtimes.values()];
	if (state.input.initialDynamicBodies.length === 1) return runtimes[0]!.terminalReason!;
	const outcomes = runtimes.map((runtime) => getRunOutcome(runtime.terminalReason!));
	const nonTerminal = runtimes.filter(
		(runtime) =>
			!runtime.terminalReason ||
			!['completion-region', 'escape-region', 'bounds-escape'].includes(runtime.terminalReason.type)
	);
	const allDormant =
		nonTerminal.length > 0 && nonTerminal.every((runtime) => runtime.dormantComponentId !== null);
	const outcome: Extract<RunOutcome, 'exited' | 'escaped' | 'settled' | 'no-future-event'> =
		allDormant
			? 'settled'
			: outcomes.some((value) => value === 'no-future-event')
				? 'no-future-event'
				: outcomes.some((value) => value === 'exited')
					? 'exited'
					: 'escaped';
	return {
		type: 'world-complete',
		time: state.worldTime,
		outcome,
		detail: `All ${runtimes.length} scheduled bodies reached independent terminal or dormant states.`
	};
}

function bodyState(state: SchedulerState, body: InitialDynamicCircleBodyState): BodyRunState {
	if (state.rejectedBodyIds.has(body.id)) {
		return {
			bodyId: body.id,
			lifecycle: 'invalid',
			releaseTime: body.releaseTime,
			activeFromTime: null,
			recordedUntilTime: null,
			terminalOutcome: 'invalid'
		};
	}
	const runtime = state.runtimes.get(body.id);
	if (!runtime) {
		return {
			bodyId: body.id,
			lifecycle: 'scheduled',
			releaseTime: body.releaseTime,
			activeFromTime: null,
			recordedUntilTime: null,
			terminalOutcome: null
		};
	}
	if (runtime.dormantComponentId) {
		return releasedState(body, 'resting', state.worldTime, null);
	}
	if (
		state.dynamicContacts.some(
			(contact) =>
				(contact.state === 'incoming' ||
					contact.state === 'rejected' ||
					contact.state === 'retained') &&
				contact.time === state.worldTime &&
				contact.participants.some(
					(participant) => participant.type === 'body' && participant.bodyId === body.id
				)
		)
	) {
		return releasedState(body, 'unresolved', runtime.committedTime, 'unresolved');
	}
	const reason = runtime.terminalReason;
	if (!reason) {
		return releasedState(body, 'active', runtime.committedTime, null);
	}
	if (reason.type === 'completion-region') {
		return releasedState(body, 'completed', reason.time, 'completed');
	}
	if (reason.type === 'escape-region' || reason.type === 'bounds-escape') {
		return releasedState(body, 'escaped', reason.time, 'escaped');
	}
	if (reason.type === 'resting-contact') {
		return releasedState(body, 'resting', state.worldTime, null);
	}
	if (reason.type === 'no-future-event')
		return releasedState(body, 'active', state.worldTime, null);
	if (reason.type === 'invalid-state') {
		return releasedState(body, 'invalid', reason.time ?? runtime.committedTime, 'invalid');
	}
	return releasedState(body, 'unresolved', reason.time ?? runtime.committedTime, 'unresolved');
}

function releasedState(
	body: InitialDynamicCircleBodyState,
	lifecycle: BodyRunState['lifecycle'],
	recordedUntilTime: number,
	terminalOutcome: BodyRunState['terminalOutcome']
): BodyRunState {
	return {
		bodyId: body.id,
		lifecycle,
		releaseTime: body.releaseTime,
		activeFromTime: body.releaseTime,
		recordedUntilTime,
		terminalOutcome
	};
}

function trajectorySegments(
	runtime: LocalBodyRuntime,
	worldTime: number
): readonly MotionSegment[] {
	const segments = [...runtime.segments];
	const reason = runtime.terminalReason;
	if (runtime.dormantComponentId && worldTime > runtime.committedTime) {
		const startPosition =
			reason?.type === 'resting-contact' ? reason.position : runtime.state.position;
		const stationary: StationaryMotionSegment = {
			type: 'stationary',
			bodyId: runtime.body.id,
			startTime: runtime.committedTime,
			endTime: worldTime,
			startPosition,
			startVelocity: [0, 0],
			reason: 'dormant-component',
			componentId: runtime.dormantComponentId
		};
		segments.push(stationary);
		return segments;
	}
	if (
		reason &&
		(reason.type === 'resting-contact' || reason.type === 'no-future-event') &&
		worldTime > (reason.time ?? runtime.committedTime)
	) {
		const startTime = reason.time ?? runtime.committedTime;
		const startPosition =
			reason.type === 'resting-contact' ? reason.position : runtime.state.position;
		const stationary: StationaryMotionSegment = {
			type: 'stationary',
			bodyId: runtime.body.id,
			startTime,
			endTime: worldTime,
			startPosition,
			startVelocity: [0, 0],
			reason: 'resting-contact',
			componentId: null
		};
		segments.push(stationary);
	}
	return segments;
}

function eventOrder(
	left: SimulationRunRecord['events'][number],
	right: SimulationRunRecord['events'][number]
): number {
	return (
		left.time - right.time ||
		left.bodyId.localeCompare(right.bodyId) ||
		left.type.localeCompare(right.type) ||
		left.colliderId.localeCompare(right.colliderId)
	);
}
