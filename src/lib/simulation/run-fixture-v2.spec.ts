import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-synthetic-contact.json?raw';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV2 } from './run-fixture-v2';

describe('version 2 run fixture validation', () => {
	it('accepts the complete version 2 saved-run shape', () => {
		expect(validateRunFixtureV2(JSON.parse(canonicalFixtureJson)).status).toEqual({
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

		expect(() => validateRunFixtureV2(incompatible)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.input.initialDynamicBodies[0].physicalShape.radius'
			})
		);
	});
});
