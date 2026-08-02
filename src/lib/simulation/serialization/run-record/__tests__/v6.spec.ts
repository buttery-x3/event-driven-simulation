import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../../../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
import { RunFixtureError } from '..';
import { validateRunFixtureV6 } from '../v6';
import { validateRunConsistencyV6 } from '../v6-consistency';
import { validateRunRecordShapeV6 } from '../v6-shape';

describe('version 6 run fixture validation', () => {
	it('accepts the complete version 6 saved-run shape', () => {
		expect(validateRunFixtureV6(JSON.parse(canonicalFixtureJson)).terminalReason.type).toBe(
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

		expect(() => validateRunFixtureV6(incompatible)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.input.initialDynamicBodies[0].physicalShape.radius'
			})
		);
	});

	it('rejects a deliberately mislabelled outcome', () => {
		const mislabelled = JSON.parse(canonicalFixtureJson) as { outcome: string };
		mislabelled.outcome = 'settled';

		expect(() => validateRunFixtureV6(mislabelled)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.outcome'
			})
		);
	});

	it('keeps structural validation independent from cross-field run consistency', () => {
		const mislabelled = JSON.parse(canonicalFixtureJson) as { outcome: string };
		mislabelled.outcome = 'settled';

		const structurallyValid = validateRunRecordShapeV6(mislabelled);
		expect(() => validateRunConsistencyV6(structurallyValid)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.outcome'
			})
		);
	});

	it('treats terminal references as run consistency rather than primitive shape', () => {
		const missingReference = JSON.parse(canonicalFixtureJson) as {
			terminalReason: { regionId: string };
		};
		missingReference.terminalReason.regionId = 'missing-region';

		const structurallyValid = validateRunRecordShapeV6(missingReference);
		expect(() => validateRunConsistencyV6(structurallyValid)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				path: '$.terminalReason.regionId'
			})
		);
	});

	it('rejects terminal diagnostics that disagree with the outcome', () => {
		const misdiagnosed = JSON.parse(canonicalFixtureJson) as {
			diagnostics: { entries: Array<{ code: string }> };
		};
		misdiagnosed.diagnostics.entries.at(-1)!.code = 'RUN_SETTLED';

		expect(() => validateRunFixtureV6(misdiagnosed)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'INVALID_RUN_RECORD',
				path: '$.diagnostics.entries'
			})
		);
	});
});
