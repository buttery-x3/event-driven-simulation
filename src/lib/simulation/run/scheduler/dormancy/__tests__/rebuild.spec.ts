import { describe, expect, it } from 'vitest';
import type {
	DynamicContactRecord,
	InitialDynamicCircleBodyState,
	SimulationInput,
	Vec2
} from '../../../../contracts';
import type { CoupledImpactResponse } from '../../../dynamic-impact';
import {
	createLocalBodyRuntime,
	type LocalBodyPrediction
} from '../../../single-ball/local-events';
import type { ActiveComponentContact, ExactTimeComponent } from '../../pairs/component';
import type { SchedulerState } from '../../types';
import { rebuildDormantComponents } from '../rebuild';

const tolerance = 1e-9;

describe('FLAME-92 represented-motion rest admission', () => {
	it('promotes only the supportable low-motion subset at the current contact geometry', () => {
		const { state, component, response } = fixture(0.009, true);

		const dormantBodyIds = rebuildDormantComponents(state, component, response, tolerance);
		const dormant = state.contactComponents.find(({ type }) => type === 'resting-anchored');
		const promotedFloorContactId = `support-contact:${component.id}:fixed-contact:lower:floor`;

		expect([...dormantBodyIds]).toEqual(['lower', 'middle']);
		expect(dormant).toMatchObject({
			bodyIds: ['lower', 'middle'],
			fixedColliderIds: ['floor'],
			activeContactIds: ['body-contact:lower:middle', promotedFloorContactId]
		});
		expect(state.runtimes.get('lower')?.state.velocity).toEqual([0, 0]);
		expect(state.runtimes.get('middle')?.state.velocity).toEqual([0, 0]);
		expect(state.runtimes.get('active')?.state.velocity).toEqual([0, 0.02]);
		expect([...state.predictions.keys()]).toEqual(['active']);
		expect(
			state.dynamicContacts.find(({ id }) => id === 'fixed-contact:lower:floor')
		).toMatchObject({
			state: 'released',
			postImpactNormalVelocity: 0.009
		});
		expect(state.dynamicContacts.find(({ id }) => id === promotedFloorContactId)).toMatchObject({
			state: 'retained',
			postImpactNormalVelocity: 0
		});
		expect(
			dormant?.retainedSupportReactions.every(({ impulsePerTime }) => impulsePerTime >= 0)
		).toBe(true);
	});

	it('does not promote the equivalent anchored group above the represented-rest threshold', () => {
		const { state, component, response } = fixture(0.011, true);

		expect(rebuildDormantComponents(state, component, response, tolerance).size).toBe(0);
		expect(state.contactComponents).toEqual([]);
		expect(state.runtimes.get('lower')?.state.velocity).toEqual([0, 0.011]);
		expect(state.runtimes.get('middle')?.state.velocity).toEqual([0, 0.011]);
		expect([...state.predictions.keys()]).toEqual(['lower', 'middle', 'active']);
	});

	it('does not freeze an unsupported group merely because it is slow', () => {
		const { state, component, response } = fixture(0.009, false);

		expect(rebuildDormantComponents(state, component, response, tolerance).size).toBe(0);
		expect(state.contactComponents).toEqual([]);
		expect(state.runtimes.get('lower')?.state.velocity).toEqual([0, 0.009]);
		expect(state.runtimes.get('middle')?.state.velocity).toEqual([0, 0.009]);
	});
});

