import { describe, expect, it } from 'vitest';
import type { BodyTrajectory, SimulationInput } from './contracts';
import {
	evaluateBodyTrajectory,
	evaluateMotionSegment,
	generateSyntheticRun
} from './synthetic-run';

const input = {
	scene: {
		id: 'synthetic-test-scene',
		fixedCircles: [{ id: 'test-peg', centre: [1, 0.55], radius: 0.25 }]
	},
	initialBodies: [
		{
			id: 'test-ball',
			position: [0, 2],
			velocity: [1, 0],
			radius: 0.2
		}
	],
	settings: {
		gravity: [0, -2],
		restitution: 0.5,
		maximumEvents: 1,
		maximumSimulationTime: 2,
		tolerances: {
			contactDistance: 1e-9,
			eventTime: 1e-9
		}
	}
} as const satisfies SimulationInput;

describe('synthetic headless run', () => {
	it('evaluates known positions at segment starts, intermediate times and ends', () => {
		const trajectory = completedTrajectory();
		const [firstSegment, secondSegment] = trajectory.segments;

		expect(firstSegment).toBeDefined();
		expect(secondSegment).toBeDefined();
		expect(evaluateMotionSegment(firstSegment!, 0)).toEqual([0, 2]);
		expect(evaluateMotionSegment(firstSegment!, 0.5)).toEqual([0.5, 1.75]);
		expect(evaluateMotionSegment(firstSegment!, 1)).toEqual([1, 1]);
		expect(evaluateMotionSegment(secondSegment!, 1)).toEqual([1, 1]);
		expect(evaluateMotionSegment(secondSegment!, 1.5)).toEqual([1.5, 1.25]);
		expect(evaluateMotionSegment(secondSegment!, 2)).toEqual([2, 1]);
	});

	it('evaluates a trajectory only across its inclusive simulation-time range', () => {
		const trajectory = completedTrajectory();

		expect(evaluateBodyTrajectory(trajectory, -input.settings.tolerances.eventTime)).toBeNull();
		expect(evaluateBodyTrajectory(trajectory, 0)).toEqual([0, 2]);
		expect(evaluateBodyTrajectory(trajectory, 1)).toEqual([1, 1]);
		expect(evaluateBodyTrajectory(trajectory, 2)).toEqual([2, 1]);
		expect(
			evaluateBodyTrajectory(
				trajectory,
				input.settings.maximumSimulationTime + input.settings.tolerances.eventTime
			)
		).toBeNull();
	});

	it('joins adjacent segments continuously within the configured contact tolerance', () => {
		const trajectory = completedTrajectory();
		const [firstSegment, secondSegment] = trajectory.segments;
		const firstEnd = evaluateMotionSegment(firstSegment!, firstSegment!.endTime);
		const secondStart = evaluateMotionSegment(secondSegment!, secondSegment!.startTime);
		const joinDistance = Math.hypot(firstEnd[0] - secondStart[0], firstEnd[1] - secondStart[1]);

		expect(joinDistance).toBeLessThanOrEqual(input.settings.tolerances.contactDistance);
	});

	it('produces an ordered, complete and diagnostic-rich serialisable run', () => {
		const run = generateSyntheticRun(input);
		const trajectory = run.trajectories[0];
		const eventTimes = run.events.map((event) => event.time);
		const orderedEventTimes = [...eventTimes].sort((left, right) => left - right);

		expect(run.status).toEqual({ type: 'complete' });
		expect(run.diagnostics).toEqual({
			iterations: 1,
			simulatedUntilTime: input.settings.maximumSimulationTime,
			entries: [
				{
					severity: 'info',
					code: 'SYNTHETIC_CONTACT_GENERATED',
					message: 'Generated the configured synthetic trajectory and representative contact.',
					time: 1,
					bodyId: 'test-ball'
				}
			]
		});
		expect(trajectory).toBeDefined();
		expect(trajectory!.segments).toHaveLength(2);
		expect(trajectory!.segments[0]!.startTime).toBe(0);
		expect(trajectory!.segments[0]!.endTime).toBe(trajectory!.segments[1]!.startTime);
		expect(trajectory!.segments[1]!.endTime).toBe(input.settings.maximumSimulationTime);
		expect(eventTimes).toEqual(orderedEventTimes);
		expect(run.events).toEqual([
			{
				type: 'contact',
				time: 1,
				bodyId: 'test-ball',
				colliderId: 'test-peg',
				position: [1, 1],
				normal: [0, 1]
			}
		]);
		expect(JSON.parse(JSON.stringify(run))).toEqual(run);
	});

	it('runs without browser globals', () => {
		expect('window' in globalThis).toBe(false);
		expect('document' in globalThis).toBe(false);
		expect(generateSyntheticRun(input).status.type).toBe('complete');
	});
});

function completedTrajectory(): BodyTrajectory {
	const run = generateSyntheticRun(input);

	expect(run.status.type).toBe('complete');
	expect(run.trajectories[0]).toBeDefined();

	return run.trajectories[0]!;
}
