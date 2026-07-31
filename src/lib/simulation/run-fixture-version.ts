import type { SimulationRunRecord } from './contracts';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV1 } from './run-fixture-v1';

export function loadSimulationRunFixture(value: unknown): SimulationRunRecord {
	if (isRecord(value)) {
		const contractVersion = value.contractVersion;

		if (typeof contractVersion === 'number' && contractVersion !== 1) {
			throw new RunFixtureError(
				'UNSUPPORTED_CONTRACT_VERSION',
				`Saved run fixture uses unsupported contract version ${contractVersion}; expected version 1.`,
				'$.contractVersion'
			);
		}
	}

	return validateRunFixtureV1(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
