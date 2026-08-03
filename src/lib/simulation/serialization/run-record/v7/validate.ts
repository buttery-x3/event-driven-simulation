import type { SimulationRunRecord } from '../../../contracts';
import { validateRunConsistencyV7 } from './consistency';
import { validateRunRecordShapeV7 } from './shape';

export function validateRunFixtureV7(value: unknown): SimulationRunRecord {
	const run = validateRunRecordShapeV7(value);
	validateRunConsistencyV7(run);
	return run;
}
