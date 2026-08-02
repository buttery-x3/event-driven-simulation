import type {
	LinearContactMotionSegment,
	RunContactSearchDiagnostic,
	SimulationInput,
	StaticLineSegmentCollider,
	Vec2
} from '../../../contracts';
import {
	defaultFixedWorldContactTolerances,
	findEarliestFixedWorldContact
} from '../../../collision';
import { dotVec2 } from '../../../math';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../../motion';
import { toRunContactSearchDiagnostic } from '../diagnostics';
import { findEarliestTerminationEntry } from '../termination-search';
import { continueCircularContact } from './circular-contact';
import {
	detachedContactResult,
	entryTransition,
	restingContactResult,
	slidingTransition,
	unresolvedContactResult
} from './contact-mode-results';
import type { SustainedContactRequest, SustainedContactResult } from './types';

export function continueLineContact(
	request: SustainedContactRequest,
	collider: StaticLineSegmentCollider
): SustainedContactResult {
	const normalVelocity = dotVec2(request.outgoingVelocity, request.normal);
	const tangentVelocity: Vec2 = [
		request.outgoingVelocity[0] - normalVelocity * request.normal[0],
		request.outgoingVelocity[1] - normalVelocity * request.normal[1]
	];
	const normalAcceleration = dotVec2(request.input.settings.gravity, request.normal);
	const tangentAcceleration: Vec2 = [
		request.input.settings.gravity[0] - normalAcceleration * request.normal[0],
		request.input.settings.gravity[1] - normalAcceleration * request.normal[1]
	];
	if (normalAcceleration > request.input.settings.tolerances.eventTime) {
		return detachedContactResult(request, tangentVelocity);
	}
	if (isResting(tangentVelocity, tangentAcceleration, request.input)) {
		return restingContactResult(request);
	}

	const segmentVector: Vec2 = [
		collider.physicalShape.end[0] - collider.physicalShape.start[0],
		collider.physicalShape.end[1] - collider.physicalShape.start[1]
	];
	const length = Math.hypot(...segmentVector);
	const tangent: Vec2 = [segmentVector[0] / length, segmentVector[1] / length];
	const startCoordinate = dotVec2(
		[
			request.position[0] - collider.physicalShape.start[0],
			request.position[1] - collider.physicalShape.start[1]
		],
		tangent
	);
	const endpoint = findEndpointTime(
		request.time,
		startCoordinate,
		dotVec2(tangentVelocity, tangent),
		dotVec2(tangentAcceleration, tangent),
		length,
		request.input.settings.maximumSimulationTime,
		request.input.settings.tolerances.eventTime
	);
	const provisionalEndTime = endpoint?.time ?? request.input.settings.maximumSimulationTime;
	const path: LinearContactMotionSegment = {
		type: 'linear-contact',
		bodyId: request.body.id,
		startTime: request.time,
		endTime: provisionalEndTime,
		startPosition: request.position,
		startVelocity: tangentVelocity,
		acceleration: tangentAcceleration,
		supportingColliderId: collider.id,
		contactNormal: request.normal
	};
	const termination = findEarliestTerminationEntry(
		path,
		request.input.scene.terminationRegions,
		request.input.scene.bounds,
		provisionalEndTime,
		request.input.settings.tolerances.contactDistance,
		request.input.settings.tolerances.eventTime
	);
	if (termination.type === 'numerical-failure') {
		return unresolvedContactResult(request, termination.detail);
	}
	const searchEnd = termination.type === 'entry' ? termination.entry.time : provisionalEndTime;
	const contactResult = findEarliestFixedWorldContact({
		segment: path,
		ballRadius: request.body.physicalShape.radius,
		colliders: request.input.scene.staticColliders.filter(({ id }) => id !== collider.id),
		searchUntilTime: searchEnd,
		tolerances: {
			...defaultFixedWorldContactTolerances,
			contactDistance: request.input.settings.tolerances.contactDistance,
			eventTime: request.input.settings.tolerances.eventTime
		}
	});
	const searchDiagnostic = toRunContactSearchDiagnostic(
		contactResult,
		path,
		request.input.settings.restitution
	);
	if (contactResult.type === 'invalid-input' || contactResult.type === 'unresolved') {
		return unresolvedContactResult(request, contactResult.reason, [searchDiagnostic]);
	}

	if (contactResult.type === 'contact') {
		const endSegment = { ...path, endTime: contactResult.event.time };
		return {
			segments: [endSegment],
			events: [
				entryTransition(request, 'sliding'),
				slidingTransition(
					request,
					'impact',
					'collider-contact',
					contactResult.event.time,
					contactResult.event.position,
					contactResult.event.normal
				)
			],
			contactSearches: [searchDiagnostic],
			terminalReason: null,
			nextState: {
				time: contactResult.event.time,
				position: contactResult.event.position,
				velocity: evaluateMotionSegmentVelocity(endSegment, contactResult.event.time),
				releasedContactColliderId: collider.id,
				acceptInitialContact: true
			}
		};
	}

	if (termination.type === 'entry') {
		const segment = { ...path, endTime: termination.entry.time };
		return {
			segments: [segment],
			events: [
				entryTransition(request, 'sliding'),
				slidingTransition(
					request,
					'free-flight',
					'terminal-region',
					termination.entry.time,
					evaluateMotionSegmentPosition(segment, termination.entry.time),
					request.normal
				)
			],
			contactSearches: [searchDiagnostic],
			terminalReason: termination.entry.reason,
			nextState: null
		};
	}

	if (!endpoint) {
		return {
			segments: [path],
			events: [entryTransition(request, 'sliding')],
			contactSearches: [searchDiagnostic],
			terminalReason: {
				type: 'time-limit',
				time: path.endTime,
				limit: request.input.settings.maximumSimulationTime
			},
			nextState: null
		};
	}

	return leaveLineEndpoint(request, collider, path, endpoint, searchDiagnostic);
}

