import type {
	FailureContinuationPolicy,
	RunTerminalReason,
	SimulationInput
} from '../../../contracts';

const recoverableTypes = new Set<RunTerminalReason['type']>([
	'unsupported-body-body-response',
	'unresolved-collision-search',
	'zero-time-loop'
]);

export function failureContinuationPolicy(input: SimulationInput): FailureContinuationPolicy {
	return input.settings.failureContinuation ?? 'strict';
}

export function isFreezeAndContinue(input: SimulationInput): boolean {
	return failureContinuationPolicy(input) === 'freeze-and-continue';
}

export function isRecoverableFrontier(
	reason: RunTerminalReason,
	prefixesCommitted = false
): boolean {
	if (reason.time === null || !Number.isFinite(reason.time)) return false;
	if (reason.type === 'numerical-failure') return prefixesCommitted;
	return recoverableTypes.has(reason.type);
}
