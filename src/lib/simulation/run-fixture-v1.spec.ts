import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-synthetic-contact.json?raw';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV1 } from './run-fixture-v1';

describe('version 1 run fixture validation', () => {
	it('accepts the complete version 1 saved-run shape', () => {
		expect(validateRunFixtureV1(JSON.parse(canonicalFixtureJson)).status).toEqual({
			type: 'complete'
		});
	});

	it('reports the exact incompatible contract field', () => {
		const incompatible = JSON.parse(canonicalFixtureJson) as {
			input: { initialBodies: Array<{ radius?: number }> };
		};
		delete incompatible.input.initialBodies[0]!.radius;

		expect(() => validateRunFixtureV1(incompatible)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.input.initialBodies[0].radius'
			})
		);
	});
});
