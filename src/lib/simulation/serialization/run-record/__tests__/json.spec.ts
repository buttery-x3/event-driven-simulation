import { describe, expect, it } from 'vitest';
import { RunFixtureError } from '../error';
import { parseRunFixtureJson } from '../json';

describe('run fixture JSON parsing', () => {
	it('returns unknown parsed data without applying contract rules', () => {
		expect(parseRunFixtureJson('{"contractVersion":1}')).toEqual({ contractVersion: 1 });
	});

	it('reports malformed JSON as a typed fixture failure', () => {
		expect(() => parseRunFixtureJson('{ not-json')).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				name: 'RunFixtureError',
				code: 'MALFORMED_FIXTURE_JSON',
				path: null
			})
		);
	});
});
