import type {
	DiagnosticEntry,
	MotionSegment,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	RunValidity,
	SimulationInput,
	SimulationRunRecord
} from '../../contracts';
import { getRunOutcome } from '../outcome';
import { bodyOrNull, toTerminalDiagnostic } from './diagnostics';
import type { ImpactObservation } from './impact-response';
import type { SustainedContactResult } from './sustained-contact';

export interface RunAssembly {
	readonly wallTimeStart: number;
	readonly input: SimulationInput;
	readonly segments: MotionSegment[];
	readonly events: SimulationRunRecord['events'][number][];
	readonly entries: DiagnosticEntry[];
	readonly contactSearches: RunContactSearchDiagnostic[];
	readonly impactHistory: ImpactObservation[];
}

export function createRunAssembly(input: SimulationInput): RunAssembly {
	return {
		wallTimeStart: Date.now(),
		input,
		segments: [],
		events: [],
		entries: [],
		contactSearches: [],
		impactHistory: []
	};
}

export function appendSustainedContact(
	assembly: RunAssembly,
	continuation: SustainedContactResult
): void {
	assembly.segments.push(...continuation.segments);
	assembly.events.push(...continuation.events);
	assembly.contactSearches.push(...continuation.contactSearches);
	for (const transition of continuation.events) {
		assembly.entries.push({
			severity: transition.reason === 'unresolved' ? 'error' : 'info',
			code: 'CONTACT_MODE_TRANSITION',
			message: `${transition.from} -> ${transition.to} on ${transition.colliderId}: ${transition.reason}.`,
			time: transition.time,
			bodyId: transition.bodyId
		});
	}
}

export function finishRun(
	assembly: RunAssembly,
	validity: RunValidity,
	terminalReason: RunTerminalReason,
	simulatedUntilTime: number
): SimulationRunRecord {
	const outcome = getRunOutcome(terminalReason);
	assembly.entries.push(toTerminalDiagnostic(outcome, terminalReason, bodyOrNull(assembly.input)));
	const candidateCount = assembly.contactSearches.reduce(
		(total, search) => total + search.candidates.length,
		0
	);
	return {
		contractVersion: 6,
		input: assembly.input,
		validity,
		outcome,
		terminalReason,
		trajectories:
			assembly.input.initialDynamicBodies.length === 1
				? [{ bodyId: assembly.input.initialDynamicBodies[0]!.id, segments: assembly.segments }]
				: [],
		events: assembly.events,
		diagnostics: {
			iterations: assembly.contactSearches.length,
			simulatedUntilTime,
			eventCount: assembly.events.length,
			candidateCount,
			segmentCount: assembly.segments.length,
			simulationWallTimeMilliseconds: Math.max(0, Date.now() - assembly.wallTimeStart),
			contactSearches: assembly.contactSearches,
			entries: assembly.entries
		}
	};
}

export function contactEventCount(assembly: RunAssembly): number {
	return assembly.events.filter((event) => event.type === 'contact').length;
}
