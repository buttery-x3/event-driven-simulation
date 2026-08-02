import { RunFixtureError } from './error';

export function parseRunFixtureJson(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch (error) {
		throw new RunFixtureError(
			'MALFORMED_FIXTURE_JSON',
			'Saved run fixture is not valid JSON.',
			null,
			{ cause: error }
		);
	}
}
