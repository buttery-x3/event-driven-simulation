import type {
	DiagnosticEntry,
	ImpactSolveDiagnostic,
	MotionSegment,
	RunContactSearchDiagnostic,
	RunTerminalReason,
	RunValidity,
	SimulationInput,
	SimulationRunRecord
} from '../../contracts';
import { getRunOutcome } from '../outcome';
import { bodyOrNull, toTerminalDiagnostic } from './diagnostics';
import type { ImpactObservation } from './impact';
import type { SustainedContactResult } from './sustained-contact';

export interface RunAssembly {
	readonly wallTimeStart: number;
	readonly input: SimulationInput;
	readonly segments: MotionSegment[];
	readonly events: SimulationRunRecord['events'][number][];
	readonly entries: DiagnosticEntry[];
	readonly contactSearches: RunContactSearchDiagnostic[];
	readonly impactHistory: ImpactObservation[];
	readonly impactSolves: ImpactSolveDiagnostic[];
}

export function createRunAssembly(input: SimulationInput): RunAssembly {
	return {
		wallTimeStart: Date.now(),
		input,
		segments: [],
		events: [],
		entries: [],
		contactSearches: [],
		impactHistory: [],
		impactSolves: []
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
		contractVersion: 7,
		input: assembly.input,
		validity,
		outcome,
		terminalReason,
		bodyStates: bodyOrNull(assembly.input)
			? [toBodyRunState(assembly.input.initialDynamicBodies[0]!.id, outcome, simulatedUntilTime)]
			: [],
		trajectories:
			assembly.input.initialDynamicBodies.length === 1
				? [{ bodyId: assembly.input.initialDynamicBodies[0]!.id, segments: assembly.segments }]
				: [],
		events: assembly.events,
		releases: bodyOrNull(assembly.input)
			? [
					{
						type: 'body-release',
						time: 0,
						bodyId: assembly.input.initialDynamicBodies[0]!.id,
						position: assembly.input.initialDynamicBodies[0]!.position,
						velocity: assembly.input.initialDynamicBodies[0]!.velocity,
						status: validity === 'invalid' ? 'rejected' : 'released',
						reason: validity === 'invalid' ? terminalReason.type : null
					}
				]
			: [],
		dynamicContacts: [],
		contactComponents: [],
		componentEvents: [],
		diagnostics: {
			iterations: assembly.contactSearches.length,
			simulatedUntilTime,
			eventCount: assembly.events.length,
			candidateCount,
			segmentCount: assembly.segments.length,
			simulationWallTimeMilliseconds: Math.max(0, Date.now() - assembly.wallTimeStart),
			contactSearches: assembly.contactSearches,
			bodyEventHorizons: [],
			pairPredictions: [],
			impactSolves: assembly.impactSolves,
			entries: assembly.entries
		}
	};
}

function toBodyRunState(
	bodyId: string,
	outcome: ReturnType<typeof getRunOutcome>,
	recordedUntilTime: number
): SimulationRunRecord['bodyStates'][number] {
	if (outcome === 'exited') {
		return {
			bodyId,
			lifecycle: 'completed',
			releaseTime: 0,
			activeFromTime: 0,
			recordedUntilTime,
			terminalOutcome: 'completed'
		};
	}
	if (outcome === 'escaped') {
		return {
			bodyId,
			lifecycle: 'escaped',
			releaseTime: 0,
			activeFromTime: 0,
			recordedUntilTime,
			terminalOutcome: 'escaped'
		};
	}
	if (outcome === 'settled' || outcome === 'no-future-event') {
		return {
			bodyId,
			lifecycle: 'resting',
			releaseTime: 0,
			activeFromTime: 0,
			recordedUntilTime,
			terminalOutcome: null
		};
	}
	const terminalOutcome = outcome === 'invalid' ? 'invalid' : 'unresolved';
	return {
		bodyId,
		lifecycle: terminalOutcome,
		releaseTime: 0,
		activeFromTime: outcome === 'invalid' ? null : 0,
		recordedUntilTime: outcome === 'invalid' ? null : recordedUntilTime,
		terminalOutcome
	};
}

export function contactEventCount(assembly: RunAssembly): number {
	return assembly.events.filter((event) => event.type === 'contact').length;
}
