import { describe, expect, it } from 'vitest';
import { constructSingleBallRun } from '../../../run';
import { validateSimulationRun } from '../../../verification';
import { defaultCanonicalPlinkoScenario } from '../../../world';
import { createDiagnosticExport, serializeDiagnosticExport } from '..';

const exportedAt = '2026-08-02T11:23:27.123Z';

describe('diagnostic export v1', () => {
	it('preserves a successful run and its raw contact-search evidence', () => {
		const run = constructSingleBallRun(defaultCanonicalPlinkoScenario.input);
		const validation = validateSimulationRun(defaultCanonicalPlinkoScenario.input, run);
		const bundle = createDiagnosticExport(
			run,
			{
				exportedAt,
				runId: 'run-123',
				scenarioId: defaultCanonicalPlinkoScenario.id,
				descriptiveName: defaultCanonicalPlinkoScenario.name,
				source: { kind: 'simulation', name: defaultCanonicalPlinkoScenario.name }
			},
			validation
		);
		const parsed = JSON.parse(serializeDiagnosticExport(bundle));
		const selectedSearch = run.diagnostics.contactSearches.find(
			(search) => search.selectedColliderId !== null
		);
		const selectedCandidate = selectedSearch?.candidates.find(
			(candidate) => candidate.colliderId === selectedSearch.selectedColliderId
		);

		expect(selectedSearch).toBeDefined();
		expect(selectedSearch).toMatchObject({
			searchInterval: expect.any(Array),
			eventTimeTolerance: run.input.settings.tolerances.eventTime,
			outcome: 'contact',
			selectedColliderId: expect.any(String)
		});
		expect(selectedCandidate).toMatchObject({
			timeDelta: expect.any(Number),
			contactPoint: expect.any(Array),
			normal: expect.any(Array),
			preContactVelocity: expect.any(Array),
			postContactVelocity: expect.any(Array),
			nearSimultaneous: expect.any(Boolean)
		});
		expect(parsed).toMatchObject({
			kind: 'simulation-diagnostic-export',
			schemaVersion: 1,
			provenance: {
				exportedAt,
				runId: 'run-123',
				scenarioId: defaultCanonicalPlinkoScenario.id,
				sceneId: run.input.scene.id
			},
			summary: {
				validity: run.validity,
				authoritativeValidity: run.validity,
				independentValidationPassed: true,
				outcome: run.outcome,
				simulatedUntilTime: run.diagnostics.simulatedUntilTime,
				playableUntilTime: run.diagnostics.simulatedUntilTime
			}
		});
		expect(parsed.submittedInput).toEqual(run.input);
		expect(parsed.authoritativeRun.trajectories).toEqual(run.trajectories);
		expect(parsed.authoritativeRun.events).toEqual(run.events);
		expect(parsed.independentValidation).toEqual(validation);
		expect(parsed.diagnostics.contactSearches).toEqual(run.diagnostics.contactSearches);
		expect(parsed.diagnostics.entries).toEqual(run.diagnostics.entries);
		expect(
			parsed.diagnostics.contactSearches.find(
				(search: { selectedColliderId: string | null }) =>
					search.selectedColliderId === selectedSearch?.selectedColliderId
			)
		).toEqual(selectedSearch);
	});

	it('retains the valid prefix and terminal search evidence for an incomplete run', () => {
		const input = {
			...defaultCanonicalPlinkoScenario.input,
			settings: {
				...defaultCanonicalPlinkoScenario.input.settings,
				maximumSimulationTime: 0.1
			}
		};
		const run = constructSingleBallRun(input);
		const bundle = createDiagnosticExport(run, { exportedAt }, validateSimulationRun(input, run));
		const terminalSearch = run.diagnostics.contactSearches.at(-1);

		expect(run.outcome).toBe('time-limit');
		expect(terminalSearch).toMatchObject({
			searchInterval: [0, 0.1],
			outcome: 'no-event'
		});
		expect(bundle.summary.validPrefix).toEqual({
			untilTime: run.diagnostics.simulatedUntilTime,
			trajectorySegmentCount: run.trajectories[0]?.segments.length ?? 0,
			eventCount: run.events.length
		});
		expect(bundle.summary.terminalReason).toEqual(run.terminalReason);
		expect(bundle.diagnostics.contactSearches.at(-1)).toEqual(terminalSearch);
		expect(bundle.diagnostics.entries.at(-1)).toMatchObject({
			severity: 'warning',
			code: 'RUN_TIME_LIMIT',
			time: 0.1
		});
	});

	it('presents a failed independent validation as invalid without rewriting solver authority', () => {
		const run = constructSingleBallRun(defaultCanonicalPlinkoScenario.input);
		const failure = {
			valid: false,
			checkedCategories: ['collision-free-interval'],
			failures: [
				{
					category: 'collision-free-interval',
					code: 'EARLY_GEOMETRY_CROSSING',
					message: 'A committed free-flight interval visibly crosses fixed-world geometry.',
					reference: { path: '$.trajectories[0].segments[0]', time: 1, colliderId: 'peg' }
				}
			]
		};
		const bundle = createDiagnosticExport(run, { exportedAt }, failure);

		expect(bundle.summary).toMatchObject({
			validity: 'invalid',
			authoritativeValidity: 'valid',
			independentValidationPassed: false
		});
		expect(bundle.authoritativeRun).toMatchObject({
			validity: run.validity,
			outcome: run.outcome,
			terminalReason: run.terminalReason
		});
		expect(bundle.independentValidation).toEqual(failure);
	});
});
