import { describe, expect, it } from 'vitest';
import type { SimulationInput, StaticCollider, Vec2 } from '../../../contracts';
import { REPRESENTED_MOTION_SPEED } from '../../contact-resolution';
import { constructSingleBallRun } from '../construct';

describe('FLAME-105 represented fixed-contact retention', () => {
	it('retains a vertical wall after a sub-resolution rebound with meaningful tangent', () => {
		const run = constructSingleBallRun(
			input({
				position: [0.1, 2],
				velocity: [-0.04, -1],
				restitution: 0.2,
				colliders: [leftWall()]
			})
		);
		const contact = firstContact(run);
		const sliding = run.trajectories[0]!.segments.find(
			(segment) => segment.type === 'linear-contact'
		);

		expect(contact.contacts[0]!.preImpactNormalVelocity).toBeCloseTo(-0.04, 12);
		expect(contact.contacts[0]!.postImpactNormalVelocity).toBeCloseTo(0.008, 12);
		expect(Math.abs(contact.contacts[0]!.preImpactNormalVelocity)).toBeGreaterThan(
			REPRESENTED_MOTION_SPEED
		);
		expect(Math.abs(contact.contacts[0]!.postImpactNormalVelocity)).toBeLessThanOrEqual(
			REPRESENTED_MOTION_SPEED
		);
		expect(contact.postContactVelocity).toEqual([
			expect.closeTo(0.008, 12),
			expect.closeTo(-1, 12)
		]);
		expect(sliding).toMatchObject({
			type: 'linear-contact',
			supportingColliderId: 'left-wall',
			startVelocity: [expect.closeTo(0, 12), expect.closeTo(-1, 12)]
		});
		expect(
			run.trajectories[0]!.segments.filter((segment) => segment.type === 'free-flight')
		).toHaveLength(0);
		expect(captures(run)[0]).toMatchObject({
			selectedEndpoint: 'ordinary',
			releasedContactIds: [expect.stringMatching(/^left-wall:/)]
		});
	});

	it('keeps a vertical wall rebound above represented-motion resolution in free flight', () => {
		const run = constructSingleBallRun(
			input({
				position: [0.1, 2],
				velocity: [-0.1, -1],
				restitution: 0.2,
				colliders: [leftWall()]
			})
		);
		const contact = firstContact(run);

		expect(contact.contacts[0]!.postImpactNormalVelocity).toBeCloseTo(0.02, 12);
		expect(Math.abs(contact.contacts[0]!.postImpactNormalVelocity)).toBeGreaterThan(
			REPRESENTED_MOTION_SPEED
		);
		expect(contact.postContactVelocity?.[0]).toBeCloseTo(0.02, 12);
		expect(contact.postContactVelocity?.[1]).toBeCloseTo(-1, 12);
		expect(run.trajectories[0]!.segments[0]).toMatchObject({ type: 'free-flight' });
		expect(
			run.trajectories[0]!.segments.some(
				(segment) =>
					segment.type === 'linear-contact' && segment.supportingColliderId === 'left-wall'
			)
		).toBe(false);
	});

	it('applies the same sub-resolution rule to a horizontal floor without capture', () => {
		const run = constructSingleBallRun(
			input({
				position: [0, 0.1],
				velocity: [8, -0.04],
				restitution: 0.2,
				colliders: [floor()]
			})
		);
		const contact = firstContact(run);
		const sliding = run.trajectories[0]!.segments.find(
			(segment) => segment.type === 'linear-contact'
		);

		expect(contact.contacts[0]!.postImpactNormalVelocity).toBeCloseTo(0.008, 12);
		expect(contact.postContactVelocity).toEqual([expect.closeTo(8, 12), expect.closeTo(0.008, 12)]);
		expect(sliding).toMatchObject({
			type: 'linear-contact',
			supportingColliderId: 'floor',
			startVelocity: [expect.closeTo(8, 12), expect.closeTo(0, 12)]
		});
	});

	it('keeps an energetic floor rebound in free flight under the same generic rule', () => {
		const run = constructSingleBallRun(
			input({
				position: [0, 0.1],
				velocity: [0, -2],
				restitution: 0.8,
				colliders: [floor()]
			})
		);
		const contact = firstContact(run);

		expect(contact.postContactVelocity).toEqual([0, expect.closeTo(1.6, 12)]);
		expect(run.trajectories[0]!.segments[0]).toMatchObject({ type: 'free-flight' });
	});

	it('suppresses sub-resolution normal rebound on a sloped line and keeps tangent motion', () => {
		const normal: Vec2 = [-1 / Math.SQRT2, 1 / Math.SQRT2];
		const down: Vec2 = [-1 / Math.SQRT2, -1 / Math.SQRT2];
		const incoming: Vec2 = [-0.04 * normal[0] + 0.8 * down[0], -0.04 * normal[1] + 0.8 * down[1]];
		const run = constructSingleBallRun(
			input({
				position: [1 + 0.1 * normal[0], 1 + 0.1 * normal[1]],
				velocity: incoming,
				restitution: 0.2,
				colliders: [slope()]
			})
		);
		const contact = firstContact(run);
		const sliding = run.trajectories[0]!.segments.find(
			(segment) => segment.type === 'linear-contact'
		);
		const represented: Vec2 = [0.8 * down[0], 0.8 * down[1]];

		expect(contact.contacts[0]!.postImpactNormalVelocity).toBeCloseTo(0.008, 8);
		expect(contact.postContactVelocity?.[0]).toBeCloseTo(incoming[0] + 0.048 * normal[0], 8);
		expect(contact.postContactVelocity?.[1]).toBeCloseTo(incoming[1] + 0.048 * normal[1], 8);
		expect(sliding).toMatchObject({
			type: 'linear-contact',
			supportingColliderId: 'slope'
		});
		expect(sliding?.startVelocity[0]).toBeCloseTo(represented[0], 8);
		expect(sliding?.startVelocity[1]).toBeCloseTo(represented[1], 8);
		expect(sliding?.acceleration[0]).not.toBeCloseTo(0, 6);
		expect(sliding?.acceleration[1]).not.toBeCloseTo(0, 6);
	});

	it('enters circular sustained contact for a valid sub-resolution peg continuation', () => {
		const run = constructSingleBallRun(
			input({
				position: [0, 0.6],
				velocity: [0.8, -0.04],
				restitution: 0.2,
				colliders: [peg()]
			})
		);
		const contact = firstContact(run);
		const circling = run.trajectories[0]!.segments.find(
			(segment) => segment.type === 'circular-contact'
		);

		expect(contact.contacts[0]!.postImpactNormalVelocity).toBeCloseTo(0.008, 12);
		expect(contact.postContactVelocity?.[0]).toBeCloseTo(0.8, 12);
		expect(contact.postContactVelocity?.[1]).toBeCloseTo(0.008, 12);
		expect(circling).toMatchObject({
			type: 'circular-contact',
			supportingColliderId: 'peg',
			startTangentialSpeed: expect.closeTo(0.8, 12)
		});
	});

	it('keeps an existing floor slide when a later wall rebound is above represented resolution', () => {
		const run = constructSingleBallRun(
			input({
				position: [0.3, 0.1],
				velocity: [2, -0.04],
				restitution: 0.2,
				colliders: [floor(), line('right-wall', [1, 0], [1, 5])],
				maximumSimulationTime: 0.5
			})
		);
		const wallEvent = run.events.find(
			(event) => event.type === 'contact' && event.colliderId === 'right-wall'
		);
		const sliding = run.trajectories[0]!.segments.filter(
			(segment) => segment.type === 'linear-contact' && segment.supportingColliderId === 'floor'
		);

		expect(wallEvent).toMatchObject({
			type: 'contact',
			colliderId: 'right-wall'
		});
		const wallContacts = wallEvent && 'contacts' in wallEvent ? wallEvent.contacts : undefined;
		expect(
			wallContacts?.some(
				(contact) =>
					contact.colliderId === 'right-wall' &&
					Math.abs(contact.postImpactNormalVelocity) > REPRESENTED_MOTION_SPEED
			)
		).toBe(true);
		expect(sliding.length).toBeGreaterThan(1);
		expect(sliding.some((segment) => segment.startTime > 0 && segment.startVelocity[0] < 0)).toBe(
			true
		);
		expect(run.trajectories[0]!.segments.at(-1)).toMatchObject({
			type: 'linear-contact',
			supportingColliderId: 'floor'
		});
	});

	it('releases a peg contact whose existing circular mechanics cannot support continuation', () => {
		const run = constructSingleBallRun(
			input({
				position: [0.6, 0],
				velocity: [-0.04, 0.8],
				restitution: 0.2,
				colliders: [peg()]
			})
		);
		const contact = firstContact(run);

		expect(contact.contacts[0]!.postImpactNormalVelocity).toBeCloseTo(0.008, 12);
		expect(
			run.trajectories[0]!.segments.some(
				(segment) => segment.type === 'circular-contact' && segment.supportingColliderId === 'peg'
			)
		).toBe(false);
		expect(run.trajectories[0]!.segments[0]).toMatchObject({ type: 'free-flight' });
		expect(contact.postContactVelocity?.[0]).toBeCloseTo(0.008, 12);
		expect(contact.postContactVelocity?.[1]).toBeCloseTo(0.8, 12);
	});
});

