import type { EntityId, StationaryMotionSegment } from '../../../contracts';
import { evaluateMotionSegmentPosition } from '../../../motion';
import { predictionSegments, type LocalBodyRuntime } from '../../single-ball/local-events';
import { interruptDynamicSupports } from '../dynamic-support/interruption';
import { invalidateLocalPrediction } from '../predictions';
import { invalidatePairDiagnostics } from '../pairs/selection';
import type { SchedulerState } from '../types';
import { toFailureContinuationDiagnostic, failureContinuationEntries } from './diagnostics';
import { isFreezeAndContinue, isRecoverableFrontier } from './policy';
import type { FreezeRequest, FrozenBodyRecord, RecoveryResult } from './types';

export function recoverOrTerminate(
	state: SchedulerState,
	request: FreezeRequest,
	prefixesCommitted = false
): RecoveryResult {
	if (
		!isFreezeAndContinue(state.input) ||
		!isRecoverableFrontier(request.originalFailure, prefixesCommitted)
	) {
		return { type: 'terminal', reason: request.originalFailure };
	}
	if (alreadyFrozenAtTime(state, request)) {
		return {
			type: 'terminal',
			reason: {
				type: 'numerical-failure',
				time: request.freezeTime,
				detail:
					'Failure-continuation attempted to freeze the same component twice at one certified time.'
			}
		};
	}
	applyFreeze(state, request);
	return { type: 'continued' };
}

export function isFrozen(state: SchedulerState, bodyId: EntityId): boolean {
	return state.frozenBodies?.has(bodyId) === true;
}

export function skipFrozenPair(
	state: SchedulerState,
	firstBodyId: EntityId,
	secondBodyId: EntityId
): boolean {
	return Boolean(state.frozenBodies?.get(firstBodyId) && state.frozenBodies.get(secondBodyId));
}

export function unfreezeBodies(state: SchedulerState, bodyIds: readonly EntityId[]): void {
	for (const bodyId of bodyIds) state.frozenBodies.delete(bodyId);
}

export function frozenStationaryPath(
	state: SchedulerState,
	runtime: LocalBodyRuntime
): StationaryMotionSegment | null {
	const frozen = state.frozenBodies?.get(runtime.body.id);
	if (!frozen) return null;
	return {
		type: 'stationary',
		bodyId: runtime.body.id,
		startTime: frozen.freezeTime,
		endTime: state.input.settings.maximumSimulationTime,
		startPosition: frozen.position,
		startVelocity: [0, 0],
		reason: 'frozen-after-unresolved',
		componentId: null
	};
}

function applyFreeze(state: SchedulerState, request: FreezeRequest): void {
	interruptSupports(state, request);
	const frozen: FrozenBodyRecord[] = [];
	for (const bodyId of request.affectedBodyIds) {
		const runtime = state.runtimes.get(bodyId);
		if (!runtime) continue;
		const record = freezeBody(state, runtime, request.freezeTime);
		frozen.push(record);
		state.frozenBodies.set(bodyId, record);
		invalidateLocalPrediction(
			state,
			bodyId,
			`Invalidated by freeze-and-continue at time ${request.freezeTime}.`
		);
		runtime.prepared = null;
		runtime.revision += 1;
	}
	invalidatePairDiagnostics(
		state,
		new Set(request.affectedBodyIds),
		`Invalidated by freeze-and-continue at time ${request.freezeTime}.`
	);
	const diagnostic = toFailureContinuationDiagnostic(request, frozen);
	state.failureContinuations.push(diagnostic);
	if (state.physicalAuthority === 'certified') {
		state.physicalAuthority = { type: 'approximate-after', time: request.freezeTime };
	}
	for (const entry of failureContinuationEntries(diagnostic)) {
		const runtime = entry.bodyId ? state.runtimes.get(entry.bodyId) : undefined;
		if (runtime) runtime.entries.push(entry);
	}
}

function freezeBody(
	state: SchedulerState,
	runtime: LocalBodyRuntime,
	freezeTime: number
): FrozenBodyRecord {
	const velocityBeforeFreeze: FrozenBodyRecord['velocityBeforeFreeze'] = [
		runtime.state.velocity[0],
		runtime.state.velocity[1]
	];
	commitPrefixThrough(state, runtime, freezeTime);
	const position = runtime.state.position;
	runtime.committedTime = freezeTime;
	runtime.state = { ...runtime.state, time: freezeTime, position, velocity: [0, 0] };
	runtime.terminalReason = null;
	return {
		bodyId: runtime.body.id,
		freezeTime,
		position,
		velocityBeforeFreeze
	};
}

function commitPrefixThrough(
	state: SchedulerState,
	runtime: LocalBodyRuntime,
	freezeTime: number
): void {
	if (freezeTime <= runtime.committedTime) return;
	const frozenPath = frozenStationaryPath(state, runtime);
	const prediction = state.predictions.get(runtime.body.id);
	const candidates = frozenPath
		? [frozenPath]
		: prediction
			? predictionSegments(runtime, prediction)
			: [];
	const segment = candidates.find(
		(candidate) => candidate.startTime <= freezeTime && candidate.endTime >= runtime.committedTime
	);
	if (!segment) return;
	if (freezeTime > segment.startTime) {
		runtime.segments.push({ ...segment, endTime: freezeTime });
	}
	runtime.state = {
		...runtime.state,
		time: freezeTime,
		position: evaluateMotionSegmentPosition(segment, freezeTime),
		velocity: runtime.state.velocity
	};
}

function interruptSupports(state: SchedulerState, request: FreezeRequest): void {
	const bodies = request.affectedBodyIds
		.map((bodyId) => state.runtimes.get(bodyId))
		.filter((runtime): runtime is LocalBodyRuntime => Boolean(runtime))
		.map((runtime) => ({
			id: runtime.body.id,
			mass: runtime.body.mass,
			radius: runtime.body.physicalShape.radius,
			position: runtime.state.position,
			velocity: runtime.state.velocity
		}));
	if (bodies.length === 0) return;
	interruptDynamicSupports(state, {
		id: `freeze-component:${request.freezeTime}:${request.affectedBodyIds.slice().sort().join('+')}`,
		time: request.freezeTime,
		bodies,
		contacts: []
	});
}

function alreadyFrozenAtTime(state: SchedulerState, request: FreezeRequest): boolean {
	return request.affectedBodyIds.every((bodyId) => {
		const frozen = state.frozenBodies.get(bodyId);
		return frozen?.freezeTime === request.freezeTime;
	});
}
