import type {
	AccumulationLimit,
	AccumulationLimitContact,
	InitialDynamicCircleBodyState,
	MotionSegment,
	StaticCollider,
	Vec2
} from '../../../contracts';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../../motion';
import { reportRunValidationFailure, type RunValidationContext } from '../../results';

export function validateAccumulations(context: RunValidationContext): void {
	for (const [index, diagnostic] of (context.run.diagnostics.accumulations ?? []).entries()) {
		if (diagnostic.mechanism !== 'general-accumulation')
			fail(context, index, 'Accumulation diagnostics must identify the general mechanism.');
		if (diagnostic.limit === null) continue;
		validateLimit(context, diagnostic.limit, index);
		for (const componentId of diagnostic.downstreamImpactComponentIds) {
			const solve = context.run.diagnostics.impactSolves?.find(
				({ componentId: candidate }) => candidate === componentId
			);
			if (!solve)
				fail(context, index, `Downstream impact solve ${componentId} is not present in the run.`);
		}
		for (const componentId of diagnostic.downstreamSupportComponentIds) {
			if (!context.run.contactComponents.some(({ id }) => id === componentId))
				fail(context, index, `Downstream support component ${componentId} is not present.`);
		}
	}
}

function validateLimit(
	context: RunValidationContext,
	limit: AccumulationLimit,
	index: number
): void {
	const temporal = limit.temporalResiduals;
	const intervals = temporal.sourceEventTimes
		.slice(1)
		.map((time, sourceIndex) => time - temporal.sourceEventTimes[sourceIndex]!);
	if (
		limit.sourceEventIds.length !== temporal.sourceEventTimes.length ||
		intervals.some((interval) => !(interval > 0) || !Number.isFinite(interval)) ||
		!sameNumbers(intervals, temporal.positiveIntervals)
	)
		fail(context, index, 'Accumulation sources must be distinct positive-time physical events.');
	if (
		limit.sourceEventIds.some(
			(id) =>
				(!id.startsWith('physical-fixed-contact:') &&
					!id.startsWith('physical-component-contact:')) ||
				id.includes('reflection')
		)
	)
		fail(context, index, 'A source ID is not a physical scheduler contact event.');
	const ratios = intervals
		.slice(1)
		.map((interval, ratioIndex) => interval / intervals[ratioIndex]!);
	const expectedBound =
		(temporal.latestInterval * temporal.certifiedRatioUpperBound) /
		(1 - temporal.certifiedRatioUpperBound);
	if (
		!sameNumbers(ratios, temporal.contractionRatios) ||
		!Number.isFinite(limit.remainingTimeUpperBound) ||
		limit.remainingTimeUpperBound < 0 ||
		!(temporal.certifiedRatioUpperBound > 0 && temporal.certifiedRatioUpperBound < 1) ||
		!close(limit.remainingTimeUpperBound, expectedBound, temporal.eventTimeResolution * 16) ||
		limit.candidateLimitTime < limit.currentCertifiedTime ||
		limit.candidateLimitTime - limit.currentCertifiedTime >
			limit.remainingTimeUpperBound + temporal.eventTimeResolution * 16
	)
		fail(context, index, 'The reported geometric temporal-tail certificate is inconsistent.');
	if (
		limit.limitingBodyStates.length !== limit.participantBodyIds.length ||
		limit.limitingBodyStates.some(
			({ bodyId, position, velocity }) =>
				!limit.participantBodyIds.includes(bodyId) ||
				![...position, ...velocity].every(Number.isFinite)
		)
	)
		fail(context, index, 'Limiting body states must be finite and cover every participant.');
	validateGeometry(context, limit, index);
	validatePromotionSegments(context, limit, index);
}

