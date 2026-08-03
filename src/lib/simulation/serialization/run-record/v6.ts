import type { RunDiagnostics, SimulationRunRecord } from '../../contracts';
import type { LegacySimulationInputV6 } from '../simulation-input/v6';
import { validateRunConsistencyV6 } from './v6-consistency';
import { validateRunRecordShapeV6 } from './v6-shape';

export type LegacySimulationRunRecordV6 = Omit<
	SimulationRunRecord,
	| 'contractVersion'
	| 'input'
	| 'bodyStates'
	| 'releases'
	| 'dynamicContacts'
	| 'contactComponents'
	| 'componentEvents'
	| 'diagnostics'
> & {
	readonly contractVersion: 6;
	readonly input: LegacySimulationInputV6;
	readonly diagnostics: Omit<RunDiagnostics, 'bodyEventHorizons' | 'pairPredictions'>;
};

export function validateRunFixtureV6(value: unknown): LegacySimulationRunRecordV6 {
	const run = validateRunRecordShapeV6(value);
	validateRunConsistencyV6(run);
	return run;
}
