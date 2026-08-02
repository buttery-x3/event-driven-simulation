import type {
	ContactEvent,
	DiagnosticEntry,
	FreeFlightMotionSegment,
	InitialDynamicCircleBodyState,
	MotionSegment,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	RunValidity,
	SimulationInput,
	SimulationRunRecord,
	Vec2
} from '../../contracts';
import {
	defaultFixedWorldContactTolerances,
	findEarliestFixedWorldContact,
	type FixedWorldContactCandidate
} from '../../collision';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';
import { getRunOutcome } from '../outcome';
import { bodyOrNull, toRunContactSearchDiagnostic, toTerminalDiagnostic } from './diagnostics';
import { resolveImpactResponse, type ImpactObservation } from './impact-response';
import { validateSingleBallInput } from './input-validation';
import {
	continueSustainedContact,
	type SustainedContactResult,
	type SustainedNextState
} from './sustained-contact';
import {
	findContainingRegion,
	findEarliestTerminationEntry,
	terminationReason
} from './termination-search';

interface EventState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly releasedContactColliderId: string | null;
	readonly acceptInitialContact: boolean;
}

interface RunAssembly {
	readonly wallTimeStart: number;
	readonly input: SimulationInput;
	readonly segments: MotionSegment[];
	readonly events: SimulationRunRecord['events'][number][];
	readonly entries: DiagnosticEntry[];
	readonly contactSearches: RunContactSearchDiagnostic[];
	readonly impactHistory: ImpactObservation[];
}

type ImpactResolution =
	| { readonly type: 'terminal'; readonly reason: RunTerminalReason; readonly time: number }
	| { readonly type: 'continue'; readonly nextState: EventState };

export function constructSingleBallRun(input: SimulationInput): SimulationRunRecord {
	const assembly: RunAssembly = {
		wallTimeStart: Date.now(),
		input,
		segments: [],
		events: [],
		entries: [],
		contactSearches: [],
		impactHistory: []
	};
	const finish = (validity: RunValidity, reason: RunTerminalReason, time: number) =>
		finishRun(assembly, validity, reason, time);
	const invalidDiagnostic = validateSingleBallInput(input)[0];

	if (invalidDiagnostic) {
		return finish(
			'invalid',
			{
				type: 'invalid-state',
				time: null,
				detail: `${invalidDiagnostic.path}: ${invalidDiagnostic.message}`
			},
			0
		);
	}

	const body = input.initialDynamicBodies[0]!;
	let state: EventState = {
		time: 0,
		position: body.position,
		velocity: body.velocity,
		releasedContactColliderId: null,
		acceptInitialContact: false
	};
	const initialTermination = findContainingRegion(
		input.scene.terminationRegions,
		state.position,
		input.settings.tolerances.contactDistance
	);
	if (initialTermination) {
		return finish('valid', terminationReason(initialTermination, state.time), state.time);
	}

	while (true) {
		if (contactEventCount(assembly) >= input.settings.maximumEvents) {
			return finish(
				'valid',
				{ type: 'event-limit', time: state.time, limit: input.settings.maximumEvents },
				state.time
			);
		}

		const remainingTime = input.settings.maximumSimulationTime - state.time;
		if (remainingTime <= input.settings.tolerances.eventTime) {
			return finish(
				'valid',
				{ type: 'time-limit', time: state.time, limit: input.settings.maximumSimulationTime },
				state.time
			);
		}

		const path = makeFreeFlightPath(input, body, state);
		const terminationSearch = findEarliestTerminationEntry(
			path,
			input.scene.terminationRegions,
			input.scene.bounds,
			input.settings.maximumSimulationTime,
			input.settings.tolerances.contactDistance,
			input.settings.tolerances.eventTime
		);
		if (terminationSearch.type === 'numerical-failure') {
			return finish(
				'valid',
				{ type: 'numerical-failure', time: state.time, detail: terminationSearch.detail },
				state.time
			);
		}

		const searchUntilTime =
			terminationSearch.type === 'entry'
				? terminationSearch.entry.time
				: input.settings.maximumSimulationTime;
		const contactResult = findFreeFlightContact(input, body, state, path, searchUntilTime);
		assembly.contactSearches.push(
			toRunContactSearchDiagnostic(contactResult, path, input.settings.restitution)
		);

		if (contactResult.type === 'invalid-input' || contactResult.type === 'unresolved') {
			return finish(
				contactResult.type === 'invalid-input' ? 'invalid' : 'valid',
				{
					type:
						contactResult.type === 'invalid-input'
							? 'invalid-state'
							: 'unresolved-collision-search',
					time: state.time,
					detail: contactResult.reason
				},
				state.time
			);
		}

		if (contactResult.type === 'contact') {
			const elapsed = contactResult.event.time - state.time;
			if (
				elapsed <= input.settings.tolerances.eventTime &&
				!state.acceptInitialContact &&
				!(state.time === 0 && contactResult.event.time === 0)
			) {
				return finish(
					'valid',
					{
						type: 'zero-time-loop',
						time: state.time,
						colliderId: contactResult.event.colliderId,
						detail:
							'The next selected contact did not establish a positive collision-free interval.'
					},
					state.time
				);
			}
			if (elapsed > input.settings.tolerances.eventTime) {
				const segment = { ...path, endTime: contactResult.event.time };
				if (!hasFiniteEndState(segment)) {
					return finish(
						'valid',
						{
							type: 'numerical-failure',
							time: state.time,
							detail: 'The selected contact state could not be evaluated as finite numbers.'
						},
						state.time
					);
				}
				assembly.segments.push(segment);
			}
			const resolution = resolveContact(
				input,
				body,
				path,
				contactResult.event,
				contactResult.candidate,
				assembly
			);
			if (resolution.type === 'terminal') {
				return finish('valid', resolution.reason, resolution.time);
			}
			state = resolution.nextState;
			continue;
		}

		if (terminationSearch.type === 'entry') {
			const terminalSegment = { ...path, endTime: terminationSearch.entry.time };
			if (!hasFiniteEndState(terminalSegment)) {
				return finish(
					'valid',
					{
						type: 'numerical-failure',
						time: state.time,
						detail: 'The termination-boundary state could not be evaluated as finite numbers.'
					},
					state.time
				);
			}
			assembly.segments.push(terminalSegment);
			return finish('valid', terminationSearch.entry.reason, terminationSearch.entry.time);
		}

		if (isPermanentlyStationary(state, input.settings.gravity)) {
			return finish(
				'valid',
				{
					type: 'no-future-event',
					time: state.time,
					detail:
						'The body is stationary with zero acceleration and no supported event is reachable.'
				},
				state.time
			);
		}

		if (!hasFiniteEndState(path)) {
			return finish(
				'valid',
				{
					type: 'numerical-failure',
					time: state.time,
					detail: 'The collision-free path did not have a finite state at the time boundary.'
				},
				state.time
			);
		}

		assembly.segments.push(path);
		return finish(
			'valid',
			{
				type: 'time-limit',
				time: input.settings.maximumSimulationTime,
				limit: input.settings.maximumSimulationTime
			},
			input.settings.maximumSimulationTime
		);
	}
}

