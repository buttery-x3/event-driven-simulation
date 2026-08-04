import type { CircularContactMotionSegment, Vec2 } from '../../../contracts';
import { dotVec2 } from '../../../math';
import {
	circularContactSpeedSquared,
	circularContactTravelTime,
	evaluateCircularContactState
} from '../../../motion';
import {
	findEarliestAngularEvent,
	type CircularContactSeed,
	type SustainedContactRequest
} from '../../single-ball/sustained-contact';
import { certifySupportEquilibrium } from '../dormancy';
import type { SchedulerState } from '../types';
import type {
	DynamicSupportBoundary,
	DynamicSupportPrediction,
	DynamicSupportReactionState,
	DynamicSupportRuntime
} from './types';

export function refreshDynamicSupportPrediction(
	state: SchedulerState,
	support: DynamicSupportRuntime
): DynamicSupportPrediction | null {
	const prediction = createPrediction(state, support);
	if (!prediction) return null;
	state.dynamicSupportPredictions.set(support.id, prediction);
	state.horizons.push({
		bodyId: support.movingBodyId,
		interval: [prediction.segment.startTime, prediction.segment.endTime],
		revision: { bodyId: support.movingBodyId, revision: prediction.revision },
		eventType: eventType(prediction.boundary),
		decision: 'retained',
		reason: `Certified relative future for dynamic support ${support.id}.`
	});
	return prediction;
}

export function predictEarliestDynamicSupport(
	state: SchedulerState
): DynamicSupportPrediction | null {
	return (
		[...state.dynamicSupportPredictions.values()].sort(
			(left, right) =>
				left.segment.endTime - right.segment.endTime ||
				left.supportId.localeCompare(right.supportId)
		)[0] ?? null
	);
}

export function dynamicSupportPathForBody(
	state: SchedulerState,
	bodyId: string
): CircularContactMotionSegment | null {
	return (
		[...state.dynamicSupportPredictions.values()].find(
			(prediction) => prediction.movingBodyId === bodyId
		)?.segment ?? null
	);
}

export function invalidateDynamicSupportPrediction(
	state: SchedulerState,
	supportId: string,
	reason: string
): void {
	const prediction = state.dynamicSupportPredictions.get(supportId);
	if (!prediction) return;
	for (let index = state.horizons.length - 1; index >= 0; index -= 1) {
		const horizon = state.horizons[index]!;
		if (
			horizon.bodyId !== prediction.movingBodyId ||
			horizon.revision.revision !== prediction.revision ||
			horizon.interval[1] !== prediction.segment.endTime
		)
			continue;
		state.horizons[index] = {
			...horizon,
			decision: 'invalidated',
			decisionWorldTime: state.worldTime,
			reason
		};
		break;
	}
	state.dynamicSupportPredictions.delete(supportId);
}

export function selectDynamicSupportPrediction(
	state: SchedulerState,
	prediction: DynamicSupportPrediction
): void {
	for (let index = state.horizons.length - 1; index >= 0; index -= 1) {
		const horizon = state.horizons[index]!;
		if (
			horizon.bodyId !== prediction.movingBodyId ||
			horizon.revision.revision !== prediction.revision ||
			horizon.interval[1] !== prediction.segment.endTime
		)
			continue;
		state.horizons[index] = {
			...horizon,
			decision: 'selected',
			decisionWorldTime: state.worldTime,
			reason: `Dynamic support ${prediction.supportId} supplied the selected world event.`
		};
		break;
	}
	state.dynamicSupportPredictions.delete(prediction.supportId);
}

