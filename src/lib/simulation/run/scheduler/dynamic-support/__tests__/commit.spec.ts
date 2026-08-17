import { describe, expect, it } from 'vitest';
import type {
	ContactComponentRecord,
	DynamicContactRecord,
	InitialDynamicCircleBodyState,
	SimulationInput,
	Vec2
} from '../../../../contracts';
import type { ExactContact, ExactContactBodyState } from '../../../contact-resolution';
import { createLocalBodyRuntime } from '../../../single-ball/local-events';
import type { SchedulerState } from '../../types';
import { commitDynamicSupportPrediction } from '../commit';
import { evaluateDynamicSupportReaction } from '../prediction';
import type { DynamicSupportPrediction, DynamicSupportRuntime } from '../types';

describe('dynamic supported-motion boundary commitment', () => {
	it('retires sustained support and commits the selected complete group as reversible rest', () => {
		const { state, prediction } = fixture(Math.PI / 2);

		expect(commitDynamicSupportPrediction(state, prediction)).toEqual({ type: 'continued' });

		const retired = state.contactComponents.find(
			({ type }) => type === 'dynamic-sustained-support'
		);
		const resting = state.contactComponents.find(
			(record) => record.type === 'resting-anchored' && record.dissolvedAtTime === null
		);
		expect(retired?.dissolvedAtTime).toBe(1);
		expect(resting).toMatchObject({
			createdAtTime: 1,
			bodyIds: ['slider', 'support'],
			fixedColliderIds: ['wedge-left', 'wedge-right']
		});
		expect(state.dynamicSupports.size).toBe(0);
		expect(state.dynamicSupportPredictions.size).toBe(0);
		expect(state.runtimes.get('slider')).toMatchObject({
			dormantComponentId: resting?.id,
			state: { velocity: [0, 0] }
		});
		expect(state.runtimes.get('support')?.dormantComponentId).toBe(resting?.id);
		expect(
			state.runtimes
				.get('slider')
				?.events.some(
					(event) =>
						event.type === 'contact-mode-transition' &&
						event.from === 'sliding' &&
						event.to === 'resting'
				)
		).toBe(true);
		expect(state.componentEvents.slice(-2).map(({ change }) => change)).toEqual([
			'dissolved',
			'created'
		]);
	});

	it('preserves turning-point reversal when zero-motion support is not certifiable', () => {
		const { state, prediction } = fixture(1.4);

		expect(commitDynamicSupportPrediction(state, prediction)).toEqual({ type: 'continued' });

		expect(state.dynamicSupports.size).toBe(1);
		expect(state.dynamicSupportPredictions.get('dynamic-support')?.seed.direction).toBe(-1);
		expect(
			state.contactComponents.some(
				(record) => record.type === 'resting-anchored' && record.bodyIds.includes('slider')
			)
		).toBe(false);
	});
});

function fixture(endAngle: number): {
	readonly state: SchedulerState;
	readonly prediction: DynamicSupportPrediction;
} {
	const input = simulationInput();
	const startAngle = endAngle - 0.1;
	const gravity = input.settings.gravity;
	const startNormal: Vec2 = [Math.cos(startAngle), Math.sin(startAngle)];
	const endNormal: Vec2 = [Math.cos(endAngle), Math.sin(endAngle)];
	const displacement: Vec2 = [endNormal[0] - startNormal[0], endNormal[1] - startNormal[1]];
	const startSpeed = Math.sqrt(
		Math.max(0, -2 * (gravity[0] * displacement[0] + gravity[1] * displacement[1]))
	);
	const tangent: Vec2 = [-startNormal[1], startNormal[0]];
	const supportBody = exactBody(input.initialDynamicBodies[0]!, [0, 1], [0, 0]);
	const sliderBody = exactBody(
		input.initialDynamicBodies[1]!,
		[startNormal[0], 1 + startNormal[1]],
		[tangent[0] * startSpeed, tangent[1] * startSpeed]
	);
	const anchoredContacts = wedgeContacts();
	const runtime: DynamicSupportRuntime = {
		id: 'dynamic-support',
		contactId: 'body-contact',
		movingBodyId: 'slider',
		supportBodyId: 'support',
		componentId: 'dynamic-component',
		anchoredBodyIds: ['support'],
		anchoredBodies: [supportBody],
		anchoredContacts,
		time: 0,
		position: sliderBody.position,
		normal: startNormal,
		direction: 1,
		tangentialSpeed: startSpeed
	};
	const state = schedulerState(input, runtime, supportBody, sliderBody, anchoredContacts);
	const seed = {
		centre: supportBody.position,
		contactRadius: 1,
		startAngle,
		direction: 1 as const,
		startTangentialSpeed: startSpeed,
		gravity
	};
	const segment = {
		type: 'circular-contact' as const,
		bodyId: 'slider',
		startTime: 0,
		endTime: 1,
		startPosition: sliderBody.position,
		startVelocity: sliderBody.velocity,
		supportingColliderId: 'support',
		supportingBodyId: 'support',
		supportingComponentId: runtime.componentId,
		centre: supportBody.position,
		contactRadius: 1,
		startAngle,
		endAngle,
		direction: 1 as const,
		startTangentialSpeed: startSpeed,
		gravity
	};
	const prediction: DynamicSupportPrediction = {
		supportId: runtime.id,
		movingBodyId: 'slider',
		revision: 0,
		segment,
		seed,
		boundary: { type: 'turning-point', angle: endAngle },
		startReaction: evaluateDynamicSupportReaction(state, runtime, seed, startAngle),
		endReaction: evaluateDynamicSupportReaction(state, runtime, seed, endAngle),
		initialRequiredContactIds: anchoredContacts.map(({ id }) => id)
	};
	state.dynamicSupportPredictions.set(runtime.id, prediction);
	return { state, prediction };
}

