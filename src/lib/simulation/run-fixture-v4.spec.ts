import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV4 } from './run-fixture-v4';

describe('version 4 run fixture validation', () => {
	it('accepts the complete version 4 saved-run shape', () => {
		expect(validateRunFixtureV4(JSON.parse(canonicalFixtureJson)).terminalReason.type).toBe(
			'completion-region'
		);
	});

	it('reports the exact incompatible contract field', () => {
		const incompatible = JSON.parse(canonicalFixtureJson) as {
			input: {
				initialDynamicBodies: Array<{ physicalShape: { radius?: number } }>;
			};
		};
		delete incompatible.input.initialDynamicBodies[0]!.physicalShape.radius;

		expect(() => validateRunFixtureV4(incompatible)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.input.initialDynamicBodies[0].physicalShape.radius'
			})
		);
	});
});
