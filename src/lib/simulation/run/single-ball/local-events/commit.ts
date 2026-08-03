import type { MotionSegment, RunTerminalReason, Vec2 } from '../../../contracts';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../../motion';
import { createRunAssembly } from '../run-assembly';
import {
	isContractingAlternatingImpactSequence,
	mergeContactCandidates,
	resolveContact
} from '../impact';
import { hasFiniteEndState, predictionSegments } from './prediction';
import type { LocalBodyPrediction, LocalBodyRuntime } from './types';

export function commitLocalBodyPrediction(
	runtime: LocalBodyRuntime,
	prediction: LocalBodyPrediction
): void {
	if (prediction.revision !== runtime.revision || prediction.bodyId !== runtime.body.id) {
		throw new Error(`Stale local prediction selected for ${prediction.bodyId}.`);
	}
	if (prediction.time < runtime.committedTime) {
		throw new Error(`Local prediction for ${prediction.bodyId} moves time backwards.`);
	}

	switch (prediction.kind) {
		case 'terminal':
			commitTerminal(runtime, prediction);
			break;
		case 'contact':
			commitContact(runtime, prediction);
			break;
		case 'prepared':
			commitPrepared(runtime, prediction.time);
			break;
	}
	runtime.revision += 1;
}

export function evaluatePredictedBodyPosition(
	runtime: LocalBodyRuntime,
	prediction: LocalBodyPrediction | null,
	time: number
): Vec2 | null {
	if (time < runtime.body.releaseTime) return null;
	if (bodyIsAbsentAfterTerminal(runtime, time)) return null;
	const segment = [
		...runtime.segments,
		...(prediction ? predictionSegments(runtime, prediction) : [])
	].find((candidate) => candidate.startTime <= time && candidate.endTime >= time);
	if (segment) return evaluateMotionSegmentPosition(segment, time);
	if (time === runtime.committedTime) return runtime.state.position;
	const reason = runtime.terminalReason;
	if (reason?.type === 'resting-contact') return reason.position;
	if (reason?.type === 'no-future-event') return runtime.state.position;
	return null;
}

function commitTerminal(
	runtime: LocalBodyRuntime,
	prediction: Extract<LocalBodyPrediction, { readonly kind: 'terminal' }>
): void {
	if (prediction.search) runtime.contactSearches.push(prediction.search);
	if (prediction.path) {
		if (!hasFiniteEndState(prediction.path)) {
			runtime.terminalReason = numericalFailure(runtime.committedTime);
			return;
		}
		if (prediction.path.endTime > prediction.path.startTime) runtime.segments.push(prediction.path);
	}
	runtime.committedTime = prediction.time;
	runtime.terminalReason = prediction.reason;
}

function commitContact(
	runtime: LocalBodyRuntime,
	prediction: Extract<LocalBodyPrediction, { readonly kind: 'contact' }>
): void {
	const elapsed = prediction.time - runtime.state.time;
	if (isUnresolvedZeroTimeContact(runtime, prediction)) {
		if (prediction.search) runtime.contactSearches.push(prediction.search);
		runtime.terminalReason = {
			type: 'zero-time-loop',
			time: runtime.state.time,
			colliderId: prediction.result.event.colliderId,
			detail: 'The next selected contact did not establish a positive collision-free interval.'
		};
		return;
	}
	if (prediction.path && elapsed > runtime.input.settings.tolerances.eventTime) {
		const segment = { ...prediction.path, endTime: prediction.time };
		if (!hasFiniteEndState(segment)) {
			runtime.terminalReason = numericalFailure(runtime.state.time);
			return;
		}
		runtime.segments.push(segment);
	}

	const scratch = createRunAssembly(runtime.input);
	scratch.impactHistory.push(...runtime.impactHistory);
	const seededSearch = prediction.search ?? runtime.contactSearches.at(-1) ?? null;
	if (seededSearch) scratch.contactSearches.push(seededSearch);
	const priorImpactCount = scratch.impactHistory.length;
	const resolution = resolveContact(
		runtime.input,
		runtime.body,
		prediction.path,
		prediction.result.event,
		mergeContactCandidates(
			runtime.state.retainedSupportCandidates,
			prediction.result.activeCandidates
		),
		scratch,
		prediction.path ? null : { position: runtime.state.position, velocity: runtime.state.velocity }
	);
	commitSeededSearch(runtime, prediction.search !== null, scratch.contactSearches[0]);
	runtime.impactHistory.push(...scratch.impactHistory.slice(priorImpactCount));

	const immediateEvents = scratch.events.filter(({ time }) => time <= prediction.time);
	const futureEvents = scratch.events.filter(({ time }) => time > prediction.time);
	const immediateEntries = scratch.entries.filter(
		(entry) => entry.time === null || entry.time <= prediction.time
	);
	const futureEntries = scratch.entries.filter(
		(entry) => entry.time !== null && entry.time > prediction.time
	);
	runtime.events.push(...immediateEvents);
	runtime.entries.push(...immediateEntries);
	runtime.committedTime = prediction.time;

	const futureSearches = scratch.contactSearches.slice(seededSearch ? 1 : 0);
	const finalTime = resolution.type === 'terminal' ? resolution.time : resolution.nextState.time;
	const hasFuture =
		finalTime > prediction.time ||
		scratch.segments.length > 0 ||
		futureEvents.length > 0 ||
		futureSearches.length > 0;
	if (hasFuture) {
		runtime.prepared = {
			segments: [...scratch.segments],
			events: futureEvents,
			contactSearches: futureSearches.map((search) => ({
				...search,
				bodyId: runtime.body.id
			})),
			entries: futureEntries,
			finalState: resolution.type === 'continue' ? resolution.nextState : null,
			terminalReason: resolution.type === 'terminal' ? resolution.reason : null,
			finalTime
		};
		return;
	}
	if (resolution.type === 'terminal') runtime.terminalReason = resolution.reason;
	else runtime.state = resolution.nextState;
}

