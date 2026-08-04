import type { CircularContactMotionSegment, Vec2 } from '../../../contracts';
import {
	evaluateBodyTrajectoryPosition,
	evaluateMotionSegmentPosition,
	evaluateMotionSegmentVelocity
} from '../../../motion';
import { nearVector, stateTolerance, timeTolerance } from '../../history';
import { reportRunValidationFailure, type RunValidationContext } from '../../results';

export function validateDynamicSupports(context: RunValidationContext): void {
	for (const [trajectoryIndex, trajectory] of context.run.trajectories.entries()) {
		for (const [segmentIndex, segment] of trajectory.segments.entries()) {
			if (segment.type !== 'circular-contact' || !segment.supportingBodyId) continue;
			validateSegment(context, segment, trajectoryIndex, segmentIndex);
		}
	}
	for (const [index, diagnostic] of (context.run.diagnostics.dynamicSupports ?? []).entries()) {
		const path = `$.diagnostics.dynamicSupports[${index}]`;
		const tolerance = stateTolerance(context) * 64;
		for (const [normal, reaction, load, suffix] of [
			[
				diagnostic.startNormal,
				diagnostic.startBodyBodyReaction,
				diagnostic.startLoadOnSupport,
				'start'
			],
			[diagnostic.endNormal, diagnostic.endBodyBodyReaction, diagnostic.endLoadOnSupport, 'end']
		] as const) {
			if (
				reaction < -tolerance ||
				!nearVector(load, [-reaction * normal[0], -reaction * normal[1]], tolerance)
			) {
				fail(
					context,
					'ATTRACTIVE_SUPPORT_REACTION',
					'Dynamic support must record an equal-and-opposite non-attractive body-body load.',
					`${path}.${suffix}BodyBodyReaction`,
					diagnostic.interval[suffix === 'start' ? 0 : 1],
					diagnostic.movingBodyId
				);
			}
		}
		if (
			[...diagnostic.fixedSupportReactionsAtStart, ...diagnostic.fixedSupportReactionsAtEnd].some(
				({ reaction }) => reaction < -tolerance
			)
		) {
			fail(
				context,
				'ATTRACTIVE_SUPPORT_REACTION',
				'Anchored dynamic-support reactions must remain unilateral and non-negative.',
				path,
				diagnostic.interval[1],
				diagnostic.supportBodyId
			);
		}
		validateBoundaryOutcome(context, diagnostic, path);
	}
}