function createPrediction(
	state: SchedulerState,
	support: DynamicSupportRuntime
): DynamicSupportPrediction | null {
	const movingRuntime = state.runtimes.get(support.movingBodyId);
	if (!movingRuntime) return null;
	const seed: CircularContactSeed = {
		centre: state.runtimes.get(support.supportBodyId)!.state.position,
		contactRadius:
			movingRuntime.body.physicalShape.radius +
			state.runtimes.get(support.supportBodyId)!.body.physicalShape.radius,
		startAngle: Math.atan2(support.normal[1], support.normal[0]),
		direction: support.direction,
		startTangentialSpeed: support.tangentialSpeed,
		gravity: state.input.settings.gravity
	};
	const request = requestFor(state, support);
	const ordinary = findEarliestAngularEvent(request, seed);
	if (!ordinary) return null;
	const tolerance = supportTolerance(state);
	const startReaction = evaluateDynamicSupportReaction(state, support, seed, seed.startAngle);
	if (!startReaction.support || startReaction.bodyBodyReaction <= tolerance) return null;
	const initialRequiredContactIds = startReaction.support.contacts
		.filter((_, index) => startReaction.support!.reactions[index]! > tolerance)
		.map(({ id }) => id);
	const anchored = anchoredBoundary(
		state,
		support,
		seed,
		ordinary.angle,
		initialRequiredContactIds
	);
	let boundary: DynamicSupportBoundary =
		anchored && angularDistance(seed, anchored.angle) < angularDistance(seed, ordinary.angle)
			? anchored
			: ordinary;
	let travelTime = circularContactTravelTime(seed, boundary.angle);
	if (!Number.isFinite(travelTime) || travelTime <= state.input.settings.tolerances.eventTime) {
		boundary = {
			type: 'unresolved',
			angle: seed.startAngle,
			detail: 'Dynamic-support circular travel time was not finite and positive.'
		};
		travelTime = 0;
	}
	const maximumDuration = state.input.settings.maximumSimulationTime - support.time;
	if (travelTime > maximumDuration) {
		const provisional = segmentFor(support, seed, boundary.angle, support.time + travelTime);
		const cutoff = evaluateCircularContactState(
			provisional,
			state.input.settings.maximumSimulationTime
		);
		boundary = {
			type: 'terminal',
			angle: cutoff.angle,
			terminalReason: {
				type: 'time-limit',
				time: state.input.settings.maximumSimulationTime,
				limit: state.input.settings.maximumSimulationTime
			}
		};
		travelTime = maximumDuration;
	}
	const segment = segmentFor(support, seed, boundary.angle, support.time + travelTime);
	return {
		supportId: support.id,
		movingBodyId: support.movingBodyId,
		revision: movingRuntime.revision,
		segment,
		seed,
		boundary,
		startReaction,
		endReaction: evaluateDynamicSupportReaction(state, support, seed, boundary.angle),
		initialRequiredContactIds
	};
}

function requestFor(
	state: SchedulerState,
	support: DynamicSupportRuntime
): SustainedContactRequest {
	return {
		input: state.input,
		body: state.runtimes.get(support.movingBodyId)!.body,
		colliderId: support.supportBodyId,
		time: support.time,
		position: support.position,
		normal: support.normal,
		outgoingVelocity: state.runtimes.get(support.movingBodyId)!.state.velocity,
		entryFrom: 'impact',
		entryReason: 'impact-collapse'
	};
}

function anchoredBoundary(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	seed: CircularContactSeed,
	endAngle: number,
	requiredContactIds: readonly string[]
): Extract<DynamicSupportBoundary, { readonly type: 'anchored-support-lost' }> | null {
	let previousAngle = seed.startAngle;
	let previous = evaluateDynamicSupportReaction(state, support, seed, previousAngle);
	for (let index = 1; index <= 512; index += 1) {
		const angle = seed.startAngle + ((endAngle - seed.startAngle) * index) / 512;
		const current = evaluateDynamicSupportReaction(state, support, seed, angle);
		if (supportLost(current, requiredContactIds, supportTolerance(state))) {
			let lower = previousAngle;
			let upper = angle;
			let lastSupported = previous;
			for (let iteration = 0; iteration < 60; iteration += 1) {
				const middle = (lower + upper) / 2;
				const candidate = evaluateDynamicSupportReaction(state, support, seed, middle);
				if (supportLost(candidate, requiredContactIds, supportTolerance(state))) upper = middle;
				else {
					lower = middle;
					lastSupported = candidate;
				}
			}
			const releasedContactIds = releasedContacts(
				lastSupported,
				requiredContactIds,
				supportTolerance(state)
			);
			return {
				type: 'anchored-support-lost',
				angle: upper,
				releasedContactIds
			};
		}
		previousAngle = angle;
		previous = current;
	}
	return null;
}

