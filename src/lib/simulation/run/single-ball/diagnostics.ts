import type {
	DiagnosticEntry,
	InitialDynamicCircleBodyState,
	MotionSegment,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	SimulationInput,
	SimulationRunRecord,
	Vec2
} from '../../contracts';
import type {
	FixedWorldContactDiagnostics,
	FixedWorldContactQueryResult
} from '../../collision';
import { dotVec2 } from '../../math';
import { evaluateMotionSegmentVelocity } from '../../motion';
import { getTerminalDiagnosticCode } from '../outcome';

export function toRunContactSearchDiagnostic(
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

export function toTerminalDiagnostic(
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

export function bodyOrNull(input: SimulationInput): InitialDynamicCircleBodyState | null {
	return input.initialDynamicBodies.length === 1 ? input.initialDynamicBodies[0]! : null;
}

function normalizeDiagnosticVector(vector: Vec2): Vec2 {
	return [normalizeDiagnosticNumber(vector[0]), normalizeDiagnosticNumber(vector[1])];
}

function normalizeDiagnosticNumber(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