function leaveLineEndpoint(
	request: SustainedContactRequest,
	collider: StaticLineSegmentCollider,
	segment: LinearContactMotionSegment,
	endpoint: { readonly time: number; readonly point: 'start' | 'end' },
	searchDiagnostic: RunContactSearchDiagnostic
): SustainedContactResult {
	const completed = { ...segment, endTime: endpoint.time };
	const position = evaluateMotionSegmentPosition(completed, endpoint.time);
	const velocity = evaluateMotionSegmentVelocity(completed, endpoint.time);
	const centre = collider.physicalShape[endpoint.point];
	const offset: Vec2 = [position[0] - centre[0], position[1] - centre[1]];
	const radius = request.body.physicalShape.radius;
	const distance = Math.hypot(...offset);
	const endpointNormal: Vec2 = [offset[0] / distance, offset[1] / distance];
	const radialFreeAcceleration =
		dotVec2(request.input.settings.gravity, endpointNormal) + dotVec2(velocity, velocity) / radius;

	if (radialFreeAcceleration >= -request.input.settings.tolerances.eventTime) {
		return {
			segments: [completed],
			events: [
				entryTransition(request, 'sliding'),
				slidingTransition(
					request,
					'free-flight',
					'endpoint-reached',
					endpoint.time,
					position,
					endpointNormal
				)
			],
			contactSearches: [searchDiagnostic],
			terminalReason: null,
			nextState: {
				time: endpoint.time,
				position,
				velocity,
				releasedContactColliderId: collider.id,
				acceptInitialContact: false
			}
		};
	}

	const circular = continueCircularContact(
		{
			...request,
			time: endpoint.time,
			position,
			normal: endpointNormal,
			outgoingVelocity: velocity
		},
		centre,
		radius
	);
	return {
		...circular,
		segments: [completed, ...circular.segments],
		events: [entryTransition(request, 'sliding'), ...circular.events.slice(1)],
		contactSearches: [searchDiagnostic, ...circular.contactSearches]
	};
}

function isResting(velocity: Vec2, acceleration: Vec2, input: SimulationInput): boolean {
	const tolerance = input.settings.tolerances.eventTime;
	return Math.hypot(...velocity) <= tolerance && Math.hypot(...acceleration) <= tolerance;
}

function findEndpointTime(
	startTime: number,
	startCoordinate: number,
	velocity: number,
	acceleration: number,
	length: number,
	maximumTime: number,
	tolerance: number
): { readonly time: number; readonly point: 'start' | 'end' } | null {
	const candidates = [
		...quadraticTimes(0.5 * acceleration, velocity, startCoordinate, maximumTime - startTime).map(
			(time) => ({ time: startTime + time, point: 'start' as const })
		),
		...quadraticTimes(
			0.5 * acceleration,
			velocity,
			startCoordinate - length,
			maximumTime - startTime
		).map((time) => ({ time: startTime + time, point: 'end' as const }))
	].filter(({ time }) => time - startTime > tolerance);
	return candidates.sort((left, right) => left.time - right.time)[0] ?? null;
}

function quadraticTimes(a: number, b: number, c: number, horizon: number): number[] {
	if (Math.abs(a) < 1e-15) {
		if (Math.abs(b) < 1e-15) return [];
		const root = -c / b;
		return root >= 0 && root <= horizon ? [root] : [];
	}
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) return [];
	const root = Math.sqrt(discriminant);
	return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(
		(time) => time >= 0 && time <= horizon
	);
}
