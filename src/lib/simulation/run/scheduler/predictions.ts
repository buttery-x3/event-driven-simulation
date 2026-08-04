import type { LocalBodyPrediction, LocalBodyRuntime } from '../single-ball/local-events';
import { predictLocalBodyEvent } from '../single-ball/local-events';
import type { SchedulerState } from './types';

export function refreshBodyPrediction(state: SchedulerState, runtime: LocalBodyRuntime): void {
	const prediction = predictLocalBodyEvent(runtime);
	if (!prediction) return;
	state.predictions.set(runtime.body.id, prediction);
	state.horizons.push({
		bodyId: runtime.body.id,
		interval: [runtime.committedTime, prediction.time],
		revision: { bodyId: runtime.body.id, revision: prediction.revision },
		eventType: prediction.eventType,
		decision: 'retained',
		reason: 'Current local future for this body revision.'
	});
}

export function selectLocalPrediction(
	state: SchedulerState,
	prediction: LocalBodyPrediction
): void {
	updateHorizon(
		state,
		prediction.bodyId,
		prediction.revision,
		'selected',
		state.worldTime,
		'This local future supplied the selected world event.'
	);
}

export function invalidateLocalPrediction(
	state: SchedulerState,
	bodyId: string,
	reason: string
): void {
	const prediction = state.predictions.get(bodyId);
	if (!prediction) return;
	updateHorizon(state, bodyId, prediction.revision, 'invalidated', state.worldTime, reason);
	state.predictions.delete(bodyId);
}

function updateHorizon(
	state: SchedulerState,
	bodyId: string,
	revision: number,
	decision: 'selected' | 'invalidated',
	decisionWorldTime: number,
	reason: string
): void {
	for (let index = state.horizons.length - 1; index >= 0; index -= 1) {
		const horizon = state.horizons[index]!;
		if (horizon.bodyId !== bodyId || horizon.revision.revision !== revision) continue;
		state.horizons[index] = { ...horizon, decision, decisionWorldTime, reason };
		return;
	}
}