function findFreeFlightContact(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	state: EventState,
	path: FreeFlightMotionSegment,
	searchUntilTime: number
) {
	return findEarliestFixedWorldContact({
		segment: path,
		ballRadius: body.physicalShape.radius,
		colliders: input.scene.staticColliders,
		releasedContactColliderId: state.releasedContactColliderId,
		searchUntilTime,
		tolerances: {
			...defaultFixedWorldContactTolerances,
			contactDistance: input.settings.tolerances.contactDistance,
			eventTime: input.settings.tolerances.eventTime
		}
	});
}

function resolveContact(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	path: FreeFlightMotionSegment,
	event: ContactEvent,
	candidate: FixedWorldContactCandidate,
	assembly: RunAssembly
): ImpactResolution {
	const incomingVelocity = evaluateMotionSegmentVelocity(path, event.time);
	const eventPosition = evaluateMotionSegmentPosition(path, event.time);
	if (!isFiniteVec2(incomingVelocity) || !isFiniteVec2(eventPosition)) {
		return {
			type: 'terminal',
			time: event.time,
			reason: {
				type: 'numerical-failure',
				time: event.time,
				detail: 'The selected contact state could not be evaluated as finite numbers.'
			}
		};
	}
	assembly.events.push(event);
	assembly.entries.push({
		severity: 'info',
		code: 'CONTACT_COMMITTED',
		message: `Committed contact with ${event.colliderId}.`,
		time: event.time,
		bodyId: body.id
	});
	if (candidate.response === 'non-impulsive-contact') {
		return continueFromSupportedOnset(input, body, event, incomingVelocity, assembly);
	}
	const response = resolveImpactResponse(
		input,
		event.colliderId,
		event.time,
		event.normal,
		incomingVelocity,
		assembly.impactHistory
	);
	assembly.impactHistory.push({
		colliderId: event.colliderId,
		time: event.time,
		incomingNormalSpeed: Math.max(
			0,
			-(incomingVelocity[0] * event.normal[0] + incomingVelocity[1] * event.normal[1])
		)
	});
	if (!response) {
		return {
			type: 'terminal',
			time: event.time,
			reason: {
				type: 'numerical-failure',
				time: event.time,
				detail: 'The restitution response did not produce a finite outgoing velocity.'
			}
		};
	}
	if (!response.enterSustainedContact) {
		return {
			type: 'continue',
			nextState: {
				time: event.time,
				position: event.position,
				velocity: response.outgoingVelocity,
				releasedContactColliderId: null,
				acceptInitialContact: false
			}
		};
	}

	const continuation = continueSustainedContact({
		input,
		body,
		colliderId: event.colliderId,
		time: event.time,
		position: event.position,
		normal: event.normal,
		outgoingVelocity: response.outgoingVelocity,
		entryFrom: response.collapseReason === 'initial-supported-state' ? 'free-flight' : 'impact',
		entryReason:
			response.collapseReason === 'initial-supported-state'
				? 'supported-initial-state'
				: 'impact-collapse'
	});
	appendSustainedContact(assembly, continuation);
	if (continuation.terminalReason) {
		return {
			type: 'terminal',
			time: continuation.terminalReason.time ?? event.time,
			reason: continuation.terminalReason
		};
	}
	return {
		type: 'continue',
		nextState: toEventState(continuation.nextState!)
	};
}

