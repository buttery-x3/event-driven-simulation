import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-synthetic-contact.json?raw';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV3 } from './run-fixture-v3';

describe('version 3 run fixture validation', () => {
	it('accepts the complete version 3 saved-run shape', () => {
		expect(validateRunFixtureV3(JSON.parse(canonicalFixtureJson)).status).toEqual({
			type: 'complete'
		});
	});

	it('reports the exact incompatible contract field', () => {
		const incompatible = JSON.parse(canonicalFixtureJson) as {
			input: {
				initialDynamicBodies: Array<{ physicalShape: { radius?: number } }>;
			};
		};
		delete incompatible.input.initialDynamicBodies[0]!.physicalShape.radius;

		expect(() => validateRunFixtureV3(incompatible)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.input.initialDynamicBodies[0].physicalShape.radius'
			})
		);
	});
});
