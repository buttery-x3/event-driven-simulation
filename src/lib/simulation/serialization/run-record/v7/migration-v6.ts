import type { BodyRunState, SimulationRunRecord } from '../../../contracts';
import { migrateSimulationInputV6 } from '../../simulation-input/fixture';
import type { LegacySimulationRunRecordV6 } from '../v6';

export function migrateRunFixtureV6(run: LegacySimulationRunRecordV6): SimulationRunRecord {
	const input = migrateSimulationInputV6(run.input);
	return {
		...run,
		contractVersion: 7,
		input,
		bodyStates: input.initialDynamicBodies.map((body) =>
			bodyState(body.id, run.outcome, run.terminalReason.time)
		),
		releases: input.initialDynamicBodies.map((body) => ({
			type: 'body-release' as const,
			time: 0,
			bodyId: body.id,
			position: body.position,
			velocity: body.velocity,
			status: run.validity === 'invalid' ? ('rejected' as const) : ('released' as const),
			reason: run.validity === 'invalid' ? run.terminalReason.type : null
		})),
		dynamicContacts: [],
		contactComponents: [],
		componentEvents: [],
		diagnostics: {
			...run.diagnostics,
			bodyEventHorizons: [],
			pairPredictions: []
		}
	};
}

function bodyState(
	bodyId: string,
	outcome: LegacySimulationRunRecordV6['outcome'],
	time: number | null
): BodyRunState {
	if (outcome === 'exited') return terminal(bodyId, 'completed', time);
	if (outcome === 'escaped') return terminal(bodyId, 'escaped', time);
	if (outcome === 'invalid')
		return time === null
			? {
					bodyId,
					lifecycle: 'invalid',
					releaseTime: 0,
					activeFromTime: null,
					recordedUntilTime: null,
					terminalOutcome: 'invalid'
				}
			: terminal(bodyId, 'invalid', time);
	if (outcome === 'settled' || outcome === 'no-future-event')
		return {
			bodyId,
			lifecycle: 'resting',
			releaseTime: 0,
			activeFromTime: 0,
			recordedUntilTime: time,
			terminalOutcome: null
		};
	return terminal(bodyId, 'unresolved', time);
}

function terminal(
	bodyId: string,
	lifecycle: 'completed' | 'escaped' | 'invalid' | 'unresolved',
	time: number | null
): BodyRunState {
	if (time === null) throw new Error('Released legacy body terminal time must be available.');
	return {
		bodyId,
		lifecycle,
		releaseTime: 0,
		activeFromTime: 0,
		recordedUntilTime: time,
		terminalOutcome: lifecycle
	};
}
