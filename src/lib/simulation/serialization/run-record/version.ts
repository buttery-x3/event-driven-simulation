import type { SimulationRunRecord } from '../../contracts';
import { RunFixtureError } from '../structural-validation';
import { validateRunFixtureV6 } from './v6';

export function loadSimulationRunFixture(value: unknown): SimulationRunRecord {
	if (isRecord(value)) {
		const contractVersion = value.contractVersion;

		if (typeof contractVersion === 'number' && contractVersion !== 6) {
			throw new RunFixtureError(
				'UNSUPPORTED_CONTRACT_VERSION',
				`Saved run fixture uses unsupported contract version ${contractVersion}; expected version 6.`,
				'$.contractVersion'
			);
		}
	}

	return validateRunFixtureV6(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
