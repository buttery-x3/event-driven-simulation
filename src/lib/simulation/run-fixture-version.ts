import type { SimulationRunRecord } from './contracts';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV3 } from './run-fixture-v3';

export function loadSimulationRunFixture(value: unknown): SimulationRunRecord {
	if (isRecord(value)) {
		const contractVersion = value.contractVersion;

		if (typeof contractVersion === 'number' && contractVersion !== 3) {
			throw new RunFixtureError(
				'UNSUPPORTED_CONTRACT_VERSION',
				`Saved run fixture uses unsupported contract version ${contractVersion}; expected version 3.`,
				'$.contractVersion'
			);
		}
	}

	return validateRunFixtureV3(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
