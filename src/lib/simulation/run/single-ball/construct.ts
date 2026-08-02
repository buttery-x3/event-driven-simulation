import type {
	ContactEvent,
	FreeFlightMotionSegment,
	InitialDynamicCircleBodyState,
	MotionSegment,
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
import { toRunContactSearchDiagnostic, withManifoldEvidence } from './diagnostics';
import { impactObservation, resolveImpactResponse } from './impact-response';
import { validateSingleBallInput } from './input-validation';
import { solveSupportReactions } from './manifold';
import { continueSustainedContact, type SustainedNextState } from './sustained-contact';
import {
	appendSustainedContact,
	contactEventCount,
	createRunAssembly,
	finishRun,
	type RunAssembly
} from './run-assembly';
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
	readonly releasedContactColliderIds: readonly string[];
	readonly retainedSupportCandidates: readonly FixedWorldContactCandidate[];
	readonly acceptInitialContact: boolean;
}

type ImpactResolution =
	| { readonly type: 'terminal'; readonly reason: RunTerminalReason; readonly time: number }
	| { readonly type: 'continue'; readonly nextState: EventState };

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
				mergeContactCandidates(state.retainedSupportCandidates, contactResult.activeCandidates),
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
		releasedContactColliderIds: state.releasedContactColliderIds,
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
	candidates: readonly FixedWorldContactCandidate[],
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
	const response = resolveImpactResponse(
		input,
		event.time,
		candidates,
		incomingVelocity,
		assembly.impactHistory
	);
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
	const committedEvent: ContactEvent = {
		...event,
		contacts: response.contacts,
		preContactVelocity: incomingVelocity,
		postContactVelocity: response.outgoingVelocity
	};
	const diagnosticIndex = assembly.contactSearches.length - 1;
	const latestDiagnostic = assembly.contactSearches[diagnosticIndex];
	if (latestDiagnostic) {
		assembly.contactSearches[diagnosticIndex] = withManifoldEvidence(
			latestDiagnostic,
			incomingVelocity,
			response.outgoingVelocity,
			response.contacts
		);
	}
	assembly.events.push(committedEvent);
	assembly.entries.push({
		severity: 'info',
		code: 'CONTACT_COMMITTED',
		message: `Committed ${response.contacts.length}-contact manifold (${response.contacts.map(({ colliderId }) => colliderId).join(', ')}).`,
		time: event.time,
		bodyId: body.id
	});
	assembly.impactHistory.push(impactObservation(candidates, event.time, response.contacts));
	if (!response.enterSustainedContact) {
		return freeFlightAfterManifold(event, response.outgoingVelocity, candidates);
	}

	const mayRest =
		Math.hypot(...response.outgoingVelocity) <= input.settings.tolerances.eventTime ||
		response.collapseReason === 'contracting-impacts';
	const support = mayRest
		? solveSupportReactions(candidates, input.settings.gravity, input.settings.tolerances.eventTime)
		: null;
	if (support) return restingManifold(body, event, response, support.reactions, assembly);

	const supportCandidate = candidates.find((candidate) => {
		const evidence = response.contacts.find(
			(contact) =>
				contact.colliderId === candidate.colliderId && contact.feature === candidate.feature
		);
		const pressing =
			input.settings.gravity[0] * candidate.normal[0] +
			input.settings.gravity[1] * candidate.normal[1];
		return Boolean(
			evidence &&
			pressing < 0 &&
			(response.collapseReason !== null ||
				Math.abs(evidence.postImpactNormalVelocity) <= input.settings.tolerances.eventTime)
		);
	});
	if (!supportCandidate)
		return freeFlightAfterManifold(event, response.outgoingVelocity, candidates);

	const continuation = continueSustainedContact({
		input,
		body,
		colliderId: supportCandidate.colliderId,
		time: event.time,
		position: event.position,
		normal: supportCandidate.normal,
		outgoingVelocity: response.outgoingVelocity,
		entryFrom: response.collapseReason === 'initial-supported-state' ? 'free-flight' : 'impact',
		entryReason:
			response.collapseReason === 'initial-supported-state'
				? 'supported-initial-state'
				: response.collapseReason
					? 'impact-collapse'
					: 'collider-contact',
		manifoldContacts: response.contacts
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

function restingManifold(
	body: InitialDynamicCircleBodyState,
	event: ContactEvent,
	response: NonNullable<ReturnType<typeof resolveImpactResponse>>,
	supportReactions: readonly number[],
	assembly: RunAssembly
): ImpactResolution {
	const supportedInitial = response.collapseReason === 'initial-supported-state';
	assembly.events.push({
		type: 'contact-mode-transition',
		time: event.time,
		bodyId: body.id,
		colliderId: event.colliderId,
		from: supportedInitial ? 'free-flight' : 'impact',
		to: 'resting',
		reason: supportedInitial ? 'supported-initial-state' : 'impact-collapse',
		position: event.position,
		normal: event.normal,
		contacts: response.contacts
	});
	assembly.entries.push({
		severity: 'info',
		code: 'CONTACT_MODE_TRANSITION',
		message: `${supportedInitial ? 'free-flight' : 'impact'} -> resting on manifold: ${supportedInitial ? 'supported-initial-state' : 'impact-collapse'}.`,
		time: event.time,
		bodyId: body.id
	});
	return {
		type: 'terminal',
		time: event.time,
		reason: {
			type: 'resting-contact',
			time: event.time,
			colliderId: event.colliderId,
			position: event.position,
			normal: event.normal,
			contacts: response.contacts,
			supportReactions,
			reason: supportedInitial ? 'zero-tangential-motion' : 'impact-collapse'
		}
	};
}

function freeFlightAfterManifold(
	event: ContactEvent,
	velocity: Vec2,
	candidates: readonly FixedWorldContactCandidate[]
): ImpactResolution {
	return {
		type: 'continue',
		nextState: {
			time: event.time,
			position: event.position,
			velocity,
			releasedContactColliderId: null,
			releasedContactColliderIds: candidates.map(({ colliderId }) => colliderId),
			retainedSupportCandidates: [],
			acceptInitialContact: false
		}
	};
}

function mergeContactCandidates(
	retained: readonly FixedWorldContactCandidate[],
	incoming: readonly FixedWorldContactCandidate[]
): readonly FixedWorldContactCandidate[] {
	const merged = [...retained];
	for (const candidate of incoming) {
		if (
			!merged.some(
				({ colliderId, feature }) =>
					colliderId === candidate.colliderId && feature === candidate.feature
			)
		)
			merged.push(candidate);
	}
	return merged;
}

function toEventState(state: SustainedNextState): EventState {
	return state;
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
