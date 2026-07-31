import type {
	AxisAlignedTerminationRegion,
	BoardBounds,
	DiagnosticEntry,
	InitialDynamicCircleBodyState,
	MotionSegment,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	RunValidity,
	SimulationInput,
	SimulationRunRecord,
	StaticLineSegmentCollider,
	Vec2
} from './contracts';
import {
	defaultFixedWorldContactTolerances,
	findEarliestFixedWorldContact,
	type FixedWorldContactDiagnostics,
	type FixedWorldContactQueryResult
} from './fixed-world-contact';
import { validateSceneDefinition } from './scene-validation';
import { getRunOutcome, getTerminalDiagnosticCode } from './run-outcome';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from './trajectory';
import { dotVec2 } from './vector';

interface EventState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
}

export interface SimulationInputDiagnostic {
	readonly code:
		| 'INVALID_SCENE'
		| 'INVALID_BODY_COUNT'
		| 'INVALID_BODY_ID'
		| 'DUPLICATE_BODY_ID'
		| 'INVALID_RADIUS'
		| 'INVALID_POSITION'
		| 'INVALID_VELOCITY'
		| 'POSITION_OUTSIDE_BOUNDS'
		| 'INVALID_GRAVITY'
		| 'INVALID_RESTITUTION'
		| 'INVALID_MAXIMUM_EVENTS'
		| 'INVALID_MAXIMUM_TIME'
		| 'INVALID_TOLERANCES'
		| 'INVALID_SETTLEMENT_POLICY';
	readonly path: string;
	readonly message: string;
}

interface TerminationEntry {
	readonly time: number;
	readonly reason: Extract<
		RunTerminalReason,
		{ type: 'completion-region' | 'escape-region' | 'bounds-escape' }
	>;
}

type TerminationSearchResult =
	| { readonly type: 'entry'; readonly entry: TerminationEntry }
	| { readonly type: 'none' }
	| { readonly type: 'numerical-failure'; readonly detail: string };

