export type RunFixtureErrorCode =
	'MALFORMED_FIXTURE_JSON' | 'UNSUPPORTED_CONTRACT_VERSION' | 'INVALID_RUN_RECORD';

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
