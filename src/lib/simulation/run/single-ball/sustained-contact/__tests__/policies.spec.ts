import { describe, expect, it } from 'vitest';
import type { SimulationInput, StaticCollider } from '../../../../contracts';
import { evaluateCircularContactState } from '../../../../motion';
import {
	findCircularMotionBoundary,
	findEarliestAngularEvent
} from '../circular/angular-event-search';
import { continueCircularContact } from '../circular/continuation';
import {
	detachedContactResult,
	restingContactResult,
	unresolvedContactResult
} from '../contact-mode-results';
import type { SustainedContactRequest } from '../types';

const supportingCollider: StaticCollider = {
	id: 'peg',
	motionAuthority: 'static',
	physicalShape: { type: 'circle', radius: 0.5 },
	centre: [0, 0]
};

function makeRequest(): SustainedContactRequest {
	const input: SimulationInput = {
		scene: {
			id: 'policy-test',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 10, height: 10 },
			staticColliders: [supportingCollider],
			terminationRegions: [
				{
					id: 'exit',
					type: 'axis-aligned-box',
					purpose: 'complete',
					minimum: [-0.1, 0.8],
					maximum: [0.2, 1.1]
				}
			]
		},
		initialDynamicBodies: [
			{
				id: 'ball',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius: 0.1 },
				position: [1, 0],
				velocity: [0, 1]
			}
		],
		settings: {
			gravity: [0, 0],
			restitution: 0,
			maximumEvents: 10,
			maximumSimulationTime: 10,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
	return {
		input,
		body: input.initialDynamicBodies[0]!,
		colliderId: 'peg',
		time: 0,
		position: [1, 0],
		normal: [1, 0],
		outgoingVelocity: [0, 1],
		entryFrom: 'impact',
		entryReason: 'impact-collapse'
	};
}

describe('sustained-contact numerical event policy', () => {
	it('selects a supported turning point before the unavailable continuation', () => {
		const boundary = findCircularMotionBoundary({
			centre: [0, 0],
			contactRadius: 0.6,
			startAngle: 2,
			direction: -1,
			startTangentialSpeed: 0.1,
			gravity: [0, -10]
		});

		expect(boundary).toMatchObject({ type: 'turning-point' });
		expect(boundary!.angle).toBeLessThan(2);
	});

	it('selects support loss when it precedes every other angular motion boundary', () => {
		const boundary = findCircularMotionBoundary({
			centre: [0, 0],
			contactRadius: 0.6,
			startAngle: Math.PI / 2,
			direction: 1,
			startTangentialSpeed: 0.1,
			gravity: [0, -10]
		});

		expect(boundary).toMatchObject({ type: 'support-lost' });
		expect(boundary!.angle).toBeGreaterThan(Math.PI / 2);
	});

	it('selects the first angular terminal-region entry before the motion boundary', () => {
		const baseRequest = makeRequest();
		const startAngle = 2;
		const normal = [Math.cos(startAngle), Math.sin(startAngle)] as const;
		const request: SustainedContactRequest = {
			...baseRequest,
			position: normal,
			normal,
			input: {
				...baseRequest.input,
				scene: {
					...baseRequest.input.scene,
					terminationRegions: [
						{
							id: 'exit',
							type: 'axis-aligned-box',
							purpose: 'complete',
							minimum: [-0.414, 0.91],
							maximum: [-0.41, 0.913]
						}
					]
				},
				settings: { ...baseRequest.input.settings, gravity: [0, -10] }
			}
		};
		const event = findEarliestAngularEvent(request, {
			centre: [0, 0],
			contactRadius: 1,
			startAngle,
			direction: -1,
			startTangentialSpeed: 0.4,
			gravity: [0, -10]
		});

		expect(event).toMatchObject({
			type: 'terminal',
			terminalReason: { type: 'completion-region', regionId: 'exit' }
		});
		expect(event!.angle).toBeLessThan(startAngle);
	});

	it('reverses from exact rest without a zero-time loop', () => {
		const request = makeRequest();
		const startAngle = 2;
		const normal = [Math.cos(startAngle), Math.sin(startAngle)] as const;
		const clockwiseTangent = [normal[1], -normal[0]] as const;
		const contactRadius = 0.6;
		const result = continueCircularContact(
			{
				...request,
				input: {
					...request.input,
					settings: { ...request.input.settings, gravity: [0, -10] }
				},
				position: [normal[0] * contactRadius, normal[1] * contactRadius],
				normal,
				outgoingVelocity: [clockwiseTangent[0] * 0.1, clockwiseTangent[1] * 0.1]
			},
			[0, 0],
			contactRadius
		);

		expect(result.terminalReason).toBeNull();
		expect(result.segments).toHaveLength(2);
		const uphill = result.segments[0]!;
		const downhill = result.segments[1]!;
		expect(uphill).toMatchObject({ type: 'circular-contact', direction: -1 });
		expect(downhill).toMatchObject({
			type: 'circular-contact',
			direction: 1,
			startTangentialSpeed: 0
		});
		expect(uphill.endTime).toBe(downhill.startTime);
		expect(downhill.endTime).toBeGreaterThan(downhill.startTime);
		if (uphill.type !== 'circular-contact' || downhill.type !== 'circular-contact') return;
		const turningState = evaluateCircularContactState(uphill, uphill.endTime);
		expect(turningState.velocity[0]).toBeCloseTo(0, 12);
		expect(turningState.velocity[1]).toBeCloseTo(0, 12);
		expect(downhill.startPosition[0]).toBeCloseTo(turningState.position[0], 12);
		expect(downhill.startPosition[1]).toBeCloseTo(turningState.position[1], 12);
	});
});

describe('shared sustained-contact result construction', () => {
	it('constructs resting, detached, and unresolved lifecycle results consistently', () => {
		const request = makeRequest();

		expect(restingContactResult(request)).toMatchObject({
			events: [{ from: 'impact', to: 'resting', reason: 'impact-collapse' }],
			terminalReason: { type: 'resting-contact', colliderId: 'peg' },
			nextState: null
		});
		expect(detachedContactResult(request, [2, 3])).toMatchObject({
			events: [{ from: 'impact', to: 'free-flight', reason: 'support-lost' }],
			terminalReason: null,
			nextState: { velocity: [2, 3], releasedContactColliderId: 'peg' }
		});
		expect(unresolvedContactResult(request, 'search failed')).toMatchObject({
			events: [
				{ from: 'impact', to: 'sliding' },
				{ from: 'sliding', to: 'free-flight', reason: 'unresolved' }
			],
			terminalReason: { type: 'unresolved-collision-search', detail: 'search failed' }
		});
	});
});