export function constructSingleBallRun(input: SimulationInput): SimulationRunRecord {
	const wallTimeStart = Date.now();
	const segments: MotionSegment[] = [];
	const events: SimulationRunRecord['events'][number][] = [];
	const entries: DiagnosticEntry[] = [];
	const contactSearches: RunContactSearchDiagnostic[] = [];
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
		velocity: body.velocity
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
		if (events.length >= input.settings.maximumEvents) {
			return finish(
				'valid',
				{
					type: 'event-limit',
					time: state.time,
					limit: input.settings.maximumEvents
				},
				state.time
			);
		}

		const remainingTime = input.settings.maximumSimulationTime - state.time;
		if (remainingTime <= input.settings.tolerances.eventTime) {
			return finish(
				'valid',
				{
					type: 'time-limit',
					time: state.time,
					limit: input.settings.maximumSimulationTime
				},
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
				{
					type: 'numerical-failure',
					time: state.time,
					detail: terminationSearch.detail
				},
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
		const searchDiagnostic = toRunContactSearchDiagnostic(
			contactResult,
			path,
			input.settings.restitution
		);
		contactSearches.push(searchDiagnostic);

		if (contactResult.type === 'invalid-input') {
			return finish(
				'invalid',
				{
					type: 'invalid-state',
					time: state.time,
					detail: contactResult.reason
				},
				state.time
			);
		}

		if (contactResult.type === 'unresolved') {
			return finish(
				'valid',
				{
					type: 'unresolved-collision-search',
					time: state.time,
					detail: contactResult.reason
				},
				state.time
			);
		}

		if (contactResult.type === 'contact') {
			const elapsed = contactResult.event.time - state.time;
			if (elapsed <= input.settings.tolerances.eventTime) {
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

			const committedSegment = { ...path, endTime: contactResult.event.time };
			const incomingVelocity = evaluateMotionSegmentVelocity(
				committedSegment,
				contactResult.event.time
			);
			const eventPosition = evaluateMotionSegmentPosition(
				committedSegment,
				contactResult.event.time
			);
			if (!isFiniteVec2(incomingVelocity) || !isFiniteVec2(eventPosition)) {
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

			const normalVelocity = dotVec2(incomingVelocity, contactResult.event.normal);
			const responseScale = (1 + input.settings.restitution) * normalVelocity;
			const outgoingVelocity: Vec2 = [
				incomingVelocity[0] - responseScale * contactResult.event.normal[0],
				incomingVelocity[1] - responseScale * contactResult.event.normal[1]
			];
			segments.push(committedSegment);
			events.push(contactResult.event);
			entries.push({
				severity: 'info',
				code: 'CONTACT_COMMITTED',
				message: `Committed contact with ${contactResult.event.colliderId}.`,
				time: contactResult.event.time,
				bodyId: body.id
			});

			if (!Number.isFinite(responseScale) || !isFiniteVec2(outgoingVelocity)) {
				return finish(
					'valid',
					{
						type: 'numerical-failure',
						time: contactResult.event.time,
						detail: 'The restitution response did not produce a finite outgoing velocity.'
					},
					contactResult.event.time
				);
			}

			const settledReason = classifySettlement(
				input,
				body.physicalShape.radius,
				contactResult.event.colliderId,
				contactResult.event.time,
				eventPosition,
				contactResult.event.normal,
				contactResult.candidate.contactPoint,
				outgoingVelocity
			);
			if (settledReason) {
				return finish('valid', settledReason, contactResult.event.time);
			}

			state = {
				time: contactResult.event.time,
				position: contactResult.event.position,
				velocity: outgoingVelocity
			};
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
			segments.push(terminalSegment);
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

		segments.push(path);
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

	function finish(
		validity: RunValidity,
		terminalReasonValue: RunTerminalReason,
		simulatedUntilTime: number
	): SimulationRunRecord {
		const outcome = getRunOutcome(terminalReasonValue);
		entries.push(toTerminalDiagnostic(outcome, terminalReasonValue, bodyOrNull(input)));
		const candidateCount = contactSearches.reduce(
			(total, search) => total + search.candidates.length,
			0
		);

		return {
			contractVersion: 5,
			input,
			validity,
			outcome,
			terminalReason: terminalReasonValue,
			trajectories:
				input.initialDynamicBodies.length === 1
					? [{ bodyId: input.initialDynamicBodies[0]!.id, segments }]
					: [],
			events,
			diagnostics: {
				iterations: contactSearches.length,
				simulatedUntilTime,
				eventCount: events.length,
				candidateCount,
				segmentCount: segments.length,
				simulationWallTimeMilliseconds: Math.max(0, Date.now() - wallTimeStart),
				contactSearches,
				entries
			}
		};
	}
}

export function validateSingleBallInput(
	input: SimulationInput
): readonly SimulationInputDiagnostic[] {
	const sceneValidation = validateSceneDefinition(input.scene, '$.scene');
	if (!sceneValidation.valid) {
		const first = sceneValidation.diagnostics[0]!;
		return [
			{
				code: 'INVALID_SCENE',
				path: first.path,
				message: first.message
			}
		];
	}

	if (input.initialDynamicBodies.length !== 1) {
		return [
			{
				code: 'INVALID_BODY_COUNT',
				path: '$.initialDynamicBodies',
				message: 'A single-ball run requires exactly one dynamic body.'
			}
		];
	}

	const body = input.initialDynamicBodies[0]!;
	if (body.id.trim().length === 0) {
		return [
			{
				code: 'INVALID_BODY_ID',
				path: '$.initialDynamicBodies[0].id',
				message: 'The dynamic body ID must be non-empty.'
			}
		];
	}
	if (
		input.scene.staticColliders.some(({ id }) => id === body.id) ||
		input.scene.terminationRegions.some(({ id }) => id === body.id)
	) {
		return [
			{
				code: 'DUPLICATE_BODY_ID',
				path: '$.initialDynamicBodies[0].id',
				message: `Dynamic body ID "${body.id}" duplicates a scene entity ID.`
			}
		];
	}
	if (!Number.isFinite(body.physicalShape.radius) || body.physicalShape.radius <= 0) {
		return [
			{
				code: 'INVALID_RADIUS',
				path: '$.initialDynamicBodies[0].physicalShape.radius',
				message: 'The dynamic body radius must be a positive finite number.'
			}
		];
	}
	if (!isFiniteVec2(body.position)) {
		return [
			{
				code: 'INVALID_POSITION',
				path: '$.initialDynamicBodies[0].position',
				message: 'The dynamic body position must contain finite numbers.'
			}
		];
	}
	if (!isFiniteVec2(body.velocity)) {
		return [
			{
				code: 'INVALID_VELOCITY',
				path: '$.initialDynamicBodies[0].velocity',
				message: 'The dynamic body velocity must contain finite numbers.'
			}
		];
	}
	if (!isInsideBounds(body.position, input.scene.bounds)) {
		return [
			{
				code: 'POSITION_OUTSIDE_BOUNDS',
				path: '$.initialDynamicBodies[0].position',
				message: 'The dynamic body initial position must be inside the supported scene bounds.'
			}
		];
	}

	const settings = input.settings;
	if (!isFiniteVec2(settings.gravity)) {
		return [
			{
				code: 'INVALID_GRAVITY',
				path: '$.settings.gravity',
				message: 'Gravity must contain finite numbers.'
			}
		];
	}
	if (
		!Number.isFinite(settings.restitution) ||
		settings.restitution < 0 ||
		settings.restitution > 1
	) {
		return [
			{
				code: 'INVALID_RESTITUTION',
				path: '$.settings.restitution',
				message: 'Restitution must be a finite number between zero and one.'
			}
		];
	}
	if (!Number.isInteger(settings.maximumEvents) || settings.maximumEvents < 0) {
		return [
			{
				code: 'INVALID_MAXIMUM_EVENTS',
				path: '$.settings.maximumEvents',
				message: 'The maximum event count must be a non-negative integer.'
			}
		];
	}
	if (!Number.isFinite(settings.maximumSimulationTime) || settings.maximumSimulationTime <= 0) {
		return [
			{
				code: 'INVALID_MAXIMUM_TIME',
				path: '$.settings.maximumSimulationTime',
				message: 'Maximum simulation time must be a positive finite number.'
			}
		];
	}
	if (
		!Number.isFinite(settings.tolerances.contactDistance) ||
		settings.tolerances.contactDistance <= 0 ||
		!Number.isFinite(settings.tolerances.eventTime) ||
		settings.tolerances.eventTime <= 0
	) {
		return [
			{
				code: 'INVALID_TOLERANCES',
				path: '$.settings.tolerances',
				message: 'Contact-distance and event-time tolerances must be positive finite numbers.'
			}
		];
	}
	if (settings.settlement) {
		const policy = settings.settlement;
		if (
			!Number.isFinite(policy.maximumNormalSeparationSpeed) ||
			policy.maximumNormalSeparationSpeed < 0 ||
			!Number.isFinite(policy.maximumTangentialSpeed) ||
			policy.maximumTangentialSpeed < 0 ||
			!Number.isFinite(policy.contactDistance) ||
			policy.contactDistance <= 0 ||
			!Number.isFinite(policy.minimumPressingAcceleration) ||
			policy.minimumPressingAcceleration <= 0
		) {
			return [
				{
					code: 'INVALID_SETTLEMENT_POLICY',
					path: '$.settings.settlement',
					message:
						'Settlement thresholds must be finite, with non-negative speed thresholds and positive distance and pressing-acceleration thresholds.'
				}
			];
		}
	}

	return [];
}

function findEarliestTerminationEntry(
	segment: MotionSegment,
	regions: readonly AxisAlignedTerminationRegion[],
	bounds: BoardBounds,
	searchUntilTime: number,
	tolerance: number,
	eventTimeTolerance: number
): TerminationSearchResult {
	const candidates: TerminationEntry[] = [];
	const duration = searchUntilTime - segment.startTime;

	for (const region of regions) {
		if (contains(region, segment.startPosition, tolerance)) {
			candidates.push({
				time: segment.startTime,
				reason: terminationReason(region, segment.startTime)
			});
			continue;
		}

		const boundaries = [
			{ axis: 0 as const, value: region.minimum[0] },
			{ axis: 0 as const, value: region.maximum[0] },
			{ axis: 1 as const, value: region.minimum[1] },
			{ axis: 1 as const, value: region.maximum[1] }
		];

		for (const boundary of boundaries) {
			const roots = solveCoordinateCrossings(
				0.5 * segment.acceleration[boundary.axis],
				segment.startVelocity[boundary.axis],
				segment.startPosition[boundary.axis] - boundary.value
			);
			if (roots === null) {
				return {
					type: 'numerical-failure',
					detail: `Termination-region crossing for ${region.id} could not be solved numerically.`
				};
			}

			for (const elapsed of roots) {
				if (elapsed < 0 || elapsed > duration) continue;
				const time = segment.startTime + elapsed;
				const position = evaluateMotionSegmentPosition(segment, time);
				if (!isFiniteVec2(position)) {
					return {
						type: 'numerical-failure',
						detail: `Termination-region crossing state for ${region.id} was not finite.`
					};
				}
				if (contains(region, position, tolerance)) {
					candidates.push({ time, reason: terminationReason(region, time) });
				}
			}
		}
	}

	const boundsCandidates = findBoundsExitCandidates(
		segment,
		bounds,
		searchUntilTime,
		eventTimeTolerance
	);
	if (boundsCandidates === null) {
		return {
			type: 'numerical-failure',
			detail: 'Supported-bounds crossings could not be solved numerically.'
		};
	}
	candidates.push(...boundsCandidates);

	candidates.sort(
		(left, right) =>
			left.time - right.time ||
			Number(left.reason.type !== 'completion-region') -
				Number(right.reason.type !== 'completion-region') ||
			terminationKey(left.reason).localeCompare(terminationKey(right.reason))
	);

	return candidates[0] ? { type: 'entry', entry: candidates[0] } : { type: 'none' };
}

function solveCoordinateCrossings(a: number, b: number, c: number): readonly number[] | null {
	if (![a, b, c].every(Number.isFinite)) return null;
	if (a === 0) {
		if (b === 0) return [];
		const root = -c / b;
		return Number.isFinite(root) ? [root] : null;
	}

	const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
	if (scale === 0) return [];
	const normalizedA = a / scale;
	const normalizedB = b / scale;
	const normalizedC = c / scale;
	const discriminant = normalizedB * normalizedB - 4 * normalizedA * normalizedC;
	if (!Number.isFinite(discriminant)) return null;
	if (discriminant < 0) return [];

	const squareRoot = Math.sqrt(discriminant);
	const q = -0.5 * (normalizedB + (normalizedB < 0 ? -squareRoot : squareRoot));
	if (q === 0) {
		const root = -normalizedB / (2 * normalizedA);
		return Number.isFinite(root) ? [root] : null;
	}

	const first = q / normalizedA;
	const second = normalizedC / q;
	return [first, second].filter(Number.isFinite).sort((left, right) => left - right);
}

function toRunContactSearchDiagnostic(
	result: FixedWorldContactQueryResult,
	path: MotionSegment,
	restitution: number
): RunContactSearchDiagnostic {
	const diagnostics: FixedWorldContactDiagnostics = result.diagnostics;
	const nearSimultaneous = new Set(diagnostics.nearSimultaneousCandidates);
	const accepted = diagnostics.orderedCandidates.map((candidate) => {
		const preContactVelocity = evaluateMotionSegmentVelocity(path, candidate.time);
		const responseScale = (1 + restitution) * dotVec2(preContactVelocity, candidate.normal);
		const postContactVelocity: Vec2 = [
			preContactVelocity[0] - responseScale * candidate.normal[0],
			preContactVelocity[1] - responseScale * candidate.normal[1]
		];

		return {
			colliderId: candidate.colliderId,
			feature: candidate.feature,
			time: candidate.time,
			classification: 'accepted',
			timeDelta: normalizeDiagnosticNumber(candidate.time - path.startTime),
			position: normalizeDiagnosticVector(candidate.position),
			contactPoint: normalizeDiagnosticVector(candidate.contactPoint),
			normal: normalizeDiagnosticVector(candidate.normal),
			normalVelocity: normalizeDiagnosticNumber(candidate.normalVelocity),
			preContactVelocity: normalizeDiagnosticVector(preContactVelocity),
			postContactVelocity: normalizeDiagnosticVector(postContactVelocity),
			nearSimultaneous: nearSimultaneous.has(candidate)
		};
	});
	const rejected = diagnostics.colliderEvaluations.flatMap((evaluation) =>
		evaluation.rejectedCandidates.map((candidate) => ({
			colliderId: evaluation.colliderId,
			feature: candidate.feature,
			time: candidate.time,
			classification: candidate.classification
		}))
	);

	return {
		searchInterval: diagnostics.searchInterval,
		eventTimeTolerance: diagnostics.eventTimeTolerance,
		outcome: result.type,
		reason: 'reason' in result ? result.reason : null,
		selectedColliderId: result.type === 'contact' ? result.event.colliderId : null,
		candidates: [...accepted, ...rejected]
	};
}

function normalizeDiagnosticVector(vector: Vec2): Vec2 {
	return [normalizeDiagnosticNumber(vector[0]), normalizeDiagnosticNumber(vector[1])];
}

function normalizeDiagnosticNumber(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}

function findContainingRegion(
	regions: readonly AxisAlignedTerminationRegion[],
	position: Vec2,
	tolerance: number
): AxisAlignedTerminationRegion | null {
	return (
		[...regions]
			.filter((region) => contains(region, position, tolerance))
			.sort(
				(left, right) =>
					Number(left.purpose === 'escape') - Number(right.purpose === 'escape') ||
					left.id.localeCompare(right.id)
			)[0] ?? null
	);
}

function contains(
	region: AxisAlignedTerminationRegion,
	position: Vec2,
	tolerance: number
): boolean {
	return (
		position[0] >= region.minimum[0] - tolerance &&
		position[0] <= region.maximum[0] + tolerance &&
		position[1] >= region.minimum[1] - tolerance &&
		position[1] <= region.maximum[1] + tolerance
	);
}

function terminationReason(
	region: AxisAlignedTerminationRegion,
	time: number
): Extract<RunTerminalReason, { type: 'completion-region' | 'escape-region' }> {
	return region.purpose === 'complete'
		? { type: 'completion-region', regionId: region.id, time }
		: { type: 'escape-region', regionId: region.id, time };
}

function isPermanentlyStationary(state: EventState, acceleration: Vec2): boolean {
	return (
		state.velocity[0] === 0 &&
		state.velocity[1] === 0 &&
		acceleration[0] === 0 &&
		acceleration[1] === 0
	);
}

function findBoundsExitCandidates(
	segment: MotionSegment,
	bounds: BoardBounds,
	searchUntilTime: number,
	eventTimeTolerance: number
): readonly TerminationEntry[] | null {
	const duration = searchUntilTime - segment.startTime;
	const boundaries = [
		{ axis: 0 as const, value: -bounds.width / 2, boundary: 'left' as const, direction: -1 },
		{ axis: 0 as const, value: bounds.width / 2, boundary: 'right' as const, direction: 1 },
		{ axis: 1 as const, value: 0, boundary: 'bottom' as const, direction: -1 },
		{ axis: 1 as const, value: bounds.height, boundary: 'top' as const, direction: 1 }
	];
	const candidates: TerminationEntry[] = [];

	for (const boundary of boundaries) {
		const roots = solveCoordinateCrossings(
			0.5 * segment.acceleration[boundary.axis],
			segment.startVelocity[boundary.axis],
			segment.startPosition[boundary.axis] - boundary.value
		);
		if (roots === null) return null;

		for (const elapsed of roots) {
			if (elapsed <= eventTimeTolerance || elapsed > duration) continue;
			const time = segment.startTime + elapsed;
			const velocity = evaluateMotionSegmentVelocity(segment, time);
			const outwardSpeed = velocity[boundary.axis] * boundary.direction;
			const outwardAcceleration = segment.acceleration[boundary.axis] * boundary.direction;
			if (
				!isFiniteVec2(velocity) ||
				(outwardSpeed <= eventTimeTolerance && outwardAcceleration <= 0)
			) {
				continue;
			}
			candidates.push({
				time,
				reason: { type: 'bounds-escape', boundary: boundary.boundary, time }
			});
		}
	}

	return candidates;
}

function terminationKey(reason: TerminationEntry['reason']): string {
	switch (reason.type) {
		case 'completion-region':
		case 'escape-region':
			return `${reason.type}:${reason.regionId}`;
		case 'bounds-escape':
			return `${reason.type}:${reason.boundary}`;
	}
}

function isInsideBounds(position: Vec2, bounds: BoardBounds): boolean {
	return (
		position[0] >= -bounds.width / 2 &&
		position[0] <= bounds.width / 2 &&
		position[1] >= 0 &&
		position[1] <= bounds.height
	);
}

function classifySettlement(
	input: SimulationInput,
	ballRadius: number,
	colliderId: string,
	time: number,
	position: Vec2,
	normal: Vec2,
	contactPoint: Vec2,
	outgoingVelocity: Vec2
): Extract<RunTerminalReason, { type: 'settled-supporting-surface' }> | null {
	const policy = input.settings.settlement;
	if (!policy) return null;

	const collider = input.scene.staticColliders.find(
		(candidate): candidate is StaticLineSegmentCollider =>
			candidate.id === colliderId && candidate.physicalShape.type === 'line-segment'
	);
	if (!collider || collider.surfaceRole !== 'supporting-flat') return null;

	const normalSeparationSpeed = dotVec2(outgoingVelocity, normal);
	const tangent: Vec2 = [-normal[1], normal[0]];
	const tangentialSpeed = Math.abs(dotVec2(outgoingVelocity, tangent));
	const pressingAcceleration = -dotVec2(input.settings.gravity, normal);
	const contactSeparation = Math.hypot(
		position[0] - contactPoint[0],
		position[1] - contactPoint[1]
	);

	if (
		normalSeparationSpeed < -input.settings.tolerances.eventTime ||
		normalSeparationSpeed > policy.maximumNormalSeparationSpeed ||
		tangentialSpeed > policy.maximumTangentialSpeed ||
		pressingAcceleration < policy.minimumPressingAcceleration ||
		Math.abs(contactSeparation - ballRadius) > policy.contactDistance
	) {
		return null;
	}

	return {
		type: 'settled-supporting-surface',
		time,
		colliderId,
		position,
		normalSeparationSpeed,
		tangentialSpeed
	};
}

function hasFiniteEndState(segment: MotionSegment): boolean {
	return (
		isFiniteVec2(evaluateMotionSegmentPosition(segment, segment.endTime)) &&
		isFiniteVec2(evaluateMotionSegmentVelocity(segment, segment.endTime))
	);
}

function isFiniteVec2(vector: Vec2): boolean {
	return vector.every(Number.isFinite);
}

function bodyOrNull(input: SimulationInput): InitialDynamicCircleBodyState | null {
	return input.initialDynamicBodies.length === 1 ? input.initialDynamicBodies[0]! : null;
}

function toTerminalDiagnostic(
	outcome: SimulationRunRecord['outcome'],
	reason: RunTerminalReason,
	body: InitialDynamicCircleBodyState | null
): DiagnosticEntry {
	const severity =
		outcome === 'exited' || outcome === 'settled'
			? 'info'
			: outcome === 'invalid' || outcome === 'unresolved'
				? 'error'
				: 'warning';
	const message =
		'detail' in reason
			? reason.detail
			: reason.type === 'completion-region' || reason.type === 'escape-region'
				? `Run reached ${reason.regionId}.`
				: reason.type === 'settled-supporting-surface'
					? `Run settled on ${reason.colliderId}.`
					: `Run reached the configured ${reason.type}.`;

	return {
		severity,
		code: getTerminalDiagnosticCode(outcome),
		message,
		time: reason.time,
		bodyId: body?.id ?? null
	};
}
