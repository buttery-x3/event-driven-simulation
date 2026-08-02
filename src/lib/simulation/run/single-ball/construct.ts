import type {
	FreeFlightMotionSegment,
	InitialDynamicCircleBodyState,
	MotionSegment,
	RunTerminalReason,
	RunValidity,
	SimulationInput,
	SimulationRunRecord,
	Vec2
} from '../../contracts';
import { defaultFixedWorldContactTolerances, findEarliestFixedWorldContact } from '../../collision';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';
import { toRunContactSearchDiagnostic } from './diagnostics';
import {
	isContractingAlternatingImpactSequence,
	mergeContactCandidates,
	resolveContact,
	resolvePendingContact,
	type ImpactObservation,
	type ImpactNextState
} from './impact';
import { validateSingleBallInput } from './input-validation';
import { contactEventCount, createRunAssembly, finishRun } from './run-assembly';
import {
	findContainingRegion,
	findEarliestTerminationEntry,
	terminationReason
} from './termination-search';

type EventState = ImpactNextState;

export function constructSingleBallRun(input: SimulationInput): SimulationRunRecord {
	const assembly = createRunAssembly(input);
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
		releasedContactColliderIds: [],
		retainedSupportCandidates: [],
		pendingContactCandidates: [],
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

		const pendingResolution = resolvePendingContact(input, body, state, assembly);
		if (pendingResolution) {
			if (pendingResolution.type === 'terminal') {
				return finish('valid', pendingResolution.reason, pendingResolution.time);
			}
			state = pendingResolution.nextState;
			continue;
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
			if (isUnresolvedZeroTimeContact(input, state, contactResult, assembly.impactHistory)) {
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
				mergeContactCandidates(state.retainedSupportCandidates, contactResult.activeCandidates),
				assembly,
				null
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

function isUnresolvedZeroTimeContact(
	input: SimulationInput,
	state: EventState,
	result: Extract<ReturnType<typeof findFreeFlightContact>, { type: 'contact' }>,
	history: readonly ImpactObservation[]
): boolean {
	const elapsed = result.event.time - state.time;
	return (
		elapsed <= input.settings.tolerances.eventTime &&
		!state.acceptInitialContact &&
		!(state.time === 0 && result.event.time === 0) &&
		!(
			elapsed > 0 &&
			isContractingAlternatingImpactSequence(result.event.time, result.activeCandidates, history)
		)
	);
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
		releasedContactColliderIds: state.releasedContactColliderIds,
		toleranceContainedReleaseColliderIds: state.toleranceContainedReleaseColliderIds,
		searchUntilTime,
		tolerances: {
			...defaultFixedWorldContactTolerances,
			contactDistance: input.settings.tolerances.contactDistance,
			eventTime: input.settings.tolerances.eventTime
		}
	});
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
