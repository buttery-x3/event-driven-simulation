import type { SimulationRunRecord } from './contracts';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV4 } from './run-fixture-v4';

export function loadSimulationRunFixture(value: unknown): SimulationRunRecord {
	if (isRecord(value)) {
		const contractVersion = value.contractVersion;

		if (typeof contractVersion === 'number' && contractVersion !== 4) {
			throw new RunFixtureError(
				'UNSUPPORTED_CONTRACT_VERSION',
				`Saved run fixture uses unsupported contract version ${contractVersion}; expected version 4.`,
				'$.contractVersion'
			);
		}
	}

	return validateRunFixtureV4(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
