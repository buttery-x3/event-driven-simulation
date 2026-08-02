import { describe, expect, it } from 'vitest';
import canonicalFixtureJson from '../../../fixtures/runs/canonical-event-driven-offset-drop.json?raw';
import { parseSimulationRunFixture } from '$lib/simulation/serialization/run-record';
import {
	createDiagnosticExportFilename,
	formatRecordedSeconds,
	formatSource,
	getInspectionMode,
	getRunCounts,
	getSeverityCounts,
	toRunValidationDiagnosticEntries
} from './model';

describe('workbench run presentation model', () => {
	it('builds a readable collision-resistant diagnostic export filename', () => {
		expect(
			createDiagnosticExportFilename(
				'Canonical Event-Driven Offset Drop.json',
				'2026-08-02T11:23:27.123Z'
			)
		).toBe('canonical-event-driven-offset-drop-diagnostics-20260802T112327123Z.json');
	});

	it.each([
		['valid', 'exited', 'completed-replay'],
		['valid', 'event-limit', 'recorded-prefix'],
		['invalid', 'invalid', 'invalid-prefix']
	] as const)(
		'maps $0/$1 calculation result to its inspection mode',
		(validity, outcome, expected) => {
			expect(getInspectionMode(validity, outcome)).toBe(expected);
		}
	);

	it('marks independently rejected solver histories invalid and exposes structured failures', () => {
		expect(getInspectionMode('valid', 'exited', false)).toBe('invalid-prefix');
		expect(
			toRunValidationDiagnosticEntries({
				valid: false,
				checkedCategories: ['collision-free-interval'],
				failures: [
					{
						category: 'collision-free-interval',
						code: 'EARLY_GEOMETRY_CROSSING',
						message: 'A committed free-flight interval visibly crosses fixed-world geometry.',
						reference: {
							path: '$.trajectories[0].segments[1]',
							time: 2,
							bodyId: 'ball',
							colliderId: 'peg'
						}
					}
				]
			})
		).toEqual([
			expect.objectContaining({
				severity: 'error',
				code: 'RUN_VALIDATION_EARLY_GEOMETRY_CROSSING',
				time: 2,
				bodyId: 'ball',
				message: expect.stringContaining('collider peg')
			})
		]);
	});

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
		expect(formatSource({ kind: 'simulation', name: 'Offset drop' })).toBe(
			'Calculated scenario · Offset drop'
		);
	});
});
