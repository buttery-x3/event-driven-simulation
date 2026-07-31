import type { SimulationRunRecord } from './contracts';
import { parseRunFixtureJson } from './run-fixture-json';
import { loadSimulationRunFixture } from './run-fixture-version';

export { RunFixtureError, type RunFixtureErrorCode } from './run-fixture-error';
export { loadSimulationRunFixture } from './run-fixture-version';

export function parseSimulationRunFixture(json: string): SimulationRunRecord {
	return loadSimulationRunFixture(parseRunFixtureJson(json));
}
