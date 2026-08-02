import type { SimulationRunRecord } from '../../contracts';
import { parseRunFixtureJson } from './json';
import { loadSimulationRunFixture } from './version';

export function parseSimulationRunFixture(json: string): SimulationRunRecord {
	return loadSimulationRunFixture(parseRunFixtureJson(json));
}
