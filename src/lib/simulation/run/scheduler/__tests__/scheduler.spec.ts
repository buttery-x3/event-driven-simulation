import { describe, expect, it } from 'vitest';
import type {
	AxisAlignedTerminationRegion,
	InitialDynamicCircleBodyState,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../../contracts';
import { validateSimulationRun } from '../../../verification';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { prototypeSimulationInput } from '../../../world';
import { constructSingleBallRun } from '../../single-ball';
import { constructSimulationRun } from '../construct';

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

describe('monotonic independent-body scheduler', () => {
	it('retains an unrelated free-flight prediction across a staggered release', () => {
		const run = constructSimulationRun(
			input([body('long-flight', [-4, 3], [1, 0], 0), body('later-fast-flight', [3, 6], [2, 0], 1)])
		);
		const longFlight = trajectory(run, 'long-flight');

		expect(run).toMatchObject({ validity: 'valid', outcome: 'escaped' });
		expect(longFlight.segments).toHaveLength(1);
		expect(longFlight.segments[0]).toMatchObject({ startTime: 0, endTime: 14 });
		expect(run.diagnostics.schedulerSteps).toContainEqual(
			expect.objectContaining({
				worldTime: 1,
				bodyId: 'later-fast-flight',
				eventType: 'release',
				retainedBodyIds: ['long-flight']
			})
		);
		expect(validateSimulationRun(run.input, run).failures).toEqual([]);
	});

	it('processes simultaneous independent events identically for reversed body arrays', () => {
		const bodies = [body('left', [-2, 4], [-2, 0], 0), body('right', [2, 7], [2, 0], 0)] as const;
		const baseline = constructSimulationRun(input(bodies));
		const reversed = constructSimulationRun(input([...bodies].reverse()));

		expect(physicalSummary(reversed)).toEqual(physicalSummary(baseline));
		expect(
			baseline.diagnostics.schedulerSteps?.filter(({ eventType }) => eventType === 'termination')
		).toEqual([
			expect.objectContaining({ worldTime: 4, bodyId: 'left' }),
			expect.objectContaining({ worldTime: 4, bodyId: 'right' })
		]);
	});

	it('keeps a resting body covered while a future release continues', () => {
		const run = constructSimulationRun(
			input([body('resting', [-3, 2], [0, 0], 0), body('later', [2, 4], [2, 0], 2)], {
				gravity: [0, -10],
				restitution: 0,
				colliders: [floor(-4, -2)]
			})
		);
		const resting = trajectory(run, 'resting');
		const stationary = resting.segments.filter(({ type }) => type === 'stationary');

		expect(run.bodyStates.find(({ bodyId }) => bodyId === 'resting')).toMatchObject({
			lifecycle: 'resting',
			recordedUntilTime: run.diagnostics.simulatedUntilTime
		});
		expect(stationary).toHaveLength(1);
		expect(stationary[0]!.endTime).toBe(run.diagnostics.simulatedUntilTime);
		expect(run.releases.find(({ bodyId }) => bodyId === 'later')?.time).toBe(2);
		expect(validateSimulationRun(run.input, run).failures).toEqual([]);
	});

	it('fails conservatively when a later release overlaps a present body', () => {
		const run = constructSimulationRun(
			input([body('present', [0, 3], [0, 0], 0), body('overlap', [0.1, 3], [0, 0], 1)], {
				gravity: [0, 0]
			})
		);

		expect(run).toMatchObject({
			validity: 'invalid',
			outcome: 'invalid',
			terminalReason: { type: 'invalid-state', time: 1 }
		});
		expect(run.releases.find(({ bodyId }) => bodyId === 'overlap')).toMatchObject({
			status: 'rejected'
		});
	});

	it('represents completed, escaped and resting bodies separately from the world outcome', () => {
		const run = constructSimulationRun(
			input(
				[
					body('completed', [-4, 9], [2, 0], 0),
					body('escaped', [4, 7], [2, 0], 0),
					body('resting', [0, 2], [0, 0], 0)
				],
				{
					gravity: [0, -10],
					restitution: 0,
					colliders: [floor(-1, 1)],
					regions: [region('complete-left', 'complete', [-2.1, 3], [-1.9, 5])]
				}
			)
		);
		const lifecycles = Object.fromEntries(
			run.bodyStates.map(({ bodyId, lifecycle }) => [bodyId, lifecycle])
		);

		expect(run).toMatchObject({
			validity: 'valid',
			outcome: 'settled',
			terminalReason: { type: 'world-complete', outcome: 'settled' }
		});
		expect(lifecycles).toEqual({ completed: 'completed', escaped: 'escaped', resting: 'resting' });
		expect(validateSimulationRun(run.input, run).failures).toEqual([]);
		expect(JSON.stringify(parseSimulationRunFixture(JSON.stringify(run)))).toBe(
			JSON.stringify(run)
		);
	});

	it('routes the compatibility one-body API through the same scheduler authority', () => {
		const scheduled = constructSimulationRun(prototypeSimulationInput);
		const compatibility = constructSingleBallRun(prototypeSimulationInput);

		expect({
			trajectories: compatibility.trajectories,
			events: compatibility.events,
			outcome: compatibility.outcome,
			terminalReason: compatibility.terminalReason
		}).toEqual({
			trajectories: scheduled.trajectories,
			events: scheduled.events,
			outcome: scheduled.outcome,
			terminalReason: scheduled.terminalReason
		});
		expect(compatibility.trajectories[0]?.segments).toHaveLength(
			scheduled.trajectories[0]!.segments.length
		);
	});
});

function input(
	bodies: readonly InitialDynamicCircleBodyState[],
	overrides: {
		readonly gravity?: Vec2;
		readonly restitution?: number;
		readonly colliders?: readonly StaticCollider[];
		readonly regions?: readonly AxisAlignedTerminationRegion[];
	} = {}
): SimulationInput {
	return {
		scene: {
			id: 'scheduler-test-scene',
			coordinateSystem,
			bounds: { width: 20, height: 10 },
			staticColliders: overrides.colliders ?? [],
			terminationRegions: overrides.regions ?? []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity: overrides.gravity ?? [0, 0],
			restitution: overrides.restitution ?? 0.5,
			maximumEvents: 100,
			maximumSimulationTime: 20,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function body(id: string, position: Vec2, velocity: Vec2, releaseTime: number) {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.25 },
		mass: 1,
		position,
		velocity,
		releaseTime
	} as const satisfies InitialDynamicCircleBodyState;
}

function floor(startX: number, endX: number): StaticCollider {
	return {
		id: `floor-${startX}-${endX}`,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [startX, 0], end: [endX, 0] }
	};
}

function region(
	id: string,
	purpose: AxisAlignedTerminationRegion['purpose'],
	minimum: Vec2,
	maximum: Vec2
): AxisAlignedTerminationRegion {
	return { id, type: 'axis-aligned-box', purpose, minimum, maximum };
}

function trajectory(run: ReturnType<typeof constructSimulationRun>, bodyId: string) {
	return run.trajectories.find((candidate) => candidate.bodyId === bodyId)!;
}

function physicalSummary(run: ReturnType<typeof constructSimulationRun>) {
	return {
		outcome: run.outcome,
		bodyStates: run.bodyStates,
		trajectories: run.trajectories,
		events: run.events,
		releases: run.releases
	};
}
