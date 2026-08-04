import type {
	DynamicContactRecord,
	MotionSegment,
	PairPredictionDiagnostic,
	RunTerminalReason,
	StationaryMotionSegment
} from '../../contracts';
import {
	findEarliestDynamicPairContact,
	type DynamicCirclePathParticipant,
	type DynamicPairContactDiagnostics,
	type DynamicPairContactQueryResult,
	type DynamicPairContactState,
	type PolynomialDynamicCirclePath
} from '../../collision';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';
import {
	predictionSegments,
	type LocalBodyPrediction,
	type LocalBodyRuntime
} from '../single-ball/local-events';
import type { SchedulerState } from './types';

export type PairSchedulerSelection =
	| {
			readonly type: 'contact';
			readonly time: number;
			readonly first: DynamicCirclePathParticipant;
			readonly second: DynamicCirclePathParticipant;
			readonly state: DynamicPairContactState;
			readonly diagnosticId: string;
	  }
	| {
			readonly type: 'failure';
			readonly reason: RunTerminalReason;
	  };

export function predictEarliestBodyPair(state: SchedulerState): PairSchedulerSelection | null {
	const participants = [...state.runtimes.values()]
		.map((runtime) => participantFor(state, runtime))
		.filter((participant): participant is DynamicCirclePathParticipant => participant !== null)
		.sort((left, right) => left.bodyId.localeCompare(right.bodyId));
	const contacts: Extract<PairSchedulerSelection, { type: 'contact' }>[] = [];
	for (let firstIndex = 0; firstIndex < participants.length; firstIndex += 1) {
		for (let secondIndex = firstIndex + 1; secondIndex < participants.length; secondIndex += 1) {
			const first = participants[firstIndex]!;
			const second = participants[secondIndex]!;
			const result = findEarliestDynamicPairContact({
				first,
				second,
				currentTime: state.worldTime,
				tolerances: {
					contactDistance: state.input.settings.tolerances.contactDistance,
					eventTime: state.input.settings.tolerances.eventTime,
					normalVelocity: state.input.settings.tolerances.contactDistance,
					polynomialResidual: 1e-12
				}
			});
			const diagnostic = toPairDiagnostic(result);
			recordDiagnostic(state, diagnostic);
			if (result.type === 'invalid-input' || result.type === 'unresolved') {
				return {
					type: 'failure',
					reason: {
						type: result.type === 'invalid-input' ? 'invalid-state' : 'unresolved-collision-search',
						time: state.worldTime,
						detail: `Body pair ${first.bodyId}/${second.bodyId}: ${result.reason}`
					}
				};
			}
			if (result.type === 'contact') {
				contacts.push({
					type: 'contact',
					time: result.state.time,
					first,
					second,
					state: result.state,
					diagnosticId: diagnostic.id
				});
			}
		}
	}
	const selected = contacts.sort(
		(left, right) => left.time - right.time || left.diagnosticId.localeCompare(right.diagnosticId)
	)[0];
	if (selected) selectDiagnostic(state, selected.diagnosticId);
	return selected ?? null;
}

export function commitBodyPairBoundary(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>
): RunTerminalReason {
	commitParticipantPrefix(state, selection.first, selection.time);
	commitParticipantPrefix(state, selection.second, selection.time);
	const contact = dynamicContact(selection);
	state.dynamicContacts.push(contact);
	const retainedBodyIds = [...state.predictions.keys()]
		.filter((bodyId) => bodyId !== selection.first.bodyId && bodyId !== selection.second.bodyId)
		.sort();
	for (const participant of [selection.first, selection.second]) {
		state.steps.push({
			worldTime: selection.time,
			bodyId: participant.bodyId,
			revision: participant.revision,
			eventType: 'body-contact',
			retainedBodyIds
		});
	}
	return {
		type: 'unsupported-body-body-response',
		time: selection.time,
		bodyIds: [selection.first.bodyId, selection.second.bodyId],
		contactId: contact.id,
		detail:
			'Continuous body-body contact was certified; isolated body-body response is not implemented.'
	};
}

function participantFor(
	state: SchedulerState,
	runtime: LocalBodyRuntime
): DynamicCirclePathParticipant | null {
	if (bodyIsAbsent(runtime)) return null;
	const prediction = state.predictions.get(runtime.body.id) ?? null;
	const path = polynomialPath(state, runtime, prediction);
	if (!path) return null;
	return {
		bodyId: runtime.body.id,
		revision: runtime.revision,
		radius: runtime.body.physicalShape.radius,
		path
	};
}