function firstContact(run: ReturnType<typeof constructSingleBallRun>) {
	const event = run.events.find((candidate) => candidate.type === 'contact');
	expect(event?.type).toBe('contact');
	expect(event && 'contacts' in event ? event.contacts : undefined).toBeDefined();
	return event as Extract<(typeof run.events)[number], { readonly type: 'contact' }> & {
		readonly contacts: NonNullable<
			Extract<(typeof run.events)[number], { readonly type: 'contact' }>['contacts']
		>;
	};
}

function captures(run: ReturnType<typeof constructSingleBallRun>) {
	return run.diagnostics.contactSearches.flatMap(({ contactCapture }) =>
		contactCapture ? [contactCapture] : []
	);
}

function input({
	position,
	velocity,
	restitution,
	colliders,
	maximumSimulationTime = 0.2
}: {
	position: Vec2;
	velocity: Vec2;
	restitution: number;
	colliders: readonly StaticCollider[];
	maximumSimulationTime?: number;
}): SimulationInput {
	return {
		scene: {
			id: 'flame-105-fixed-contact',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 20, height: 10 },
			staticColliders: colliders,
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
			restitution,
			contactCaptureDistance: 1e-9,
			maximumEvents: 20,
			maximumSimulationTime,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function leftWall(): StaticCollider {
	return line('left-wall', [0, 0], [0, 5]);
}

function floor(): StaticCollider {
	return line('floor', [-5, 0], [5, 0]);
}

function slope(): StaticCollider {
	return line('slope', [0, 0], [4, 4]);
}

function peg(): StaticCollider {
	return {
		id: 'peg',
		motionAuthority: 'static',
		physicalShape: { type: 'circle', radius: 0.5 },
		centre: [0, 0]
	};
}

function line(id: string, start: Vec2, end: Vec2): StaticCollider {
	return { id, motionAuthority: 'static', physicalShape: { type: 'line-segment', start, end } };
}
