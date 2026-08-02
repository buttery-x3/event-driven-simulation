import type { SimulationInput } from '../../contracts';
import { parseRunFixtureJson } from '../run-record/json';
import { validateSingleBallInput } from '../../run';
import { RunFixtureError } from '../structural-validation';
import { validateSimulationInputV6 } from './v6';

export interface SimulationInputFixture {
	readonly contractVersion: 6;
	readonly documentType: 'simulation-input';
	readonly input: SimulationInput;
}

export function serializeSimulationInputFixture(input: SimulationInput): string {
	return JSON.stringify(
		{
			contractVersion: 6,
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
	if (value.contractVersion !== 6) {
		throw new RunFixtureError(
			'UNSUPPORTED_CONTRACT_VERSION',
			`Scenario input fixture uses unsupported contract version ${String(value.contractVersion)}; expected version 6.`,
			'$.contractVersion'
		);
	}
	if (value.documentType !== 'simulation-input') {
		throw invalidInput(
			'Scenario input fixture field $.documentType must be "simulation-input".',
			'$.documentType'
		);
	}

	const input = validateSimulationInputV6(value.input, '$.input');

	const diagnostic = validateSingleBallInput(input)[0];
	if (diagnostic) {
		throw invalidInput(
			`Scenario input field ${diagnostic.path} is invalid: ${diagnostic.message}`,
			diagnostic.path
		);
	}

	return input;
}

function invalidInput(message: string, path: string | null): RunFixtureError {
	return new RunFixtureError('INVALID_SIMULATION_INPUT', message, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
