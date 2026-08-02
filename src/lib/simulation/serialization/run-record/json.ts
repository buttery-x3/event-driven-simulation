import { RunFixtureError } from '../structural-validation';

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
