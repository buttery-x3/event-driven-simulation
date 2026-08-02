import type { RunOutcome, RunTerminalReason, Vec2 } from '../../contracts';
import { dotVec2 } from '../../math';
import { evaluateMotionSegmentPosition } from '../../motion';
import { stateTolerance, timeTolerance } from '../history';
import { reportRunValidationFailure, type RunValidationContext } from '../results';

export function validateTerminalOutcome(context: RunValidationContext): void {
	const reason = context.run.terminalReason;
	const expectedOutcome = outcomeFor(reason);
	if (
		context.run.outcome !== expectedOutcome ||
		(context.run.validity === 'invalid') !== (context.run.outcome === 'invalid')
	) {
		fail(
			context,
			'OUTCOME_REASON_MISMATCH',
			'Validity, outcome and terminal reason must describe one terminal state.',
			{
				path: '$.outcome',
				time: reason.time ?? undefined
			}
		);
	}
	if (
		reason.time !== null &&
		Math.abs(context.run.diagnostics.simulatedUntilTime - reason.time) > timeTolerance(context)
	) {
		fail(
			context,
			'INVALID_VALID_PREFIX',
			'The certified prefix must end at the terminal boundary.',
			{
				path: '$.diagnostics.simulatedUntilTime',
				time: context.run.diagnostics.simulatedUntilTime
			}
		);
	}
	validateBoundaryReason(context, reason);
	validateLimitReason(context, reason);
	if (reason.type === 'resting-contact') validateRestingSupport(context, reason);
	if (
		reason.type === 'invalid-state' &&
		reason.time === null &&
		context.run.diagnostics.simulatedUntilTime !== 0
	) {
		fail(
			context,
			'INVALID_VALID_PREFIX',
			'An invalid run without a certified time may not expose a playable prefix.',
			{
				path: '$.diagnostics.simulatedUntilTime'
			}
		);
	}
}

function validateBoundaryReason(context: RunValidationContext, reason: RunTerminalReason): void {
	const position = terminalPosition(context);
	if (!position) return;
	const tolerance = stateTolerance(context);
	if (reason.type === 'completion-region' || reason.type === 'escape-region') {
		const region = context.submittedInput.scene.terminationRegions.find(
			({ id }) => id === reason.regionId
		);
		const purpose = reason.type === 'completion-region' ? 'complete' : 'escape';
		if (
			!region ||
			region.purpose !== purpose ||
			!insideBox(position, region.minimum, region.maximum, tolerance)
		) {
			fail(
				context,
				'TERMINAL_BOUNDARY_MISMATCH',
				`The terminal position must enter the declared ${purpose} region.`,
				{
					path: '$.terminalReason',
					time: reason.time,
					colliderId: reason.regionId
				}
			);
		}
	}
	if (reason.type === 'bounds-escape') {
		const bounds = context.submittedInput.scene.bounds;
		const coordinate = {
			left: position[0] + bounds.width / 2,
			right: position[0] - bounds.width / 2,
			bottom: position[1],
			top: position[1] - bounds.height
		}[reason.boundary];
		if (Math.abs(coordinate) > tolerance) {
			fail(
				context,
				'TERMINAL_BOUNDARY_MISMATCH',
				'The terminal position must lie on the declared scene boundary.',
				{
					path: '$.terminalReason.boundary',
					time: reason.time
				}
			);
		}
	}
}

function validateLimitReason(context: RunValidationContext, reason: RunTerminalReason): void {
	if (reason.type === 'time-limit') {
		if (
			reason.limit !== context.submittedInput.settings.maximumSimulationTime ||
			reason.time > reason.limit + timeTolerance(context) ||
			reason.limit - reason.time >
				context.submittedInput.settings.tolerances.eventTime + timeTolerance(context)
		) {
			fail(
				context,
				'LIMIT_MISMATCH',
				'A time-limit terminal state must agree with the submitted time limit.',
				{
					path: '$.terminalReason',
					time: reason.time
				}
			);
		}
	}
	if (reason.type === 'event-limit') {
		const contacts = context.run.events.filter(({ type }) => type === 'contact').length;
		if (reason.limit !== context.submittedInput.settings.maximumEvents || contacts < reason.limit) {
			fail(
				context,
				'LIMIT_MISMATCH',
				'An event-limit terminal state must agree with the submitted event limit.',
				{
					path: '$.terminalReason',
					time: reason.time
				}
			);
		}
	}
}