function polynomialPath(
	state: SchedulerState,
	runtime: LocalBodyRuntime,
	prediction: LocalBodyPrediction | null
): PolynomialDynamicCirclePath | null {
	const reason = runtime.terminalReason;
	if (reason?.type === 'resting-contact' || reason?.type === 'no-future-event') {
		const stationary: StationaryMotionSegment = {
			type: 'stationary',
			bodyId: runtime.body.id,
			startTime: reason.time ?? runtime.committedTime,
			endTime: state.input.settings.maximumSimulationTime,
			startPosition: reason.type === 'resting-contact' ? reason.position : runtime.state.position,
			startVelocity: [0, 0],
			reason: 'resting-contact',
			componentId: null
		};
		return stationary;
	}
	if (!prediction) return null;
	const path = predictionSegments(runtime, prediction).find(
		(segment) => segment.startTime <= state.worldTime && segment.endTime >= state.worldTime
	);
	return path && path.type !== 'circular-contact'
		? { ...path, endTime: Math.min(path.endTime, prediction.time) }
		: null;
}

function bodyIsAbsent(runtime: LocalBodyRuntime): boolean {
	return Boolean(
		runtime.terminalReason &&
		['completion-region', 'escape-region', 'bounds-escape', 'invalid-state'].includes(
			runtime.terminalReason.type
		)
	);
}

function toPairDiagnostic(result: DynamicPairContactQueryResult): PairPredictionDiagnostic {
	const diagnostics = result.diagnostics;
	const predictedTime = result.type === 'contact' ? result.state.time : null;
	return {
		id: diagnosticId(diagnostics),
		bodyIds: diagnostics.bodyIds,
		predictedTime,
		validInterval: diagnostics.searchInterval,
		revisions: [
			{ bodyId: diagnostics.bodyIds[0], revision: diagnostics.revisions[0] },
			{ bodyId: diagnostics.bodyIds[1], revision: diagnostics.revisions[1] }
		],
		decision: result.type === 'contact' ? 'retained' : 'retained',
		reason:
			result.type === 'contact'
				? 'Certified contact is eligible for global event selection.'
				: result.type === 'no-contact'
					? 'No body contact exists in the shared certified interval.'
					: result.reason,
		queryOutcome: result.type,
		pathTypes: diagnostics.pathTypes,
		localEventHorizons: diagnostics.localEventHorizons,
		normalizedIntervalScale: diagnostics.normalizedIntervalScale,
		relativeCoefficients: diagnostics.relativeCoefficients,
		polynomialCoefficients: diagnostics.polynomialCoefficients,
		normalizedPolynomialCoefficients: diagnostics.normalizedPolynomialCoefficients,
		polynomialScale: diagnostics.polynomialScale,
		polynomialDegree: diagnostics.polynomialDegree,
		isolatedRoots: diagnostics.isolatedRoots,
		candidateWorldTimes: diagnostics.candidates.map(({ time }) => time),
		candidates: diagnostics.candidates.map((candidate) => ({
			normalizedTime: candidate.normalizedTime,
			time: candidate.time,
			topology: candidate.topology,
			classification: candidate.classification,
			geometryResidual: candidate.geometryResidual,
			relativeNormalMotion: candidate.relativeNormalMotion
		}))
	};
}

function diagnosticId(diagnostics: DynamicPairContactDiagnostics): string {
	return `pair:${diagnostics.bodyIds[0]}@${diagnostics.revisions[0]}:${diagnostics.bodyIds[1]}@${diagnostics.revisions[1]}:${diagnostics.searchInterval[0]}-${diagnostics.searchInterval[1]}`;
}

function recordDiagnostic(state: SchedulerState, diagnostic: PairPredictionDiagnostic): void {
	const existing = state.pairPredictions.findIndex(({ id }) => id === diagnostic.id);
	if (existing >= 0) state.pairPredictions[existing] = diagnostic;
	else state.pairPredictions.push(diagnostic);
}

function selectDiagnostic(state: SchedulerState, id: string): void {
	const index = state.pairPredictions.findIndex((diagnostic) => diagnostic.id === id);
	if (index < 0) return;
	state.pairPredictions[index] = {
		...state.pairPredictions[index]!,
		decision: 'selected',
		reason: 'This is the earliest certified dynamic pair boundary.'
	};
}

function commitParticipantPrefix(
	state: SchedulerState,
	participant: DynamicCirclePathParticipant,
	time: number
): void {
	const runtime = state.runtimes.get(participant.bodyId)!;
	if (runtime.terminalReason) return;
	if (time > participant.path.startTime) {
		const segment: MotionSegment = { ...participant.path, endTime: time };
		runtime.segments.push(segment);
	}
	runtime.committedTime = time;
	runtime.state = {
		...runtime.state,
		time,
		position: evaluateMotionSegmentPosition(participant.path, time),
		velocity: evaluateMotionSegmentVelocity(participant.path, time)
	};
}

function dynamicContact(
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>
): DynamicContactRecord {
	return {
		id: `body-contact:${selection.first.bodyId}:${selection.second.bodyId}:${selection.time}`,
		time: selection.time,
		participants: [
			{ type: 'body', bodyId: selection.first.bodyId },
			{ type: 'body', bodyId: selection.second.bodyId }
		],
		contactPoint: selection.state.contactPoint,
		normalFromFirstToSecond: selection.state.normalFromFirstToSecond,
		preImpactNormalVelocity: selection.state.relativeNormalMotion,
		postImpactNormalVelocity: null,
		impulse: null,
		state: 'incoming'
	};
}
