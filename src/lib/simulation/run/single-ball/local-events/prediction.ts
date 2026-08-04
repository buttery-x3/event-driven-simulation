import type {
	FreeFlightMotionSegment,
	MotionSegment,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	Vec2
} from '../../../contracts';
import {
	defaultFixedWorldContactTolerances,
	findEarliestFixedWorldContact
} from '../../../collision';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../../motion';
import { toRunContactSearchDiagnostic } from '../diagnostics';
import {
	findContainingRegion,
	findEarliestTerminationEntry,
	terminationReason
} from '../termination-search';
import type { LocalBodyPrediction, LocalBodyRuntime } from './types';

export function createLocalBodyRuntime(
	input: LocalBodyRuntime['input'],
	body: LocalBodyRuntime['body']
): LocalBodyRuntime {
	return {
		input,
		body,
		revision: 0,
		committedTime: body.releaseTime,
		state: {
			time: body.releaseTime,
			position: body.position,
			velocity: body.velocity,
			releasedContactColliderId: null,
			releasedContactColliderIds: [],
			retainedSupportCandidates: [],
			pendingContactCandidates: [],
			acceptInitialContact: true
		},
		terminalReason: null,
		dormantComponentId: null,
		prepared: null,
		segments: [],
		events: [],
		contactSearches: [],
		entries: [],
		impactHistory: []
	};
}

export function predictLocalBodyEvent(runtime: LocalBodyRuntime): LocalBodyPrediction | null {
	if (runtime.terminalReason) return null;
	if (runtime.prepared) return predictPrepared(runtime);

	const { input, state } = runtime;
	if (contactCount(runtime) >= input.settings.maximumEvents) {
		return terminal(runtime, {
			type: 'event-limit',
			time: state.time,
			limit: input.settings.maximumEvents
		});
	}
	if (input.settings.maximumSimulationTime - state.time <= input.settings.tolerances.eventTime) {
		return terminal(runtime, {
			type: 'time-limit',
			time: state.time,
			limit: input.settings.maximumSimulationTime
		});
	}

	const pending = state.pendingContactCandidates[0];
	if (pending) {
		return {
			kind: 'contact',
			bodyId: runtime.body.id,
			revision: runtime.revision,
			time: state.time,
			eventType: 'fixed-contact',
			path: null,
			result: {
				type: 'contact',
				event: {
					type: 'contact',
					time: pending.time,
					bodyId: pending.bodyId,
					colliderId: pending.colliderId,
					position: pending.position,
					normal: pending.normal
				},
				candidate: pending,
				activeCandidates: state.pendingContactCandidates,
				diagnostics: {
					searchInterval: [state.time, state.time],
					eventTimeTolerance: input.settings.tolerances.eventTime,
					colliderEvaluations: [],
					orderedCandidates: state.pendingContactCandidates,
					nearSimultaneousCandidates: state.pendingContactCandidates,
					activeCandidates: state.pendingContactCandidates
				}
			},
			search: null
		};
	}

	const containingRegion = findContainingRegion(
		input.scene.terminationRegions,
		state.position,
		input.settings.tolerances.contactDistance
	);
	if (containingRegion) return terminal(runtime, terminationReason(containingRegion, state.time));

	const path = makeFreeFlightPath(runtime);
	const terminationSearch = findEarliestTerminationEntry(
		path,
		input.scene.terminationRegions,
		input.scene.bounds,
		input.settings.maximumSimulationTime,
		input.settings.tolerances.contactDistance,
		input.settings.tolerances.eventTime
	);
	if (terminationSearch.type === 'numerical-failure') {
		return terminal(runtime, {
			type: 'numerical-failure',
			time: state.time,
			detail: terminationSearch.detail
		});
	}

	const searchUntilTime =
		terminationSearch.type === 'entry'
			? terminationSearch.entry.time
			: input.settings.maximumSimulationTime;
	const contactResult = findEarliestFixedWorldContact({
		segment: path,
		ballRadius: runtime.body.physicalShape.radius,
		colliders: input.scene.staticColliders,
		releasedContactColliderId: state.releasedContactColliderId,
		releasedContactColliderIds: state.releasedContactColliderIds,
		toleranceContainedReleaseColliderIds: state.toleranceContainedReleaseColliderIds,
		searchUntilTime,
		tolerances: {
			...defaultFixedWorldContactTolerances,
			contactDistance: input.settings.tolerances.contactDistance,
			eventTime: input.settings.tolerances.eventTime
		}
	});
	const search = withBodyId(
		toRunContactSearchDiagnostic(contactResult, path, input.settings.restitution),
		runtime.body.id
	);
	if (contactResult.type === 'invalid-input' || contactResult.type === 'unresolved') {
		return terminal(
			runtime,
			{
				type:
					contactResult.type === 'invalid-input' ? 'invalid-state' : 'unresolved-collision-search',
				time: state.time,
				detail: contactResult.reason
			},
			null,
			search
		);
	}
	if (contactResult.type === 'contact') {
		return {
			kind: 'contact',
			bodyId: runtime.body.id,
			revision: runtime.revision,
			time: contactResult.event.time,
			eventType: 'fixed-contact',
			path,
			result: contactResult,
			search
		};
	}
	if (terminationSearch.type === 'entry') {
		return terminal(
			runtime,
			terminationSearch.entry.reason,
			{ ...path, endTime: terminationSearch.entry.time },
			search
		);
	}
	if (isPermanentlyStationary(state.velocity, input.settings.gravity)) {
		return terminal(
			runtime,
			{
				type: 'no-future-event',
				time: state.time,
				detail: 'The body is stationary with zero acceleration and no supported event is reachable.'
			},
			null,
			search
		);
	}
	return terminal(
		runtime,
		{
			type: 'time-limit',
			time: input.settings.maximumSimulationTime,
			limit: input.settings.maximumSimulationTime
		},
		path,
		search
	);
}