function commitPrepared(runtime: LocalBodyRuntime, time: number): void {
	const prepared = runtime.prepared!;
	const committedSegments = prepared.segments.filter(({ endTime }) => endTime <= time);
	const committedEvents = prepared.events.filter((event) => event.time <= time);
	const committedSearches = prepared.contactSearches.filter(
		(search) => search.searchInterval[1] <= time
	);
	const committedEntries = prepared.entries.filter(
		(entry) => entry.time === null || entry.time <= time
	);
	runtime.segments.push(...committedSegments);
	runtime.events.push(...committedEvents);
	runtime.contactSearches.push(...committedSearches);
	runtime.entries.push(...committedEntries);
	removeCommitted(prepared.segments, committedSegments);
	removeCommitted(prepared.events, committedEvents);
	removeCommitted(prepared.contactSearches, committedSearches);
	removeCommitted(prepared.entries, committedEntries);
	runtime.committedTime = time;
	const boundarySegment = committedSegments.at(-1);
	if (boundarySegment) runtime.state = stateAtBoundary(runtime, boundarySegment, time);

	if (time !== prepared.finalTime) return;
	runtime.prepared = null;
	if (prepared.terminalReason) runtime.terminalReason = prepared.terminalReason;
	else if (prepared.finalState) runtime.state = prepared.finalState;
}

function stateAtBoundary(
	runtime: LocalBodyRuntime,
	segment: MotionSegment,
	time: number
): LocalBodyRuntime['state'] {
	return {
		...runtime.state,
		time,
		position: evaluateMotionSegmentPosition(segment, time),
		velocity: evaluateMotionSegmentVelocity(segment, time)
	};
}

function commitSeededSearch(
	runtime: LocalBodyRuntime,
	isNew: boolean,
	search: LocalBodyRuntime['contactSearches'][number] | undefined
): void {
	if (!search) return;
	const withBody = { ...search, bodyId: runtime.body.id };
	if (isNew) runtime.contactSearches.push(withBody);
	else if (runtime.contactSearches.length > 0) {
		runtime.contactSearches[runtime.contactSearches.length - 1] = withBody;
	}
}

function isUnresolvedZeroTimeContact(
	runtime: LocalBodyRuntime,
	prediction: Extract<LocalBodyPrediction, { readonly kind: 'contact' }>
): boolean {
	if (prediction.path === null) return false;
	const elapsed = prediction.time - runtime.state.time;
	return (
		elapsed <= runtime.input.settings.tolerances.eventTime &&
		!runtime.state.acceptInitialContact &&
		!(
			runtime.state.time === runtime.body.releaseTime &&
			prediction.time === runtime.body.releaseTime
		) &&
		!(
			elapsed > 0 &&
			isContractingAlternatingImpactSequence(
				prediction.time,
				prediction.result.activeCandidates,
				runtime.impactHistory
			)
		)
	);
}

function bodyIsAbsentAfterTerminal(runtime: LocalBodyRuntime, time: number): boolean {
	const reason = runtime.terminalReason;
	return Boolean(
		reason &&
		time > (reason.time ?? runtime.committedTime) &&
		['completion-region', 'escape-region', 'bounds-escape'].includes(reason.type)
	);
}

function numericalFailure(time: number): RunTerminalReason {
	return {
		type: 'numerical-failure',
		time,
		detail: 'The selected local-event state could not be evaluated as finite numbers.'
	};
}

function removeCommitted<T>(target: T[], committed: readonly T[]): void {
	for (const item of committed) {
		const index = target.indexOf(item);
		if (index >= 0) target.splice(index, 1);
	}
}
