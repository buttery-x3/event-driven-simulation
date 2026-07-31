import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-synthetic-contact.json?raw';
import type { RunStatus } from '$lib/simulation/contracts';
import { parseSimulationRunFixture } from '$lib/simulation/run-fixture';
import {
	formatRecordedSeconds,
	formatSource,
	getInspectionMode,
	getRunCounts,
	getSeverityCounts
} from './model';

describe('workbench run presentation model', () => {
	it.each([
		[{ type: 'complete' }, 'completed-replay'],
		[{ type: 'unresolved', reason: 'test' }, 'recorded-prefix'],
		[{ type: 'iteration-limited', reason: 'test' }, 'recorded-prefix'],
		[{ type: 'invalid', reason: 'test' }, 'diagnostics-only']
	] satisfies readonly (readonly [RunStatus, string])[])(
		'maps $type calculation status to its inspection mode',
		(status, expected) => {
			expect(getInspectionMode(status)).toBe(expected);
		}
	);

	it('derives counts and severity totals without changing the run', () => {
		const run = parseSimulationRunFixture(canonicalFixtureJson);
		const before = JSON.stringify(run);

		expect(getRunCounts(run)).toEqual({
			bodies: 1,
			colliders: 1,
			trajectories: 1,
			segments: 2,
			events: 1,
			diagnostics: 1
		});
		expect(getSeverityCounts(run)).toEqual({ info: 1, warning: 0, error: 0 });
		expect(JSON.stringify(run)).toBe(before);
	});

	it('keeps recorded timestamps and source provenance explicit', () => {
		expect(formatRecordedSeconds(0.123456789)).toBe('0.123456789 s');
		expect(formatSource({ kind: 'repository', id: 'canonical', name: 'run.json' })).toBe(
			'Repository fixture · run.json'
		);
		expect(formatSource({ kind: 'local', name: 'download.json' })).toBe(
			'Local file · download.json'
		);
	});
});
