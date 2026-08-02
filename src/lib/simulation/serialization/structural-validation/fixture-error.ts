export type RunFixtureErrorCode =
	| 'MALFORMED_FIXTURE_JSON'
	| 'UNSUPPORTED_CONTRACT_VERSION'
	| 'INVALID_RUN_RECORD'
	| 'INVALID_SIMULATION_INPUT';

export class RunFixtureError extends Error {
	public readonly name = 'RunFixtureError';

	public constructor(
		public readonly code: RunFixtureErrorCode,
		message: string,
		public readonly path: string | null = null,
		options?: ErrorOptions
	) {
		super(message, options);
	}
}

export function invalidRunRecordField(path: string, requirement: string): never {
	throw new RunFixtureError(
		'INVALID_RUN_RECORD',
		`Saved run fixture field ${path} ${requirement}.`,
		path
	);
}

export function invalidSimulationInputField(path: string, requirement: string): never {
	throw new RunFixtureError(
		'INVALID_SIMULATION_INPUT',
		`Scenario input fixture field ${path} ${requirement}.`,
		path
	);
}
