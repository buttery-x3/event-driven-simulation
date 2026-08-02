import type { SimulationInput, SimulationRunRecord } from '../contracts';
import { deepEqual, validateRecordIntegrity, validateTemporalContinuity } from './history';
import {
	validateCollisionFreeIntervals,
	validateContactDynamics,
	validateContactGeometry,
	validateTerminalOutcome
} from './physics';
import {
	reportRunValidationFailure,
	runValidationCategories,
	type RunValidationContext,
	type RunValidationResult
} from './results';

export function validateSimulationRun(
	submittedInput: SimulationInput,
	run: SimulationRunRecord
): RunValidationResult {
	const context: RunValidationContext = { submittedInput, run, failures: [] };
	validateRecordIntegrity(context);
	validateTemporalContinuity(context);
	validateContactGeometry(context);
	validateCollisionFreeIntervals(context);
	validateContactDynamics(context);
	validateTerminalOutcome(context);
	validateSerializationConsistency(context);
	return {
		valid: context.failures.length === 0,
		checkedCategories: runValidationCategories,
		failures: context.failures
	};
}

function validateSerializationConsistency(context: RunValidationContext): void {
	let restored: unknown;
	try {
		restored = JSON.parse(JSON.stringify(context.run));
	} catch {
		restored = null;
	}
	if (!deepEqual(context.run, restored)) {
		reportRunValidationFailure(
			context,
			'serialization-consistency',
			'SERIALIZATION_CHANGED_RECORD',
			'Supported JSON serialization must preserve the complete authoritative run record.',
			{ path: '$' }
		);
	}
}
