import { describe, expect, it } from 'vitest';
import type {
	AxisAlignedTerminationRegion,
	SceneDefinition,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../../contracts';
import { toRendererPlaybackInput } from '$lib/rendering/playback';
import { canonicalPlinkoScenarios } from '../../../world';
import { constructSingleBallRun } from '../construct';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../../motion';

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

function input({
	position = [0, 2],
	velocity = [0, 0],
	gravity = [0, -10],
	restitution = 0.5,
	colliders = [],
	regions = [],
	maximumEvents = 20,
	maximumSimulationTime = 5
}: {
	position?: Vec2;
	velocity?: Vec2;
	gravity?: Vec2;
	restitution?: number;
	colliders?: readonly StaticCollider[];
	regions?: readonly AxisAlignedTerminationRegion[];
	maximumEvents?: number;
	maximumSimulationTime?: number;
} = {}): SimulationInput {
	const scene: SceneDefinition = {
		id: 'test-scene',
		coordinateSystem,
		bounds: { width: 10, height: 10 },
		staticColliders: colliders,
		terminationRegions: regions
	};

	return {
		scene,
		initialDynamicBodies: [
			{
				id: 'ball',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius: 0.1 },
				position,
				velocity
			}
		],
		settings: {
			gravity,
			restitution,
			maximumEvents,
			maximumSimulationTime,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function floor(y = 0): StaticCollider {
	return {
		id: 'floor',
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [-5, y], end: [5, y] }
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

describe('authoritative event-driven single-ball runs', () => {
	it('calculates a canonical scenario headlessly into a replayable complete run', () => {
		const canonicalInput = canonicalPlinkoScenarios.find(
			(scenario) => scenario.id === 'offset-drop'
		)!.input;
		const run = constructSingleBallRun(canonicalInput);
		const playback = toRendererPlaybackInput(run);

		expect(run.validity).toBe('valid');
		expect(run.terminalReason.type).toBe('completion-region');
		expect(run.events.length).toBeGreaterThan(0);
		expect(run.events.map(({ time }) => time)).toEqual(
			[...run.events].map(({ time }) => time).sort((left, right) => left - right)
		);
		expect(run.diagnostics.eventCount).toBe(run.events.length);
		expect(run.diagnostics.segmentCount).toBe(run.trajectories[0]!.segments.length);
		expect(playback.trajectories).toBe(run.trajectories);
		expect(playback.events).toBe(run.events);
		expect(playback.terminalReason).toBe(run.terminalReason);
		expect(JSON.parse(JSON.stringify(run))).toEqual(run);
	});

	it('commits collision-free intervals to events and joins response paths continuously', () => {
		const run = constructSingleBallRun(
			input({
				colliders: [floor()],
				regions: [region('exit', 'complete', [-1, 2.5], [1, 3])],
				maximumEvents: 2
			})
		);
		const segments = run.trajectories[0]!.segments;

		expect(run.terminalReason.type).toBe('event-limit');
		expect(run.events).toHaveLength(2);
		expect(run.events[1]!.time).toBeGreaterThan(run.events[0]!.time);
		expect(segments).toHaveLength(2);
		for (let index = 0; index < segments.length - 1; index += 1) {
			const current = segments[index]!;
			const next = segments[index + 1]!;
			expect(current.endTime).toBe(next.startTime);
			expect(evaluateMotionSegmentPosition(current, current.endTime)).toEqual(next.startPosition);
		}
	});

	it('turns a zero-restitution flat impact into explicit resting contact', () => {
		const run = constructSingleBallRun(
			input({ colliders: [floor()], restitution: 0, maximumSimulationTime: 2 })
		);

		expect(run.terminalReason).toMatchObject({
			type: 'resting-contact',
			colliderId: 'floor'
		});
		expect(run.events).toHaveLength(2);
		expect(run.events[1]).toMatchObject({
			type: 'contact-mode-transition',
			from: 'impact',
			to: 'resting',
			reason: 'impact-collapse'
		});
		expect(run.trajectories[0]!.segments).toHaveLength(1);
		expect(run.diagnostics.simulatedUntilTime).toBe(run.events[0]!.time);
		expect(parseSimulationRunFixture(JSON.stringify(run)).diagnostics.contactSearches).toEqual(
			run.diagnostics.contactSearches
		);
	});

	it('slides along a sloped segment with projected gravity and leaves at its endpoint', () => {
		const ramp: StaticCollider = {
			id: 'ramp',
			motionAuthority: 'static',
			physicalShape: { type: 'line-segment', start: [-2, 0], end: [2, 1] }
		};
		const run = constructSingleBallRun(
			input({
				position: [-1, 2],
				velocity: [0, 0],
				colliders: [ramp],
				restitution: 0,
				maximumSimulationTime: 4
			})
		);
		const sliding = run.trajectories[0]!.segments.find(
			(segment) => segment.type === 'linear-contact'
		);

		expect(sliding).toMatchObject({
			type: 'linear-contact',
			supportingColliderId: 'ramp'
		});
		if (!sliding || sliding.type !== 'linear-contact') return;
		expect(sliding.acceleration[0]).toBeLessThan(0);
		expect(sliding.acceleration[1]).toBeLessThan(0);
		expect(run.events).toContainEqual(
			expect.objectContaining({
				type: 'contact-mode-transition',
				from: 'sliding',
				to: 'free-flight',
				reason: 'endpoint-reached'
			})
		);
	});

	it('records circular peg contact with a changing normal and deterministic detachment', () => {
		const peg: StaticCollider = {
			id: 'peg',
			motionAuthority: 'static',
			physicalShape: { type: 'circle', radius: 0.5 },
			centre: [0, 0]
		};
		const run = constructSingleBallRun(
			input({
				position: [0.08, 2],
				velocity: [0, 0],
				colliders: [peg],
				restitution: 0,
				maximumSimulationTime: 3
			})
		);
		const circular = run.trajectories[0]!.segments.find(
			(segment) => segment.type === 'circular-contact'
		);

		expect(circular).toMatchObject({
			type: 'circular-contact',
			supportingColliderId: 'peg'
		});
		if (!circular || circular.type !== 'circular-contact') return;
		expect(circular.endAngle).not.toBe(circular.startAngle);
		expect(run.events).toContainEqual(
			expect.objectContaining({
				type: 'contact-mode-transition',
				from: 'sliding',
				to: 'free-flight',
				reason: 'support-lost'
			})
		);
	});

	it('enters circular support without restitution when zero-speed topology proves entry', () => {
		const circle: StaticCollider = {
			id: 'support-circle',
			motionAuthority: 'static',
			physicalShape: { type: 'circle', radius: 0.5 },
			centre: [0, 0]
		};
		const run = constructSingleBallRun(
			input({
				position: [0, 0.6],
				velocity: [1, 0],
				colliders: [circle],
				restitution: 0.8,
				maximumSimulationTime: 1
			})
		);
		const initialCandidate = run.diagnostics.contactSearches[0]!.candidates.find(
			(candidate) => candidate.colliderId === circle.id
		)!;

		expect(initialCandidate).toMatchObject({
			time: 0,
			classification: 'accepted-non-impulsive',
			preContactVelocity: [1, 0],
			postContactVelocity: [1, 0]
		});
		expect(run.events).toContainEqual(
			expect.objectContaining({
				type: 'contact-mode-transition',
				colliderId: circle.id,
				from: 'free-flight',
				to: 'sliding'
			})
		);
		const supportedSegment = run.trajectories[0]!.segments[0]!;
		expect(supportedSegment).toMatchObject({
			type: 'circular-contact',
			supportingColliderId: circle.id
		});
		expect(supportedSegment.startVelocity[0]).toBeCloseTo(1, 12);
		expect(supportedSegment.startVelocity[1]).toBeCloseTo(0, 12);
	});

	it('collapses repeated centred peg impacts into symmetric resting contact', () => {
		const peg: StaticCollider = {
			id: 'centre-peg',
			motionAuthority: 'static',
			physicalShape: { type: 'circle', radius: 0.5 },
			centre: [0, 0]
		};
		const run = constructSingleBallRun(
			input({
				position: [0, 2],
				velocity: [0, 0],
				colliders: [peg],
				restitution: 0.5,
				maximumEvents: 100,
				maximumSimulationTime: 5
			})
		);

		expect(run).toMatchObject({
			outcome: 'settled',
			terminalReason: {
				type: 'resting-contact',
				colliderId: 'centre-peg'
			}
		});
		expect(run.events.filter(({ type }) => type === 'contact').length).toBeLessThan(100);
		expect(run.events.at(-1)).toMatchObject({
			type: 'contact-mode-transition',
			from: 'impact',
			to: 'resting'
		});
		for (const segment of run.trajectories[0]!.segments) {
			expect(segment.startPosition[0]).toBe(0);
			expect(evaluateMotionSegmentPosition(segment, segment.endTime)[0]).toBe(0);
		}
	});

	it('classifies exact initial support without requiring an impact or lateral nudge', () => {
		const run = constructSingleBallRun(
			input({
				position: [0, 0.1],
				velocity: [0, 0],
				colliders: [floor()],
				restitution: 0.8
			})
		);

		expect(run).toMatchObject({
			outcome: 'settled',
			terminalReason: {
				type: 'resting-contact',
				position: [0, 0.1],
				reason: 'zero-tangential-motion'
			}
		});
		expect(run.events.at(-1)).toMatchObject({
			type: 'contact-mode-transition',
			from: 'free-flight',
			to: 'resting',
			reason: 'supported-initial-state'
		});
	});

	it('does not classify contact as resting when the normal cannot supply support', () => {
		const ceiling: StaticCollider = {
			id: 'ceiling',
			motionAuthority: 'static',
			physicalShape: { type: 'line-segment', start: [5, 1], end: [-5, 1] }
		};
		const run = constructSingleBallRun(
			input({ position: [0, 0.9], velocity: [0, 0], colliders: [ceiling], restitution: 0 })
		);

		expect(run.outcome).not.toBe('settled');
		expect(run.events.some((event) => event.type === 'contact-mode-transition')).toBe(false);
	});

	it('commits an exact circular turning boundary and reverses before support loss', () => {
		const angle = 2;
		const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
		const clockwiseTangent: Vec2 = [normal[1], -normal[0]];
		const peg: StaticCollider = {
			id: 'turning-peg',
			motionAuthority: 'static',
			physicalShape: { type: 'circle', radius: 0.5 },
			centre: [0, 0]
		};
		const run = constructSingleBallRun(
			input({
				position: [normal[0] * 0.6, normal[1] * 0.6],
				velocity: [clockwiseTangent[0] * 0.1, clockwiseTangent[1] * 0.1],
				colliders: [peg],
				restitution: 0.8
			})
		);

		expect(run).toMatchObject({ validity: 'valid', outcome: 'escaped' });
		const circular = run.trajectories[0]!.segments.filter(
			(segment) => segment.type === 'circular-contact'
		);
		expect(circular).toHaveLength(2);
		const uphill = circular[0]!;
		const downhill = circular[1]!;
		expect(uphill.direction).toBe(-1);
		expect(downhill.direction).toBe(1);
		expect(downhill.startTangentialSpeed).toBe(0);
		expect(uphill.endTime).toBe(downhill.startTime);
		expect(downhill.endTime).toBeGreaterThan(downhill.startTime);
		expect(evaluateMotionSegmentPosition(uphill, uphill.endTime)).toEqual(downhill.startPosition);
		expect(evaluateMotionSegmentVelocity(uphill, uphill.endTime)[0]).toBeCloseTo(0, 12);
		expect(evaluateMotionSegmentVelocity(uphill, uphill.endTime)[1]).toBeCloseTo(0, 12);
		expect(run.events.at(-1)).toMatchObject({
			type: 'contact-mode-transition',
			from: 'sliding',
			to: 'free-flight',
			reason: 'support-lost'
		});
	});

	it('keeps event and time limits as distinct terminal reasons', () => {
		const eventLimited = constructSingleBallRun(input({ colliders: [floor()], maximumEvents: 1 }));
		const timeLimited = constructSingleBallRun(
			input({
				position: [0, 1],
				velocity: [1, 0],
				gravity: [0, 0],
				colliders: [floor(-5)],
				maximumSimulationTime: 0.25
			})
		);

		expect(eventLimited.terminalReason.type).toBe('event-limit');
		expect(timeLimited.terminalReason).toEqual({ type: 'time-limit', time: 0.25, limit: 0.25 });
		expect(timeLimited.trajectories[0]!.segments[0]!.endTime).toBe(0.25);
	});

	it('ends exactly where a continuously evaluated escape region is first reached', () => {
		const run = constructSingleBallRun(
			input({
				position: [0, 1],
				velocity: [2, 0],
				gravity: [0, 0],
				regions: [region('right-escape', 'escape', [1, 0], [2, 2])]
			})
		);
		const terminalSegment = run.trajectories[0]!.segments.at(-1)!;

		expect(run.terminalReason).toEqual({
			type: 'escape-region',
			regionId: 'right-escape',
			time: 0.5
		});
		expect(terminalSegment.endTime).toBe(0.5);
		expect(evaluateMotionSegmentPosition(terminalSegment, terminalSegment.endTime)).toEqual([1, 1]);
	});

	it('escapes at the exact continuous supported-bounds crossing', () => {
		const run = constructSingleBallRun(
			input({
				position: [0, 1],
				velocity: [4, 0],
				gravity: [0, 0],
				maximumSimulationTime: 2
			})
		);
		const terminalSegment = run.trajectories[0]!.segments.at(-1)!;

		expect(run).toMatchObject({
			outcome: 'escaped',
			terminalReason: { type: 'bounds-escape', boundary: 'right', time: 1.25 }
		});
		expect(evaluateMotionSegmentPosition(terminalSegment, terminalSegment.endTime)).toEqual([5, 1]);
	});

	it('preserves the valid prefix and candidate diagnostics for an unresolved search', () => {
		const run = constructSingleBallRun(
			input({
				velocity: [1, 0],
				gravity: [0, 0],
				colliders: [
					{
						id: 'wall-valid',
						motionAuthority: 'static',
						physicalShape: {
							type: 'line-segment',
							start: [1, -1],
							end: [1, 3]
						}
					},
					{
						id: 'peg-overflow',
						motionAuthority: 'static',
						physicalShape: { type: 'circle', radius: 0.5 },
						centre: [1e308, 0]
					}
				]
			})
		);

		expect(run.terminalReason.type).toBe('unresolved-collision-search');
		expect(run.trajectories[0]!.segments).toEqual([]);
		expect(run.events).toEqual([]);
		expect(run.diagnostics.contactSearches[0]).toMatchObject({
			outcome: 'unresolved',
			selectedColliderId: null
		});
		expect(run.diagnostics.candidateCount).toBeGreaterThan(0);
	});

	it('distinguishes invalid input from a numerical failure during otherwise valid motion', () => {
		const invalid = constructSingleBallRun({
			...input(),
			initialDynamicBodies: []
		});
		const numerical = constructSingleBallRun({
			...input({
				position: [8e307, 1],
				velocity: [0, 0],
				gravity: [0, 0],
				regions: [region('overflow-region', 'complete', [-1e308, 0], [-9e307, 2])],
				maximumSimulationTime: 2
			}),
			scene: {
				...input().scene,
				bounds: { width: Number.MAX_VALUE, height: 10 },
				staticColliders: [],
				terminationRegions: [region('overflow-region', 'complete', [-1e308, 0], [-9e307, 2])]
			}
		});

		expect(invalid).toMatchObject({
			validity: 'invalid',
			terminalReason: { type: 'invalid-state' }
		});
		expect(numerical).toMatchObject({
			validity: 'valid',
			terminalReason: { type: 'numerical-failure' }
		});
	});

	it('reports no future event for a permanently stationary supported state', () => {
		const run = constructSingleBallRun(
			input({ position: [0, 1], velocity: [0, 0], gravity: [0, 0] })
		);

		expect(run.terminalReason.type).toBe('no-future-event');
		expect(run.diagnostics.simulatedUntilTime).toBe(0);
	});
});