function fixture(
	speed: number,
	anchored: boolean
): {
	readonly state: SchedulerState;
	readonly component: ExactTimeComponent;
	readonly response: CoupledImpactResponse;
} {
	const input = simulationInput();
	const bodies = input.initialDynamicBodies.map((body) => ({
		id: body.id,
		mass: body.mass,
		radius: body.physicalShape.radius,
		position: body.position,
		velocity: body.id === 'active' ? ([0, 0.02] as const) : ([0, speed] as const),
		prefixSegment: null
	}));
	const bodyContacts: ActiveComponentContact[] = [
		{
			type: 'body-body',
			id: 'body-contact:lower:middle',
			firstBodyId: 'lower',
			secondBodyId: 'middle',
			normalFromFirstToSecond: [0, 1],
			contactPoint: [0, 0.5],
			selection: null
		},
		{
			type: 'body-body',
			id: 'body-contact:middle:active',
			firstBodyId: 'middle',
			secondBodyId: 'active',
			normalFromFirstToSecond: [0, 1],
			contactPoint: [0, 1],
			selection: null
		}
	];
	const contacts = anchored ? [...bodyContacts, floorContact()] : bodyContacts;
	const component: ExactTimeComponent = {
		id: 'exact-component:1',
		time: 1,
		bodies,
		contacts,
		candidateEvidence: []
	};
	const postImpactNormalVelocity = new Map([
		['body-contact:lower:middle', 0],
		['body-contact:middle:active', 0.02 - speed],
		['fixed-contact:lower:floor', speed]
	]);
	const response: CoupledImpactResponse = {
		bodyVelocities: bodies.map(({ id: bodyId, velocity }) => ({ bodyId, velocity })),
		contacts: contacts.map(({ id: contactId }) => ({
			contactId,
			impulse: 0,
			preImpactNormalVelocity: -0.001,
			postImpactNormalVelocity: postImpactNormalVelocity.get(contactId)!
		})),
		inelasticVelocity: [],
		elasticVelocity: [],
		finalVelocity: [],
		diagnostic: {} as CoupledImpactResponse['diagnostic']
	};
	const runtimes = new Map(
		input.initialDynamicBodies.map((body) => {
			const runtime = createLocalBodyRuntime(input, body);
			const velocity = response.bodyVelocities.find(({ bodyId }) => bodyId === body.id)!.velocity;
			runtime.committedTime = component.time;
			runtime.state = { ...runtime.state, time: component.time, velocity };
			return [body.id, runtime] as const;
		})
	);
	const predictions = new Map(
		input.initialDynamicBodies.map((body) => [body.id, prediction(body.id)] as const)
	);
	const state: SchedulerState = {
		input,
		wallTimeStart: Date.now(),
		worldTime: component.time,
		scheduled: [],
		runtimes,
		predictions,
		releases: [],
		horizons: [],
		steps: [],
		pairPredictions: [],
		dynamicContacts: contacts.map((contact) =>
			impactContact(contact, postImpactNormalVelocity.get(contact.id)!)
		),
		contactComponents: [],
		componentEvents: [],
		impactSolves: [],
		dynamicSupports: new Map(),
		dynamicSupportPredictions: new Map(),
		dynamicSupportDiagnostics: [],
		releasedDynamicPairs: new Set(),
		rejectedBodyIds: new Set()
	};
	return { state, component, response };
}

function simulationInput(): SimulationInput {
	return {
		scene: {
			id: 'flame-92-rest-policy',
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
		initialDynamicBodies: [
			body('lower', [0, 0.25]),
			body('middle', [0, 0.75]),
			body('active', [0, 1.25])
		],
		settings: {
			gravity: [0, -10],
			restitution: 0.5,
			contactCaptureDistance: 1e-9,
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
		physicalShape: { type: 'circle', radius: 0.25 },
		mass: 1,
		position,
		velocity: [0, 0],
		releaseTime: 0
	};
}

function floorContact(): ActiveComponentContact {
	return {
		type: 'body-fixed',
		id: 'fixed-contact:lower:floor',
		bodyId: 'lower',
		colliderId: 'floor',
		normal: [0, 1],
		contactPoint: [0, 0],
		candidate: {
			type: 'contact-candidate',
			bodyId: 'lower',
			colliderId: 'floor',
			colliderKind: 'boundary',
			feature: 'segment-face-positive',
			time: 1,
			position: [0, 0.25],
			contactPoint: [0, 0],
			normal: [0, 1],
			normalVelocity: 0,
			response: 'impact'
		}
	};
}

function prediction(bodyId: string): LocalBodyPrediction {
	return {
		kind: 'prepared',
		bodyId,
		revision: 1,
		time: 2,
		eventType: 'motion-transition'
	};
}

function impactContact(
	contact: ActiveComponentContact,
	postImpactNormalVelocity: number
): DynamicContactRecord {
	const normal = contact.type === 'body-body' ? contact.normalFromFirstToSecond : contact.normal;
	return {
		id: contact.id,
		time: 1,
		participants:
			contact.type === 'body-body'
				? [
						{ type: 'body', bodyId: contact.firstBodyId },
						{ type: 'body', bodyId: contact.secondBodyId }
					]
				: [
						{ type: 'fixed-collider', colliderId: contact.colliderId },
						{ type: 'body', bodyId: contact.bodyId }
					],
		contactPoint: contact.contactPoint,
		normalFromFirstToSecond: normal,
		preImpactNormalVelocity: -0.001,
		postImpactNormalVelocity,
		impulse: 0,
		state: postImpactNormalVelocity > tolerance ? 'released' : 'retained'
	};
}
