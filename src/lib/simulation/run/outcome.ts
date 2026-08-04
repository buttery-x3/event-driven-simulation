import type { RunOutcome, RunTerminalReason, RunValidity } from '../contracts';

export function getRunOutcome(reason: RunTerminalReason): RunOutcome {
	switch (reason.type) {
		case 'world-complete':
			return reason.outcome;
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
		case 'unsupported-body-body-response':
		case 'zero-time-loop':
		case 'numerical-failure':
			return 'unresolved';
		case 'invalid-state':
			return 'invalid';
	}
}

export function isCompleteRunOutcome(outcome: RunOutcome): boolean {
	return outcome === 'exited' || outcome === 'settled';
}

export function isOutcomeConsistentWithValidity(
	outcome: RunOutcome,
	validity: RunValidity
): boolean {
	return validity === 'invalid' ? outcome === 'invalid' : outcome !== 'invalid';
}

export function getTerminalDiagnosticCode(outcome: RunOutcome): string {
	return `RUN_${outcome.replaceAll('-', '_').toUpperCase()}`;
}