function validateRestingSupport(
	context: RunValidationContext,
	reason: Extract<RunTerminalReason, { type: 'resting-contact' }>
): void {
	const contacts = reason.contacts ?? [
		{
			colliderId: reason.colliderId,
			feature: 'recorded-primary',
			contactPoint: reason.position,
			normal: reason.normal,
			preImpactNormalVelocity: 0,
			postImpactNormalVelocity: 0,
			impulse: 0
		}
	];
	if (reason.supportReactions) {
		if (
			reason.supportReactions.length !== contacts.length ||
			reason.supportReactions.some((reaction) => reaction < -stateTolerance(context))
		) {
			fail(
				context,
				'INFEASIBLE_RESTING_SUPPORT',
				'Resting support reactions must be aligned and non-negative.',
				{
					path: '$.terminalReason.supportReactions',
					time: reason.time
				}
			);
			return;
		}
		const net = contacts.reduce<Vec2>(
			(sum, contact, index) => [
				sum[0] + contact.normal[0] * reason.supportReactions![index]!,
				sum[1] + contact.normal[1] * reason.supportReactions![index]!
			],
			context.submittedInput.settings.gravity
		);
		if (Math.hypot(...net) > stateTolerance(context) * 16) {
			fail(
				context,
				'INFEASIBLE_RESTING_SUPPORT',
				'Recorded reactions do not balance the pressing acceleration.',
				{
					path: '$.terminalReason.supportReactions',
					time: reason.time
				}
			);
		}
	} else if (
		!contacts.some(({ normal }) => dotVec2(context.submittedInput.settings.gravity, normal) < 0)
	) {
		fail(
			context,
			'INFEASIBLE_RESTING_SUPPORT',
			'A settled state needs support opposing the pressing acceleration.',
			{
				path: '$.terminalReason.normal',
				time: reason.time,
				colliderId: reason.colliderId
			}
		);
	}
}

function terminalPosition(context: RunValidationContext): Vec2 | null {
	const latest = context.run.trajectories
		.flatMap(({ segments }) => segments)
		.sort((left, right) => right.endTime - left.endTime)[0];
	if (latest) return evaluateMotionSegmentPosition(latest, latest.endTime);
	return context.submittedInput.initialDynamicBodies[0]?.position ?? null;
}

function insideBox(position: Vec2, minimum: Vec2, maximum: Vec2, tolerance: number): boolean {
	return (
		position[0] >= minimum[0] - tolerance &&
		position[0] <= maximum[0] + tolerance &&
		position[1] >= minimum[1] - tolerance &&
		position[1] <= maximum[1] + tolerance
	);
}

function outcomeFor(reason: RunTerminalReason): RunOutcome {
	switch (reason.type) {
		case 'completion-region':
			return 'exited';
		case 'escape-region':
		case 'bounds-escape':
			return 'escaped';
		case 'resting-contact':
			return 'settled';
		case 'no-future-event':
			return 'no-future-event';
		case 'time-limit':
			return 'time-limit';
		case 'event-limit':
			return 'event-limit';
		case 'unresolved-collision-search':
		case 'zero-time-loop':
		case 'numerical-failure':
			return 'unresolved';
		case 'invalid-state':
			return 'invalid';
	}
}

function fail(
	context: RunValidationContext,
	code: Parameters<typeof reportRunValidationFailure>[2],
	message: string,
	reference: Parameters<typeof reportRunValidationFailure>[4]
): void {
	reportRunValidationFailure(context, 'terminal-outcome', code, message, reference);
}
