import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
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
		['valid', 'exited', 'completed-replay'],
		['valid', 'event-limit', 'recorded-prefix'],
		['invalid', 'invalid', 'diagnostics-only']
	] as const)(
		'maps $0/$1 calculation result to its inspection mode',
		(validity, outcome, expected) => {
			expect(getInspectionMode(validity, outcome)).toBe(expected);
		}
	);

	it('derives counts and severity totals without changing the run', () => {
		const run = parseSimulationRunFixture(canonicalFixtureJson);
		const before = JSON.stringify(run);

		expect(getRunCounts(run)).toEqual({
			bodies: 1,
			colliders: 66,
			trajectories: 1,
			segments: run.diagnostics.segmentCount,
			events: run.diagnostics.eventCount,
			diagnostics: run.diagnostics.entries.length
		});
		expect(getSeverityCounts(run)).toEqual({
			info: run.diagnostics.entries.length,
			warning: 0,
			error: 0
		});
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
