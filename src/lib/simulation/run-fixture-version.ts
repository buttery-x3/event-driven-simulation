import type { SimulationRunRecord } from './contracts';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV2 } from './run-fixture-v2';

export function loadSimulationRunFixture(value: unknown): SimulationRunRecord {
	if (isRecord(value)) {
		const contractVersion = value.contractVersion;

		if (typeof contractVersion === 'number' && contractVersion !== 2) {
			throw new RunFixtureError(
				'UNSUPPORTED_CONTRACT_VERSION',
				`Saved run fixture uses unsupported contract version ${contractVersion}; expected version 2.`,
				'$.contractVersion'
			);
		}
	}

	return validateRunFixtureV2(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