export function predictionSegments(
	runtime: LocalBodyRuntime,
	prediction: LocalBodyPrediction
): readonly MotionSegment[] {
	if (prediction.kind === 'prepared') return runtime.prepared?.segments ?? [];
	return prediction.path ? [prediction.path] : [];
}

function predictPrepared(runtime: LocalBodyRuntime): LocalBodyPrediction {
	const prepared = runtime.prepared!;
	const futureTimes = [
		...prepared.segments.map(({ endTime }) => endTime),
		...prepared.events.map(({ time }) => time),
		prepared.finalTime
	].filter((time) => time > runtime.committedTime);
	const time = Math.min(...futureTimes);
	const final = time === prepared.finalTime;
	const eventType = prepared.events.some((event) => event.time === time && event.type === 'contact')
		? 'fixed-contact'
		: final && prepared.terminalReason
			? terminalEventType(prepared.terminalReason)
			: 'motion-transition';
	return {
		kind: 'prepared',
		bodyId: runtime.body.id,
		revision: runtime.revision,
		time,
		eventType
	};
}

function terminal(
	runtime: LocalBodyRuntime,
	reason: RunTerminalReason,
	path: MotionSegment | null = null,
	search: RunContactSearchDiagnostic | null = null
): LocalBodyPrediction {
	return {
		kind: 'terminal',
		bodyId: runtime.body.id,
		revision: runtime.revision,
		time: reason.time ?? runtime.state.time,
		eventType: terminalEventType(reason),
		reason,
		path,
		search
	};
}

function terminalEventType(reason: RunTerminalReason): LocalBodyPrediction['eventType'] {
	return [
		'invalid-state',
		'unresolved-collision-search',
		'zero-time-loop',
		'numerical-failure'
	].includes(reason.type)
		? 'unresolved'
		: 'termination';
}

function makeFreeFlightPath(runtime: LocalBodyRuntime): FreeFlightMotionSegment {
	return {
		type: 'free-flight',
		bodyId: runtime.body.id,
		startTime: runtime.state.time,
		endTime: runtime.input.settings.maximumSimulationTime,
		startPosition: runtime.state.position,
		startVelocity: runtime.state.velocity,
		acceleration: runtime.input.settings.gravity
	};
}

function contactCount(runtime: LocalBodyRuntime): number {
	return runtime.events.filter(({ type }) => type === 'contact').length;
}

function isPermanentlyStationary(velocity: Vec2, acceleration: Vec2): boolean {
	return [...velocity, ...acceleration].every((value) => value === 0);
}

function withBodyId<T extends RunContactSearchDiagnostic>(
	search: T,
	bodyId: string
): T & { readonly bodyId: string } {
	return { ...search, bodyId };
}

export function hasFiniteEndState(segment: MotionSegment): boolean {
	return (
		evaluateMotionSegmentPosition(segment, segment.endTime).every(Number.isFinite) &&
		evaluateMotionSegmentVelocity(segment, segment.endTime).every(Number.isFinite)
	);
}
