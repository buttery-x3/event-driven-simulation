import type { SimulationRunRecord } from '../../contracts';
import { RunFixtureError } from './error';
import { validateRunFixtureV5 } from './v5';

export function loadSimulationRunFixture(value: unknown): SimulationRunRecord {
	if (isRecord(value)) {
		const contractVersion = value.contractVersion;

		if (typeof contractVersion === 'number' && contractVersion !== 5) {
			throw new RunFixtureError(
				'UNSUPPORTED_CONTRACT_VERSION',
				`Saved run fixture uses unsupported contract version ${contractVersion}; expected version 5.`,
				'$.contractVersion'
			);
		}
	}

	return validateRunFixtureV5(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
