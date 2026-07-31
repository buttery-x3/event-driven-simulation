import type { SimulationInput, SimulationRunRecord } from './contracts';
import { constructSingleBallRun } from './single-ball-run';

/**
 * @deprecated Use `constructSingleBallRun`. Kept temporarily for callers that still use the
 * milestone-one producer name.
 */
export function generateSyntheticRun(input: SimulationInput): SimulationRunRecord {
	return constructSingleBallRun(input);
}
