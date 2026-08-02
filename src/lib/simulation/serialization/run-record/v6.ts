import type { SimulationRunRecord } from '../../contracts';
import { validateRunConsistencyV6 } from './v6-consistency';
import { validateRunRecordShapeV6 } from './v6-shape';

export function validateRunFixtureV6(value: unknown): SimulationRunRecord {
	const run = validateRunRecordShapeV6(value);
	validateRunConsistencyV6(run);
	return run;
}
