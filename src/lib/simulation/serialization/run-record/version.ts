import type { SimulationRunRecord } from '../../contracts';
import { RunFixtureError } from '../structural-validation';
import { validateRunFixtureV6 } from './v6';
import { migrateRunFixtureV6, validateRunFixtureV7 } from './v7';

export function loadSimulationRunFixture(value: unknown): SimulationRunRecord {
	if (isRecord(value)) {
		const contractVersion = value.contractVersion;

		if (contractVersion === 6) return migrateRunFixtureV6(validateRunFixtureV6(value));
		if (contractVersion === 7) return validateRunFixtureV7(value);
		if (typeof contractVersion === 'number') {
			throw new RunFixtureError(
				'UNSUPPORTED_CONTRACT_VERSION',
				`Saved run fixture uses unsupported contract version ${contractVersion}; expected version 6 or 7.`,
				'$.contractVersion'
			);
		}
	}

	return validateRunFixtureV7(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