function validateSegment(
	context: RunValidationContext,
	segment: CircularContactMotionSegment,
	trajectoryIndex: number,
	segmentIndex: number
): void {
	const supportBody = context.submittedInput.initialDynamicBodies.find(
		({ id }) => id === segment.supportingBodyId
	);
	const movingBody = context.submittedInput.initialDynamicBodies.find(
		({ id }) => id === segment.bodyId
	);
	const supportTrajectory = context.run.trajectories.find(
		({ bodyId }) => bodyId === segment.supportingBodyId
	);
	const diagnostic = (context.run.diagnostics.dynamicSupports ?? []).find(
		(item) =>
			item.movingBodyId === segment.bodyId &&
			item.supportBodyId === segment.supportingBodyId &&
			Math.abs(item.interval[0] - segment.startTime) <= timeTolerance(context) &&
			Math.abs(item.interval[1] - segment.endTime) <= timeTolerance(context)
	);
	const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`;
	if (!supportBody || !movingBody || !supportTrajectory || !diagnostic) {
		fail(
			context,
			'UNRESOLVED_BODY_REFERENCE',
			'A dynamic circular segment must resolve its supporting body, trajectory and reaction evidence.',
			path,
			segment.startTime,
			segment.bodyId
		);
		return;
	}
	const expectedDistance = supportBody.physicalShape.radius + movingBody.physicalShape.radius;
	for (const time of [
		segment.startTime,
		(segment.startTime + segment.endTime) / 2,
		segment.endTime
	]) {
		const movingPosition = evaluateMotionSegmentPosition(segment, time);
		const movingVelocity = evaluateMotionSegmentVelocity(segment, time);
		const supportPosition = evaluateBodyTrajectoryPosition(supportTrajectory, time);
		if (!supportPosition) continue;
		const supportSegment = supportTrajectory.segments.find(
			(candidate) => candidate.startTime <= time && candidate.endTime >= time
		);
		const supportVelocity = supportSegment
			? evaluateMotionSegmentVelocity(supportSegment, time)
			: ([0, 0] as Vec2);
		const offset: Vec2 = [
			movingPosition[0] - supportPosition[0],
			movingPosition[1] - supportPosition[1]
		];
		const distance = Math.hypot(...offset);
		const normal: Vec2 = distance > 0 ? [offset[0] / distance, offset[1] / distance] : [0, 0];
		const relativeVelocity: Vec2 = [
			movingVelocity[0] - supportVelocity[0],
			movingVelocity[1] - supportVelocity[1]
		];
		if (
			Math.abs(distance - expectedDistance) > stateTolerance(context) * 64 ||
			Math.abs(relativeVelocity[0] * normal[0] + relativeVelocity[1] * normal[1]) >
				stateTolerance(context) * 64
		) {
			fail(
				context,
				'NON_TANGENTIAL_CONSTRAINED_MOTION',
				'Dynamic-support geometry must remain touching with tangent relative velocity.',
				path,
				time,
				segment.bodyId
			);
			break;
		}
	}
}

function validateBoundaryOutcome(
	context: RunValidationContext,
	diagnostic: NonNullable<RunValidationContext['run']['diagnostics']['dynamicSupports']>[number],
	path: string
): void {
	const boundaryTime = diagnostic.interval[1];
	const component = context.run.contactComponents.find(
		({ id }) => id === diagnostic.anchoredComponentId
	);
	if (!component || !component.dynamicSupport) {
		fail(
			context,
			'MALFORMED_COMPONENT_MEMBERSHIP',
			'Dynamic-support evidence must resolve its complete anchored component.',
			path,
			boundaryTime,
			diagnostic.supportBodyId
		);
		return;
	}
	if (
		diagnostic.outcome === 'support-contact-released' &&
		(component.dissolvedAtTime === null ||
			Math.abs(component.dissolvedAtTime - boundaryTime) > timeTolerance(context))
	) {
		fail(
			context,
			'CONTACT_SET_MISMATCH',
			'Support loss must dissolve the certified component at the reported reaction boundary.',
			path,
			boundaryTime,
			diagnostic.supportBodyId
		);
	}
	if (diagnostic.outcome === 'interrupted') {
		const impact = context.run.contactComponents.some(
			(candidate) =>
				candidate.type === 'exact-time-impact' &&
				Math.abs(candidate.createdAtTime - boundaryTime) <= timeTolerance(context) &&
				candidate.bodyIds.includes(diagnostic.movingBodyId) &&
				candidate.bodyIds.includes(diagnostic.supportBodyId)
		);
		if (!impact) {
			fail(
				context,
				'INVALID_VALID_PREFIX',
				'An external interruption must rebuild an exact-time component containing the old support pair.',
				path,
				boundaryTime,
				diagnostic.movingBodyId
			);
		}
	}
	const stalePath = context.run.trajectories
		.find(({ bodyId }) => bodyId === diagnostic.movingBodyId)
		?.segments.some(
			(segment) =>
				segment.type === 'circular-contact' &&
				segment.supportingComponentId === diagnostic.anchoredComponentId &&
				segment.endTime > boundaryTime + timeTolerance(context)
		);
	if (stalePath) {
		fail(
			context,
			'PREFIX_AFTER_TERMINAL',
			'A fixed-centre dynamic-support path must not survive support loss or interruption.',
			path,
			boundaryTime,
			diagnostic.movingBodyId
		);
	}
}

function fail(
	context: RunValidationContext,
	code: Parameters<typeof reportRunValidationFailure>[2],
	message: string,
	path: string,
	time: number,
	bodyId: string
): void {
	reportRunValidationFailure(context, 'sustained-contact', code, message, {
		path,
		time,
		bodyId
	});
}