export function evaluateDynamicSupportReaction(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	seed: CircularContactSeed,
	angle: number
): DynamicSupportReactionState {
	const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
	const speedSquared = Math.max(0, circularContactSpeedSquared(seed, angle));
	const movingMass = state.runtimes.get(support.movingBodyId)!.body.mass;
	const bodyBodyReaction = Math.max(
		0,
		-movingMass * (speedSquared / seed.contactRadius + dotVec2(seed.gravity, normal))
	);
	const loadOnSupport: Vec2 = [-bodyBodyReaction * normal[0], -bodyBodyReaction * normal[1]];
	const supportSolution = certifySupportEquilibrium(
		support.anchoredBodies,
		support.anchoredContacts,
		state.input.settings.gravity,
		supportTolerance(state),
		new Map([[support.supportBodyId, loadOnSupport]])
	);
	return {
		angle,
		normal,
		tangentialSpeed: Math.sqrt(speedSquared),
		bodyBodyReaction,
		loadOnSupport,
		support: supportSolution
	};
}

function supportLost(
	reaction: DynamicSupportReactionState,
	requiredContactIds: readonly string[],
	tolerance: number
): boolean {
	if (!reaction.support) return true;
	const values = new Map(
		reaction.support.contacts.map((contact, index) => [
			contact.id,
			reaction.support!.reactions[index]!
		])
	);
	return requiredContactIds.some((id) => (values.get(id) ?? 0) <= tolerance);
}

function releasedContacts(
	reaction: DynamicSupportReactionState,
	requiredContactIds: readonly string[],
	tolerance: number
): readonly string[] {
	if (!reaction.support) return requiredContactIds;
	const values = new Map(
		reaction.support.contacts.map((contact, index) => [
			contact.id,
			reaction.support!.reactions[index]!
		])
	);
	const released = requiredContactIds.filter((id) => (values.get(id) ?? 0) <= tolerance * 8);
	if (released.length > 0) return released;
	return [
		[...requiredContactIds].sort(
			(left, right) =>
				(values.get(left) ?? 0) - (values.get(right) ?? 0) || left.localeCompare(right)
		)[0]!
	];
}

function segmentFor(
	support: DynamicSupportRuntime,
	seed: CircularContactSeed,
	endAngle: number,
	endTime: number
): CircularContactMotionSegment {
	const tangent: Vec2 = [
		-Math.sin(seed.startAngle) * seed.direction,
		Math.cos(seed.startAngle) * seed.direction
	];
	return {
		type: 'circular-contact',
		bodyId: support.movingBodyId,
		startTime: support.time,
		endTime,
		startPosition: support.position,
		startVelocity: [tangent[0] * seed.startTangentialSpeed, tangent[1] * seed.startTangentialSpeed],
		supportingColliderId: support.supportBodyId,
		supportingBodyId: support.supportBodyId,
		supportingComponentId: support.componentId,
		centre: seed.centre,
		contactRadius: seed.contactRadius,
		startAngle: seed.startAngle,
		endAngle,
		direction: seed.direction,
		startTangentialSpeed: seed.startTangentialSpeed,
		gravity: seed.gravity
	};
}

function angularDistance(seed: CircularContactSeed, angle: number): number {
	return seed.direction * (angle - seed.startAngle);
}

function supportTolerance(state: SchedulerState): number {
	return Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256);
}

function eventType(boundary: DynamicSupportBoundary) {
	return boundary.type === 'contact'
		? ('fixed-contact' as const)
		: boundary.type === 'terminal'
			? ('termination' as const)
			: boundary.type === 'unresolved'
				? ('unresolved' as const)
				: ('motion-transition' as const);
}