function schedulerState(
	input: SimulationInput,
	support: DynamicSupportRuntime,
	supportBody: ExactContactBodyState,
	sliderBody: ExactContactBodyState,
	anchoredContacts: readonly ExactContact[]
): SchedulerState {
	const runtimes = new Map(
		input.initialDynamicBodies.map((body) => {
			const runtime = createLocalBodyRuntime(input, body);
			const exact = body.id === 'support' ? supportBody : sliderBody;
			runtime.state = {
				...runtime.state,
				position: exact.position,
				velocity: exact.velocity
			};
			if (body.id === 'support') runtime.dormantComponentId = support.componentId;
			return [body.id, runtime] as const;
		})
	);
	const component: ContactComponentRecord = {
		id: support.componentId,
		type: 'dynamic-sustained-support',
		createdAtTime: 0,
		dissolvedAtTime: null,
		bodyIds: ['slider', 'support'],
		fixedColliderIds: ['wedge-left', 'wedge-right'],
		activeContactIds: ['body-contact', ...anchoredContacts.map(({ id }) => id)],
		retainedSupportReactions: [],
		revision: 1,
		futureScheduledEventTimes: [],
		dynamicSupport: {
			movingBodyId: 'slider',
			supportBodyId: 'support',
			anchoredBodyIds: ['support'],
			bodyBodyContactId: 'body-contact'
		}
	};
	return {
		input,
		wallTimeStart: Date.now(),
		worldTime: 1,
		scheduled: [],
		runtimes,
		predictions: new Map(),
		releases: [],
		horizons: [],
		steps: [],
		pairPredictions: [],
		dynamicContacts: [
			bodyContactRecord(sliderBody.position),
			...fixedContactRecords(anchoredContacts)
		],
		contactComponents: [component],
		componentEvents: [],
		impactSolves: [],
		constrainedImpactSolves: [],
		dynamicSupports: new Map([[support.id, support]]),
		dynamicSupportPredictions: new Map(),
		dynamicSupportDiagnostics: [],
		releasedDynamicPairs: new Set(),
		rejectedBodyIds: new Set()
	};
}

function simulationInput(): SimulationInput {
	return {
		scene: {
			id: 'dynamic-support-rest-commit',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 10, height: 10 },
			staticColliders: [
				{
					id: 'wedge-left',
					motionAuthority: 'static',
					centre: [-0.6, 0.2],
					physicalShape: { type: 'circle', radius: 0.5 }
				},
				{
					id: 'wedge-right',
					motionAuthority: 'static',
					centre: [0.6, 0.2],
					physicalShape: { type: 'circle', radius: 0.5 }
				}
			],
			terminationRegions: []
		},
		initialDynamicBodies: [body('support', [0, 1]), body('slider', [0, 2])],
		settings: {
			gravity: [0, -10],
			restitution: 0,
			contactCaptureDistance: 1e-9,
			maximumEvents: 20,
			maximumSimulationTime: 10,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
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

function exactBody(
	body: InitialDynamicCircleBodyState,
	position: Vec2,
	velocity: Vec2
): ExactContactBodyState {
	return { id: body.id, mass: body.mass, radius: body.physicalShape.radius, position, velocity };
}

function wedgeContacts(): readonly ExactContact[] {
	return [fixedContact('wedge-left', [0.6, 0.8]), fixedContact('wedge-right', [-0.6, 0.8])];
}

function fixedContact(colliderId: string, normal: Vec2): ExactContact {
	return {
		type: 'body-fixed',
		id: `fixed:${colliderId}`,
		bodyId: 'support',
		colliderId,
		normal,
		contactPoint: [-normal[0] * 0.5, 1 - normal[1] * 0.5],
		candidate: {
			type: 'contact-candidate',
			bodyId: 'support',
			colliderId,
			colliderKind: 'circle',
			feature: 'circle',
			time: 0,
			position: [0, 1],
			contactPoint: [-normal[0] * 0.5, 1 - normal[1] * 0.5],
			normal,
			normalVelocity: 0,
			response: 'impact'
		}
	};
}

function bodyContactRecord(position: Vec2): DynamicContactRecord {
	return {
		id: 'body-contact',
		time: 0,
		participants: [
			{ type: 'body', bodyId: 'support' },
			{ type: 'body', bodyId: 'slider' }
		],
		contactPoint: [position[0], position[1] - 0.5],
		normalFromFirstToSecond: [position[0], position[1] - 1],
		preImpactNormalVelocity: 0,
		postImpactNormalVelocity: 0,
		impulse: 0,
		state: 'retained'
	};
}

function fixedContactRecords(contacts: readonly ExactContact[]): DynamicContactRecord[] {
	return contacts.map((contact) => {
		if (contact.type !== 'body-fixed') throw new Error('Expected fixed contact.');
		return {
			id: contact.id,
			time: 0,
			participants: [
				{ type: 'fixed-collider' as const, colliderId: contact.colliderId },
				{ type: 'body' as const, bodyId: contact.bodyId }
			],
			contactPoint: contact.contactPoint,
			normalFromFirstToSecond: contact.normal,
			preImpactNormalVelocity: 0,
			postImpactNormalVelocity: 0,
			impulse: 0,
			state: 'retained' as const
		};
	});
}
