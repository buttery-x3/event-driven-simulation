import type { SimulationInput } from './contracts';
import { parseRunFixtureJson } from './run-fixture-json';
import { RunFixtureError } from './run-fixture-error';
import { validateSimulationInputV5 } from './run-fixture-v5';
import { validateSingleBallInput } from './single-ball-run';

export interface SimulationInputFixture {
	readonly contractVersion: 5;
	readonly documentType: 'simulation-input';
	readonly input: SimulationInput;
}

export function serializeSimulationInputFixture(input: SimulationInput): string {
	return JSON.stringify(
		{
			contractVersion: 5,
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
	if (value.contractVersion !== 5) {
		throw new RunFixtureError(
			'UNSUPPORTED_CONTRACT_VERSION',
			`Scenario input fixture uses unsupported contract version ${String(value.contractVersion)}; expected version 5.`,
			'$.contractVersion'
		);
	}
	if (value.documentType !== 'simulation-input') {
		throw invalidInput(
			'Scenario input fixture field $.documentType must be "simulation-input".',
			'$.documentType'
		);
	}

	let input: SimulationInput;
	try {
		input = validateSimulationInputV5(value.input, '$.input');
	} catch (error) {
		if (error instanceof RunFixtureError) {
			throw invalidInput(error.message, error.path);
		}
		throw error;
	}

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
