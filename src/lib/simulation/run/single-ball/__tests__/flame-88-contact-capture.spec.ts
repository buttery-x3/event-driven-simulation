import { describe, expect, it } from 'vitest';
import type { SimulationInput, StaticCollider, Vec2 } from '../../../contracts';
import { constructSingleBallRun } from '../construct';

describe('FLAME-88 fixed-world contact capture', () => {
	it('captures a low-normal, high-tangent floor impact without erasing tangent motion', () => {
		const run = constructSingleBallRun(input([0.1, 0.1], [8, -1e-3], [floor()]));
		const capture = captures(run)[0];
		const sliding = run.trajectories[0]!.segments.find(
			(segment) => segment.type === 'linear-contact'
		);

		expect(capture).toMatchObject({
			selectedEndpoint: 'captured',
			meaningfulReboundVeto: false,
			retainedContactIds: ['floor:segment-face-positive']
		});
		expect(sliding).toMatchObject({ startVelocity: [8, 0], supportingColliderId: 'floor' });
	});

	it('keeps an energetic floor impact on the ordinary restitution endpoint', () => {
		const run = constructSingleBallRun(input([0, 0.1], [0, -2], [floor()]));
		const capture = captures(run)[0];

		expect(capture).toMatchObject({
			selectedEndpoint: 'ordinary',
			meaningfulReboundVeto: true,
			meaningfulReboundContactIds: ['floor:segment-face-positive']
		});
		expect(run.events[0]).toMatchObject({ postContactVelocity: [0, 1.6] });
	});

	it('preserves a complete corner bounce before a distinct later floor capture', () => {
		const run = constructSingleBallRun(input([0.1, 0.1], [-2, -1e-3], [floor(), leftWall()]));
		const decisions = captures(run);

		expect(decisions[0]).toMatchObject({
			selectedEndpoint: 'ordinary',
			meaningfulReboundVeto: true,
			meaningfulReboundContactIds: ['left-wall:segment-face-negative']
		});
		expect(decisions.slice(1)).toContainEqual(
			expect.objectContaining({
				selectedEndpoint: 'captured',
				retainedContactIds: ['floor:segment-face-positive']
			})
		);
		const contactTimes = run.events
			.filter(({ type }) => type === 'contact')
			.map(({ time }) => time);
		expect(contactTimes[1]).toBeGreaterThan(contactTimes[0]!);
	});
});

function captures(run: ReturnType<typeof constructSingleBallRun>) {
	return run.diagnostics.contactSearches.flatMap(({ contactCapture }) =>
		contactCapture ? [contactCapture] : []
	);
}

function input(
	position: Vec2,
	velocity: Vec2,
	staticColliders: readonly StaticCollider[]
): SimulationInput {
	return {
		scene: {
			id: 'flame-88-fixed-world',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 20, height: 10 },
			staticColliders,
			terminationRegions: []
		},
		initialDynamicBodies: [
			{
				id: 'ball',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius: 0.1 },
				mass: 1,
				position,
				velocity,
				releaseTime: 0
			}
		],
		settings: {
			gravity: [0, -10],
			restitution: 0.8,
			contactCaptureDistance: 1e-6,
			maximumEvents: 30,
			maximumSimulationTime: 0.25,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function floor(): StaticCollider {
	return line('floor', [-5, 0], [5, 0]);
}

function leftWall(): StaticCollider {
	return line('left-wall', [0, 0], [0, 5]);
}

function line(id: string, start: Vec2, end: Vec2): StaticCollider {
	return { id, motionAuthority: 'static', physicalShape: { type: 'line-segment', start, end } };
}