function continueFromSupportedOnset(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	event: ContactEvent,
	velocity: Vec2,
	assembly: RunAssembly
): ImpactResolution {
	const pressingAcceleration = -(
		input.settings.gravity[0] * event.normal[0] +
		input.settings.gravity[1] * event.normal[1]
	);
	if (pressingAcceleration <= 0) {
		return {
			type: 'continue',
			nextState: {
				time: event.time,
				position: event.position,
				velocity,
				releasedContactColliderId: event.colliderId,
				acceptInitialContact: false
			}
		};
	}
	const continuation = continueSustainedContact({
		input,
		body,
		colliderId: event.colliderId,
		time: event.time,
		position: event.position,
		normal: event.normal,
		outgoingVelocity: velocity,
		entryFrom: 'free-flight',
		entryReason: 'supported-initial-state'
	});
	appendSustainedContact(assembly, continuation);
	if (continuation.terminalReason) {
		return {
			type: 'terminal',
			time: continuation.terminalReason.time ?? event.time,
			reason: continuation.terminalReason
		};
	}
	return { type: 'continue', nextState: toEventState(continuation.nextState!) };
}

function appendSustainedContact(assembly: RunAssembly, continuation: SustainedContactResult): void {
	assembly.segments.push(...continuation.segments);
	assembly.events.push(...continuation.events);
	assembly.contactSearches.push(...continuation.contactSearches);
	for (const transition of continuation.events) {
		assembly.entries.push({
			severity: transition.reason === 'unresolved' ? 'error' : 'info',
			code: 'CONTACT_MODE_TRANSITION',
			message: `${transition.from} -> ${transition.to} on ${transition.colliderId}: ${transition.reason}.`,
			time: transition.time,
			bodyId: transition.bodyId
		});
	}
}

function finishRun(
	assembly: RunAssembly,
	validity: RunValidity,
	terminalReason: RunTerminalReason,
	simulatedUntilTime: number
): SimulationRunRecord {
	const outcome = getRunOutcome(terminalReason);
	assembly.entries.push(toTerminalDiagnostic(outcome, terminalReason, bodyOrNull(assembly.input)));
	const candidateCount = assembly.contactSearches.reduce(
		(total, search) => total + search.candidates.length,
		0
	);

	return {
		contractVersion: 6,
		input: assembly.input,
		validity,
		outcome,
		terminalReason,
		trajectories:
			assembly.input.initialDynamicBodies.length === 1
				? [{ bodyId: assembly.input.initialDynamicBodies[0]!.id, segments: assembly.segments }]
				: [],
		events: assembly.events,
		diagnostics: {
			iterations: assembly.contactSearches.length,
			simulatedUntilTime,
			eventCount: assembly.events.length,
			candidateCount,
			segmentCount: assembly.segments.length,
			simulationWallTimeMilliseconds: Math.max(0, Date.now() - assembly.wallTimeStart),
			contactSearches: assembly.contactSearches,
			entries: assembly.entries
		}
	};
}

function toEventState(state: SustainedNextState): EventState {
	return state;
}

function contactEventCount(assembly: RunAssembly): number {
	return assembly.events.filter((event) => event.type === 'contact').length;
}

function makeFreeFlightPath(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	state: EventState
): FreeFlightMotionSegment {
	return {
		type: 'free-flight',
		bodyId: body.id,
		startTime: state.time,
		endTime: input.settings.maximumSimulationTime,
		startPosition: state.position,
		startVelocity: state.velocity,
		acceleration: input.settings.gravity
	};
}

function hasFiniteEndState(segment: MotionSegment): boolean {
	return (
		isFiniteVec2(evaluateMotionSegmentPosition(segment, segment.endTime)) &&
		isFiniteVec2(evaluateMotionSegmentVelocity(segment, segment.endTime))
	);
}

function isPermanentlyStationary(state: EventState, acceleration: Vec2): boolean {
	return (
		state.velocity[0] === 0 &&
		state.velocity[1] === 0 &&
		acceleration[0] === 0 &&
		acceleration[1] === 0
	);
}

function isFiniteVec2(vector: Vec2): boolean {
	return vector.every(Number.isFinite);
}
