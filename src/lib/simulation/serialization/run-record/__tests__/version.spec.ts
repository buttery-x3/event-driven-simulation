import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../../../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
import { RunFixtureError } from '..';
import { loadSimulationRunFixture } from '../version';

describe('run fixture contract-version dispatch', () => {
	it('migrates contract version 6 through its validator', () => {
		expect(loadSimulationRunFixture(JSON.parse(canonicalFixtureJson)).contractVersion).toBe(7);
	});

	it('rejects a recognized numeric version without an implementation', () => {
		const unsupported = {
			...JSON.parse(canonicalFixtureJson),
			contractVersion: 1
		};

		expect(() => loadSimulationRunFixture(unsupported)).toThrowError(
			expect.objectContaining<Partial<RunFixtureError>>({
				code: 'UNSUPPORTED_CONTRACT_VERSION',
				path: '$.contractVersion'
			})
		);
	});
});
