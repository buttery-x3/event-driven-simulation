import type {
	DiagnosticEntry,
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
	type FixedWorldContactQueryResult
} from '../../collision';
import { dotVec2 } from '../../math';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';
import { getRunOutcome } from '../outcome';
import { bodyOrNull, toRunContactSearchDiagnostic, toTerminalDiagnostic } from './diagnostics';
import { validateSingleBallInput } from './input-validation';
import { classifySettlement } from './settlement';
import {
	findContainingRegion,
	findEarliestTerminationEntry,
	terminationReason
} from './termination-search';

interface EventState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
}

interface RunAssembly {
	readonly wallTimeStart: number;
	readonly input: SimulationInput;
	readonly segments: MotionSegment[];
	readonly events: SimulationRunRecord['events'][number][];
	readonly entries: DiagnosticEntry[];
	readonly contactSearches: RunContactSearchDiagnostic[];
}

type ContactResolution =
	| { readonly type: 'terminal'; readonly reason: RunTerminalReason; readonly time: number }
	| {
			readonly type: 'commit';
			readonly segment: MotionSegment;
			readonly event: SimulationRunRecord['events'][number];
			readonly entry: DiagnosticEntry;
			readonly terminalReason: RunTerminalReason | null;
			readonly nextState: EventState | null;
	  };

export function constructSingleBallRun(input: SimulationInput): SimulationRunRecord {
	const assembly: RunAssembly = {
		wallTimeStart: Date.now(),
		input,
		segments: [],
		events: [],
		entries: [],
		contactSearches: []
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
	let state: EventState = { time: 0, position: body.position, velocity: body.velocity };
	const initialTermination = findContainingRegion(
		input.scene.terminationRegions,
		state.position,
		input.settings.tolerances.contactDistance
	);
	if (initialTermination) {
		return finish('valid', terminationReason(initialTermination, state.time), state.time);
	}

	while (true) {
		if (assembly.events.length >= input.settings.maximumEvents) {
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

		const path: MotionSegment = {
			bodyId: body.id,
			startTime: state.time,
			endTime: input.settings.maximumSimulationTime,
			startPosition: state.position,
			startVelocity: state.velocity,
			acceleration: input.settings.gravity
		};
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
		const contactResult = findEarliestFixedWorldContact({
			segment: path,
			ballRadius: body.physicalShape.radius,
			colliders: input.scene.staticColliders,
			searchUntilTime,
			tolerances: {
				...defaultFixedWorldContactTolerances,
				contactDistance: input.settings.tolerances.contactDistance,
				eventTime: input.settings.tolerances.eventTime
			}
		});
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
			const resolution = resolveContact(input, body, path, state, contactResult);
			if (resolution.type === 'terminal') {
				return finish('valid', resolution.reason, resolution.time);
			}

			assembly.segments.push(resolution.segment);
			assembly.events.push(resolution.event);
			assembly.entries.push(resolution.entry);
			if (resolution.terminalReason) {
				return finish('valid', resolution.terminalReason, resolution.event.time);
			}
			state = resolution.nextState!;
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

function resolveContact(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	path: MotionSegment,
	state: EventState,
	contactResult: Extract<FixedWorldContactQueryResult, { type: 'contact' }>
): ContactResolution {
	const elapsed = contactResult.event.time - state.time;
	if (elapsed <= input.settings.tolerances.eventTime) {
		return {
			type: 'terminal',
			time: state.time,
			reason: {
				type: 'zero-time-loop',
				time: state.time,
				colliderId: contactResult.event.colliderId,
				detail: 'The next selected contact did not establish a positive collision-free interval.'
			}
		};
	}

	const segment = { ...path, endTime: contactResult.event.time };
	const incomingVelocity = evaluateMotionSegmentVelocity(segment, contactResult.event.time);
	const eventPosition = evaluateMotionSegmentPosition(segment, contactResult.event.time);
	if (!isFiniteVec2(incomingVelocity) || !isFiniteVec2(eventPosition)) {
		return {
			type: 'terminal',
			time: state.time,
			reason: {
				type: 'numerical-failure',
				time: state.time,
				detail: 'The selected contact state could not be evaluated as finite numbers.'
			}
		};
	}

	const normalVelocity = dotVec2(incomingVelocity, contactResult.event.normal);
	const responseScale = (1 + input.settings.restitution) * normalVelocity;
	const outgoingVelocity: Vec2 = [
		incomingVelocity[0] - responseScale * contactResult.event.normal[0],
		incomingVelocity[1] - responseScale * contactResult.event.normal[1]
	];
	const entry: DiagnosticEntry = {
		severity: 'info',
		code: 'CONTACT_COMMITTED',
		message: `Committed contact with ${contactResult.event.colliderId}.`,
		time: contactResult.event.time,
		bodyId: body.id
	};
	if (!Number.isFinite(responseScale) || !isFiniteVec2(outgoingVelocity)) {
		return {
			type: 'commit',
			segment,
			event: contactResult.event,
			entry,
			terminalReason: {
				type: 'numerical-failure',
				time: contactResult.event.time,
				detail: 'The restitution response did not produce a finite outgoing velocity.'
			},
			nextState: null
		};
	}

	const terminalReason = classifySettlement(
		input,
		body.physicalShape.radius,
		contactResult.event.colliderId,
		contactResult.event.time,
		eventPosition,
		contactResult.event.normal,
		contactResult.candidate.contactPoint,
		outgoingVelocity
	);
	return {
		type: 'commit',
		segment,
		event: contactResult.event,
		entry,
		terminalReason,
		nextState: terminalReason
			? null
			: {
					time: contactResult.event.time,
					position: contactResult.event.position,
					velocity: outgoingVelocity
				}
	};
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
		contractVersion: 5,
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
