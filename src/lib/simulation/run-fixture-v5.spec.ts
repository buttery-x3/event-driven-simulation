import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
import { RunFixtureError } from './run-fixture-error';
import { validateRunFixtureV5 } from './run-fixture-v5';

describe('version 5 run fixture validation', () => {
	it('accepts the complete version 5 saved-run shape', () => {
		expect(validateRunFixtureV5(JSON.parse(canonicalFixtureJson)).terminalReason.type).toBe(
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

		expect(() => validateRunFixtureV5(incompatible)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.input.initialDynamicBodies[0].physicalShape.radius'
			})
		);
	});

	it('rejects a deliberately mislabelled outcome', () => {
		const mislabelled = JSON.parse(canonicalFixtureJson) as { outcome: string };
		mislabelled.outcome = 'settled';

		expect(() => validateRunFixtureV5(mislabelled)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.outcome'
			})
		);
	});

	it('rejects terminal diagnostics that disagree with the outcome', () => {
		const misdiagnosed = JSON.parse(canonicalFixtureJson) as {
			diagnostics: { entries: Array<{ code: string }> };
		};
		misdiagnosed.diagnostics.entries.at(-1)!.code = 'RUN_SETTLED';

		expect(() => validateRunFixtureV5(misdiagnosed)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.diagnostics.entries'
			})
		);
	});
});
