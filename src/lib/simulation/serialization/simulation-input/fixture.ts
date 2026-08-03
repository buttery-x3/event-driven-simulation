import type { SimulationInput } from '../../contracts';
import { parseRunFixtureJson } from '../run-record/json';
import { RunFixtureError } from '../structural-validation';
import { validateSimulationInputV6, type LegacySimulationInputV6 } from './v6';
import { validateSimulationInputV7 } from './v7';

export interface SimulationInputFixture {
	readonly contractVersion: 7;
	readonly documentType: 'simulation-input';
	readonly input: SimulationInput;
}

export function serializeSimulationInputFixture(input: SimulationInput): string {
	return JSON.stringify(
		{
			contractVersion: 7,
			documentType: 'simulation-input',
			input
		} satisfies SimulationInputFixture,
		null,
		2
	);
}

export function parseSimulationInputFixture(json: string): SimulationInput {
	const value = parseRunFixtureJson(json);
	if (!isRecord(value)) {
		throw invalidInput('Scenario input fixture must be an object.', '$');
	}
	if (value.contractVersion !== 6 && value.contractVersion !== 7) {
		throw new RunFixtureError(
			'UNSUPPORTED_CONTRACT_VERSION',
			`Scenario input fixture uses unsupported contract version ${String(value.contractVersion)}; expected version 6 or 7.`,
			'$.contractVersion'
		);
	}
	if (value.documentType !== 'simulation-input') {
		throw invalidInput(
			'Scenario input fixture field $.documentType must be "simulation-input".',
			'$.documentType'
		);
	}

	return value.contractVersion === 6
		? validateSimulationInputV7(
				migrateSimulationInputV6(validateSimulationInputV6(value.input, '$.input')),
				'$.input'
			)
		: validateSimulationInputV7(value.input, '$.input');
}

export function migrateSimulationInputV6(input: LegacySimulationInputV6): SimulationInput {
	return {
		...input,
		initialDynamicBodies: input.initialDynamicBodies.map((body) => ({
			...body,
			mass: 1,
			releaseTime: 0
		}))
	};
}

function invalidInput(message: string, path: string | null): RunFixtureError {
	return new RunFixtureError('INVALID_SIMULATION_INPUT', message, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
