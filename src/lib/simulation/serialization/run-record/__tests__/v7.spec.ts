import { describe, expect, it } from 'vitest';
import { RunFixtureError } from '..';
import { constructSingleBallRun } from '../../../run';
import { validateSimulationRun } from '../../../verification';
import { prototypeSimulationInput } from '../../../world';
import { loadSimulationRunFixture } from '../version';
import {
	bodyContactFixture,
	duplicateBodyIdsFixture,
	overlappingReleaseFixture,
	restingThenIncomingFixture,
	validMultiBodyContractFixtures
} from './multi-body-fixtures';

describe('version 7 multi-body contracts', () => {
	it('records mass without changing existing one-body fixed-world behaviour', () => {
		const heavierInput = structuredClone(prototypeSimulationInput);
		Object.assign(heavierInput.initialDynamicBodies[0]!, { mass: 25 });
		const baseline = constructSingleBallRun(prototypeSimulationInput);
		const heavier = constructSingleBallRun(heavierInput);

		expect(heavier.input.initialDynamicBodies[0]?.mass).toBe(25);
		expect({
			outcome: heavier.outcome,
			terminalReason: heavier.terminalReason,
			trajectories: heavier.trajectories,
			events: heavier.events
		}).toEqual({
			outcome: baseline.outcome,
			terminalReason: baseline.terminalReason,
			trajectories: baseline.trajectories,
			events: baseline.events
		});
	});

	it('round-trips every required valid synthetic history without losing identities or evidence', () => {
		for (const fixture of validMultiBodyContractFixtures) {
			const restored = loadSimulationRunFixture(JSON.parse(JSON.stringify(fixture)));
			expect(restored).toEqual(fixture);
		}
		expect(bodyContactFixture.dynamicContacts[0]?.participants).toEqual([
			{ type: 'body', bodyId: 'body-a' },
			{ type: 'body', bodyId: 'body-b' }
		]);
		expect(bodyContactFixture.diagnostics.pairPredictions[0]?.decision).toBe('selected');
		expect(bodyContactFixture.componentEvents.map(({ change }) => change)).toEqual([
			'created',
			'dissolved'
		]);
		expect(restingThenIncomingFixture.trajectories[0]?.segments[0]?.type).toBe('stationary');
		expect(restingThenIncomingFixture.contactComponents[0]?.bodyIds).toEqual(['body-a']);
	});

	it('rejects duplicate IDs and overlapping common-time releases with stable input paths', () => {
		for (const [fixture, path] of [
			[duplicateBodyIdsFixture, '$.input.initialDynamicBodies[1].id'],
			[overlappingReleaseFixture, '$.input.initialDynamicBodies[1].position']
		] as const) {
			expect(() => loadSimulationRunFixture(fixture)).toThrowError(
				expect.objectContaining<Partial<RunFixtureError>>({
					code: 'INVALID_RUN_RECORD',
					path
				})
			);
		}
	});

	it('reports the stable independent-validation categories for malformed multi-body data', () => {
		const duplicateRun = structuredClone(bodyContactFixture);
		Object.assign(duplicateRun.input.initialDynamicBodies[1]!, { id: 'body-a' });
		const duplicate = validateSimulationRun(duplicateRun.input, duplicateRun);
		expect(duplicate.failures.map(({ code }) => code)).toContain('DUPLICATE_BODY_ID');

		const overlapRun = structuredClone(bodyContactFixture);
		Object.assign(overlapRun.input.initialDynamicBodies[1]!, {
			position: overlapRun.input.initialDynamicBodies[0]!.position
		});
		const overlap = validateSimulationRun(overlapRun.input, overlapRun);
		expect(overlap.failures.map(({ code }) => code)).toContain('OVERLAPPING_RELEASE_STATE');
	});

	it.each([
		[
			'INVALID_BODY_MASS',
			(run: typeof bodyContactFixture) =>
				Object.assign(run.input.initialDynamicBodies[0]!, { mass: 0 })
		],
		[
			'INVALID_RELEASE_TIME',
			(run: typeof bodyContactFixture) =>
				Object.assign(run.input.initialDynamicBodies[0]!, { releaseTime: -1 })
		],
		[
			'UNRESOLVED_BODY_REFERENCE',
			(run: typeof bodyContactFixture) =>
				Object.assign(run.trajectories[0]!, { bodyId: 'missing-body' })
		],
		[
			'TRAJECTORY_OUTSIDE_BODY_LIFETIME',
			(run: typeof bodyContactFixture) =>
				Object.assign(run.trajectories[0]!.segments[0]!, { startTime: -1 })
		],
		[
			'BODY_WORLD_OUTCOME_MISMATCH',
			(run: typeof bodyContactFixture) => Object.assign(run, { outcome: 'exited' })
		],
		[
			'INVALID_CONTACT_PARTICIPANT',
			(run: typeof bodyContactFixture) =>
				Object.assign(run.dynamicContacts[0]!.participants[0]!, { bodyId: 'missing-body' })
		],
		[
			'NON_FINITE_MULTIBODY_DATA',
			(run: typeof bodyContactFixture) =>
				Object.assign(run.dynamicContacts[0]!, { time: Number.POSITIVE_INFINITY })
		]
	] as const)('emits %s for its malformed contract case', (expectedCode, mutate) => {
		const run = structuredClone(bodyContactFixture);
		mutate(run);
		expect(validateSimulationRun(run.input, run).failures.map(({ code }) => code)).toContain(
			expectedCode
		);
	});

	it('emits malformed component membership independently of contact physics', () => {
		const run = structuredClone(restingThenIncomingFixture);
		Object.assign(run.contactComponents[0]!, { bodyIds: ['missing-body'] });
		expect(validateSimulationRun(run.input, run).failures.map(({ code }) => code)).toContain(
			'MALFORMED_COMPONENT_MEMBERSHIP'
		);
	});
});
