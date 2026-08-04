import type {
	PairPredictionDiagnostic,
	RunTerminalReason,
	StationaryMotionSegment
} from '../../../contracts';
import {
	findEarliestDynamicPairContact,
	type DynamicCirclePathParticipant,
	type DynamicPairContactDiagnostics,
	type DynamicPairContactQueryResult,
	type DynamicPairContactState
} from '../../../collision';
import {
	predictionSegments,
	type LocalBodyPrediction,
	type LocalBodyRuntime
} from '../../single-ball/local-events';
import { evaluateMotionSegmentPosition } from '../../../motion';
import type { SchedulerState } from '../types';
import { dynamicSupportPathForBody } from '../dynamic-support/prediction';

export interface PairContactSelection {
	readonly type: 'contact';
	readonly time: number;
	readonly first: DynamicCirclePathParticipant;
	readonly second: DynamicCirclePathParticipant;
	readonly state: DynamicPairContactState;
	readonly diagnosticId: string;
}

export type PairSchedulerSelection =
	| (PairContactSelection & { readonly simultaneousContacts: readonly PairContactSelection[] })
	| { readonly type: 'failure'; readonly reason: RunTerminalReason };

export function predictEarliestBodyPair(state: SchedulerState): PairSchedulerSelection | null {
	const participants = [...state.runtimes.values()]
		.map((runtime) => participantFor(state, runtime))
		.filter((participant): participant is DynamicCirclePathParticipant => participant !== null)
		.sort((left, right) => left.bodyId.localeCompare(right.bodyId));
	const contacts: PairContactSelection[] = [];
	for (let firstIndex = 0; firstIndex < participants.length; firstIndex += 1) {
		for (let secondIndex = firstIndex + 1; secondIndex < participants.length; secondIndex += 1) {
			const first = participants[firstIndex]!;
			const second = participants[secondIndex]!;
			if (isActiveSupportPair(state, first.bodyId, second.bodyId)) continue;
			if (skipReleasedPair(state, first, second)) continue;
			const result = queryPair(state, first, second);
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
	const selected = contacts
		.filter(
			(contact) =>
				contact.state.response === 'impact' ||
				(contact.state.response === 'non-impulsive-contact' &&
					isCertifiedAnchoredPair(state, contact.first.bodyId, contact.second.bodyId))
		)
		.sort(contactOrder)[0];
	if (!selected) return null;
	return {
		...selected,
		simultaneousContacts: contacts.filter(({ time }) => time === selected.time)
	};
}

function skipReleasedPair(
	state: SchedulerState,
	first: DynamicCirclePathParticipant,
	second: DynamicCirclePathParticipant
): boolean {
	const key = [first.bodyId, second.bodyId].sort().join('\u0000');
	if (!state.releasedDynamicPairs.has(key)) return false;
	const firstPosition = evaluateMotionSegmentPosition(first.path, state.worldTime);
	const secondPosition = evaluateMotionSegmentPosition(second.path, state.worldTime);
	const separation =
		Math.hypot(secondPosition[0] - firstPosition[0], secondPosition[1] - firstPosition[1]) -
		first.radius -
		second.radius;
	if (separation <= state.input.settings.tolerances.contactDistance) return true;
	state.releasedDynamicPairs.delete(key);
	return false;
}

function isCertifiedAnchoredPair(
	state: SchedulerState,
	firstBodyId: string,
	secondBodyId: string
): boolean {
	const anchored = (bodyId: string) =>
		state.contactComponents.some(
			(component) =>
				component.type === 'resting-anchored' &&
				component.dissolvedAtTime === null &&
				component.bodyIds.includes(bodyId)
		);
	return anchored(firstBodyId) !== anchored(secondBodyId);
}

function isActiveSupportPair(
	state: SchedulerState,
	firstBodyId: string,
	secondBodyId: string
): boolean {
	return [...state.dynamicSupports.values()].some(
		(support) =>
			(support.movingBodyId === firstBodyId && support.supportBodyId === secondBodyId) ||
			(support.movingBodyId === secondBodyId && support.supportBodyId === firstBodyId)
	);
}

export function selectPairDiagnostics(
	state: SchedulerState,
	diagnosticIds: ReadonlySet<string>,
	reason: string
): void {
	for (let index = 0; index < state.pairPredictions.length; index += 1) {
		const diagnostic = state.pairPredictions[index]!;
		if (!diagnosticIds.has(diagnostic.id)) continue;
		state.pairPredictions[index] = {
			...diagnostic,
			decision: 'selected',
			decisionWorldTime: state.worldTime,
			reason
		};
	}
}

export function invalidatePairDiagnostics(
	state: SchedulerState,
	bodyIds: ReadonlySet<string>,
	reason: string
): void {
	for (let index = 0; index < state.pairPredictions.length; index += 1) {
		const diagnostic = state.pairPredictions[index]!;
		if (
			diagnostic.decision !== 'retained' ||
			!diagnostic.bodyIds.some((bodyId) => bodyIds.has(bodyId))
		)
			continue;
		state.pairPredictions[index] = {
			...diagnostic,
			decision: 'invalidated',
			decisionWorldTime: state.worldTime,
			reason
		};
	}
}

export function retainUnrelatedPairDiagnostics(
	state: SchedulerState,
	changedBodyIds: ReadonlySet<string>,
	worldTime: number
): void {
	for (let index = 0; index < state.pairPredictions.length; index += 1) {
		const diagnostic = state.pairPredictions[index]!;
		if (
			diagnostic.decision !== 'retained' ||
			diagnostic.bodyIds.some((bodyId) => changedBodyIds.has(bodyId))
		)
			continue;
		const retainedThroughWorldTimes = [...(diagnostic.retainedThroughWorldTimes ?? []), worldTime];
		state.pairPredictions[index] = { ...diagnostic, retainedThroughWorldTimes };
	}
}

function queryPair(
	state: SchedulerState,
	first: DynamicCirclePathParticipant,
	second: DynamicCirclePathParticipant
): DynamicPairContactQueryResult {
	return findEarliestDynamicPairContact({
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
): DynamicCirclePathParticipant['path'] | null {
	const dynamicSupportPath = dynamicSupportPathForBody(state, runtime.body.id);
	if (dynamicSupportPath) return dynamicSupportPath;
	if (runtime.dormantComponentId) {
		const component = state.contactComponents.find(({ id }) => id === runtime.dormantComponentId);
		const stationary: StationaryMotionSegment = {
			type: 'stationary',
			bodyId: runtime.body.id,
			startTime: component?.createdAtTime ?? runtime.committedTime,
			endTime: state.input.settings.maximumSimulationTime,
			startPosition: runtime.state.position,
			startVelocity: [0, 0],
			reason: 'dormant-component',
			componentId: runtime.dormantComponentId
		};
		return stationary;
	}
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
	return path ? { ...path, endTime: Math.min(path.endTime, prediction.time) } : null;
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
	return {
		id: diagnosticId(diagnostics),
		bodyIds: diagnostics.bodyIds,
		predictedTime: result.type === 'contact' ? result.state.time : null,
		validInterval: diagnostics.searchInterval,
		revisions: [
			{ bodyId: diagnostics.bodyIds[0], revision: diagnostics.revisions[0] },
			{ bodyId: diagnostics.bodyIds[1], revision: diagnostics.revisions[1] }
		],
		decision: 'retained',
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
	if (existing >= 0) {
		const previous = state.pairPredictions[existing]!;
		state.pairPredictions[existing] = {
			...diagnostic,
			...(previous.retainedThroughWorldTimes
				? { retainedThroughWorldTimes: previous.retainedThroughWorldTimes }
				: {})
		};
	} else state.pairPredictions.push(diagnostic);
}

function contactOrder(left: PairContactSelection, right: PairContactSelection): number {
	return (
		left.time - right.time ||
		(left.state.response === right.state.response
			? left.diagnosticId.localeCompare(right.diagnosticId)
			: left.state.response === 'impact'
				? -1
				: 1)
	);
}