function validateGeometry(
	context: RunValidationContext,
	limit: AccumulationLimit,
	index: number
): void {
	const active = new Set(limit.activeLimitContacts.map(contactKey));
	const independentlyActive = new Set<string>();
	let maximumPenetration = 0;
	let testedPairCount = 0;
	for (const state of limit.limitingBodyStates) {
		const body = bodyById(context, state.bodyId);
		if (!body) continue;
		for (const collider of context.submittedInput.scene.staticColliders) {
			const separation = fixedSeparation(state.position, body.physicalShape.radius, collider);
			testedPairCount += 1;
			maximumPenetration = Math.max(maximumPenetration, -separation);
			if (Math.abs(separation) <= limit.penetrationEvidence.contactDistanceTolerance)
				independentlyActive.add(`fixed:${state.bodyId}:${collider.id}`);
		}
	}
	for (let firstIndex = 0; firstIndex < limit.limitingBodyStates.length; firstIndex += 1) {
		for (
			let secondIndex = firstIndex + 1;
			secondIndex < limit.limitingBodyStates.length;
			secondIndex += 1
		) {
			const first = limit.limitingBodyStates[firstIndex]!;
			const second = limit.limitingBodyStates[secondIndex]!;
			const firstBody = bodyById(context, first.bodyId);
			const secondBody = bodyById(context, second.bodyId);
			if (!firstBody || !secondBody) continue;
			const separation =
				distance(first.position, second.position) -
				firstBody.physicalShape.radius -
				secondBody.physicalShape.radius;
			testedPairCount += 1;
			maximumPenetration = Math.max(maximumPenetration, -separation);
			if (Math.abs(separation) <= limit.penetrationEvidence.contactDistanceTolerance)
				independentlyActive.add(`body:${[first.bodyId, second.bodyId].sort().join(':')}`);
		}
	}
	if (
		[...active].some((key) => !independentlyActive.has(key)) ||
		[...independentlyActive].some((key) => !active.has(key)) ||
		maximumPenetration > limit.penetrationEvidence.contactDistanceTolerance ||
		limit.penetrationEvidence.testedPairCount !== testedPairCount ||
		!close(
			limit.penetrationEvidence.maximumPenetration,
			maximumPenetration,
			limit.penetrationEvidence.contactDistanceTolerance * 16
		)
	)
		fail(context, index, 'Independent limiting-geometry reconstruction disagrees with the limit.');
}

function validatePromotionSegments(
	context: RunValidationContext,
	limit: AccumulationLimit,
	index: number
): void {
	for (const state of limit.limitingBodyStates) {
		const trajectory = context.run.trajectories.find(({ bodyId }) => bodyId === state.bodyId);
		const segment = trajectory?.segments.find(
			(candidate): candidate is Extract<MotionSegment, { readonly type: 'accumulation-tail' }> =>
				candidate.type === 'accumulation-tail' &&
				candidate.accumulationLimitId === limit.id &&
				candidate.startTime === limit.currentCertifiedTime &&
				candidate.endTime === limit.candidateLimitTime
		);
		if (
			!segment ||
			distance(evaluateMotionSegmentPosition(segment, segment.endTime), state.position) >
				segment.positionTailUpperBound + Number.EPSILON * 512 ||
			distance(evaluateMotionSegmentVelocity(segment, segment.endTime), state.velocity) >
				segment.velocityTailUpperBound + Number.EPSILON * 512
		)
			fail(context, index, `Body ${state.bodyId} has no continuous certified promotion tail.`);
	}
}

function bodyById(
	context: RunValidationContext,
	bodyId: string
): InitialDynamicCircleBodyState | undefined {
	return context.submittedInput.initialDynamicBodies.find(({ id }) => id === bodyId);
}

function fixedSeparation(position: Vec2, radius: number, collider: StaticCollider): number {
	if ('centre' in collider)
		return distance(position, collider.centre) - collider.physicalShape.radius - radius;
	const { start, end } = collider.physicalShape;
	const edge: Vec2 = [end[0] - start[0], end[1] - start[1]];
	const lengthSquared = edge[0] * edge[0] + edge[1] * edge[1];
	const fraction = Math.max(
		0,
		Math.min(
			1,
			((position[0] - start[0]) * edge[0] + (position[1] - start[1]) * edge[1]) / lengthSquared
		)
	);
	return (
		distance(position, [start[0] + fraction * edge[0], start[1] + fraction * edge[1]]) - radius
	);
}

function contactKey(contact: AccumulationLimitContact): string {
	return contact.type === 'body-fixed'
		? `fixed:${contact.bodyId}:${contact.colliderId}`
		: `body:${[contact.firstBodyId, contact.secondBodyId].sort().join(':')}`;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => close(value, right[index]!, Number.EPSILON * 2048))
	);
}

function close(left: number, right: number, tolerance: number): boolean {
	return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function distance(left: Vec2, right: Vec2): number {
	return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function fail(context: RunValidationContext, index: number, message: string): void {
	reportRunValidationFailure(context, 'contact-geometry', 'LIMIT_MISMATCH', message, {
		path: `$.diagnostics.accumulations[${index}]`
	});
}
