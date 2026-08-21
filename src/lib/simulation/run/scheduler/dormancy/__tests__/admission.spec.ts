import { describe, expect, it } from 'vitest';
import type {
	InitialDynamicCircleBodyState,
	RunTerminalReason,
	SimulationInput,
	Vec2
} from '../../../../contracts';
import { evaluateMotionSegmentPosition } from '../../../../motion';
import {
	createLocalBodyRuntime,
	type LocalBodyPrediction
} from '../../../single-ball/local-events';
import { buildExactTimeComponent } from '../../pairs/component';
import { predictEarliestBodyPair } from '../../pairs';
import type { SchedulerState } from '../../types';
import { registerSingleBodyDormancy } from '../admission';

const tolerance = 1e-9;
const earlierEventTime = 1;
const restTime = 2;
const stalePosition: Vec2 = [-0.3, 0.5];
const restPosition: Vec2 = [0, 0.5];
const incomingPosition: Vec2 = [-1.2, 0.5];

describe('single-body rest dormancy admission', () => {
	it('synchronizes dormant runtime state so later pair prediction uses the resting boundary', () => {
		const { state, reason } = fixture();
		const runtime = state.runtimes.get('resting')!;

		expect(runtime.state.position).toEqual(stalePosition);
		registerSingleBodyDormancy(state, 'resting', reason);

		expect(runtime.state.time).toBe(reason.time);
		expect(runtime.state.position).toEqual(reason.position);
		expect(runtime.state.velocity).toEqual([0, 0]);
		expect(runtime.committedTime).toBe(restTime);
		expect(runtime.dormantComponentId).toEqual(expect.stringContaining('resting'));

		const selection = predictEarliestBodyPair(state);
		expect(selection?.type).toBe('contact');
		if (selection?.type !== 'contact') return;

		const dormant = selection.first.bodyId === 'resting' ? selection.first : selection.second;
		expect(dormant.path).toMatchObject({
			type: 'stationary',
			startPosition: restPosition,
			startVelocity: [0, 0],
			reason: 'dormant-component'
		});
		expect(dormant.path.startPosition).not.toEqual(stalePosition);

		const component = buildExactTimeComponent(state, selection);
		const body = component?.bodies.find(({ id }) => id === 'resting');
		expect(body?.position).toEqual(evaluateMotionSegmentPosition(dormant.path, selection.time));
		expect(body?.position).toEqual(restPosition);
	});
});

function fixture(): {
	readonly state: SchedulerState;
	readonly reason: Extract<RunTerminalReason, { readonly type: 'resting-contact' }>;
} {
	const input = simulationInput();
	const reason = {
		type: 'resting-contact' as const,
		time: restTime,
		colliderId: 'floor',
		position: restPosition,
		normal: [0, 1] as Vec2,
		reason: 'zero-tangential-motion' as const
	};
	const runtimes = new Map(
		input.initialDynamicBodies.map((body) => {
			const runtime = createLocalBodyRuntime(input, body);
			if (body.id === 'resting') {
				runtime.committedTime = restTime;
				runtime.state = {
					...runtime.state,
					time: earlierEventTime,
					position: stalePosition,
					velocity: [0.4, 0]
				};
				runtime.terminalReason = reason;
			} else {
				runtime.committedTime = restTime;
				runtime.state = {
					...runtime.state,
					time: restTime,
					position: incomingPosition,
					velocity: [1, 0]
				};
			}
			return [body.id, runtime] as const;
		})
	);
	const predictions = new Map<string, LocalBodyPrediction>([
		[
			'incoming',
			{
				kind: 'terminal',
				bodyId: 'incoming',
				revision: 0,
				time: input.settings.maximumSimulationTime,
				eventType: 'termination',
				reason: {
					type: 'time-limit',
					time: input.settings.maximumSimulationTime,
					limit: input.settings.maximumSimulationTime
				},
				path: {
					type: 'free-flight',
					bodyId: 'incoming',
					startTime: restTime,
					endTime: input.settings.maximumSimulationTime,
					startPosition: incomingPosition,
					startVelocity: [1, 0],
					acceleration: input.settings.gravity
				},
				search: null
			}
		]
	]);
	const state: SchedulerState = {
		input,
		wallTimeStart: Date.now(),
		worldTime: restTime,
		scheduled: [],
		runtimes,
		predictions,
		releases: [],
		horizons: [],
		steps: [],
		pairPredictions: [],
		dynamicContacts: [],
		contactComponents: [],
		componentEvents: [],
		impactSolves: [],
		constrainedImpactSolves: [],
		dynamicSupports: new Map(),
		dynamicSupportPredictions: new Map(),
		dynamicSupportDiagnostics: [],
		releasedDynamicPairs: new Set(),
		rejectedBodyIds: new Set()
	};
	return { state, reason };
}

function simulationInput(): SimulationInput {
	return {
		scene: {
			id: 'single-body-rest-dormancy',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 10, height: 10 },
			staticColliders: [
				{
					id: 'floor',
					motionAuthority: 'static',
					physicalShape: { type: 'line-segment', start: [-5, 0], end: [5, 0] }
				}
			],
			terminationRegions: []
		},
		initialDynamicBodies: [body('resting', stalePosition), body('incoming', incomingPosition)],
		settings: {
			gravity: [0, 0],
			restitution: 0.5,
			contactCaptureDistance: tolerance,
			maximumEvents: 20,
			maximumSimulationTime: 10,
			tolerances: { contactDistance: tolerance, eventTime: tolerance }
		}
	};
}

function body(id: string, position: Vec2): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.5 },
		mass: 1,
		position,
		velocity: [0, 0],
		releaseTime: 0
	};
}
