import { describe, expect, it } from 'vitest';
import type {
	DynamicContactRecord,
	InitialDynamicCircleBodyState,
	SimulationInput,
	Vec2
} from '../../../../contracts';
import type { ExactContact, ResolvedContactState } from '../../../contact-resolution';
import type { CoupledImpactResponse } from '../../../dynamic-impact';
import {
	createLocalBodyRuntime,
	type LocalBodyPrediction
} from '../../../single-ball/local-events';
import type { ExactTimeComponent } from '../../pairs/component';
import type { SchedulerState } from '../../types';
import { rebuildDormantComponents } from '../rebuild';

const tolerance = 1e-9;

describe('represented-motion dormancy rebuilding', () => {
	it('rests only the supportable low-motion subset using certified current contacts', () => {
		const { state, contacts, response } = fixture();
		const dormantBodyIds = rebuildDormantComponents(state, contacts, response, tolerance);
		const dormant = state.contactComponents.find(({ type }) => type === 'resting-anchored');
		const retainedFloorId = `support-contact:${contacts.eventState.id}:fixed:lower:floor`;

		expect([...dormantBodyIds]).toEqual(['lower', 'middle']);
		expect(dormant).toMatchObject({
			bodyIds: ['lower', 'middle'],
			fixedColliderIds: ['floor'],
			activeContactIds: ['body:lower:middle', retainedFloorId]
		});
		expect(state.runtimes.get('lower')?.state.velocity).toEqual([0, 0]);
		expect(state.runtimes.get('middle')?.state.velocity).toEqual([0, 0]);
		expect(state.runtimes.get('active')?.state.velocity).toEqual([0, 0.02]);
		expect([...state.predictions.keys()]).toEqual(['active']);
		expect(state.dynamicContacts.find(({ id }) => id === 'fixed:lower:floor')).toMatchObject({
			state: 'released',
			postImpactNormalVelocity: 0.009
		});
		expect(state.dynamicContacts.find(({ id }) => id === retainedFloorId)).toMatchObject({
			state: 'retained',
			postImpactNormalVelocity: 0
		});
		expect(
			dormant?.retainedSupportReactions.every(({ impulsePerTime }) => impulsePerTime >= 0)
		).toBe(true);
	});
});

function fixture(): {
	readonly state: SchedulerState;
	readonly contacts: ResolvedContactState;
	readonly response: CoupledImpactResponse;
} {
	const input = simulationInput();
	const bodies = input.initialDynamicBodies.map((body) => ({
		id: body.id,
		mass: body.mass,
		radius: body.physicalShape.radius,
		position: body.position,
		velocity: body.id === 'active' ? ([0, 0.02] as const) : ([0, 0.009] as const),
		prefixSegment: null
	}));
	const exactContacts: ExactContact[] = [
		{
			type: 'body-body',
			id: 'body:lower:middle',
			firstBodyId: 'lower',
			secondBodyId: 'middle',
			normalFromFirstToSecond: [0, 1],
			contactPoint: [0, 0.5]
		},
		{
			type: 'body-body',
			id: 'body:middle:active',
			firstBodyId: 'middle',
			secondBodyId: 'active',
			normalFromFirstToSecond: [0, 1],
			contactPoint: [0, 1]
		},
		floorContact()
	];
	const eventState: ExactTimeComponent = {
		id: 'exact-component:1',
		time: 1,
		bodies,
		contacts: exactContacts,
		candidateEvidence: [],
		selectionDiagnosticIds: []
	};
	const postVelocity = new Map([
		['body:lower:middle', 0],
		['body:middle:active', 0.011],
		['fixed:lower:floor', 0.009]
	]);
	const contacts: ResolvedContactState = {
		eventState,
		contacts: exactContacts.map((contact) => ({
			contact,
			participation: 'impact',
			disposition: postVelocity.get(contact.id)! > tolerance ? 'released' : 'retained',
			preResponseNormalVelocity: -0.001,
			postResponseNormalVelocity: postVelocity.get(contact.id)!,
			impulse: 0,
			supportReaction: null
		}))
	};
	const response: CoupledImpactResponse = {
		bodyVelocities: bodies.map(({ id: bodyId, velocity }) => ({ bodyId, velocity })),
		contacts: exactContacts.map(({ id: contactId }) => ({
			contactId,
			impulse: 0,
			preImpactNormalVelocity: -0.001,
			postImpactNormalVelocity: postVelocity.get(contactId)!
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
			runtime.committedTime = eventState.time;
			runtime.state = { ...runtime.state, time: eventState.time, velocity };
			return [body.id, runtime] as const;
		})
	);
	const predictions = new Map(
		input.initialDynamicBodies.map((body) => [body.id, prediction(body.id)] as const)
	);
	const state: SchedulerState = {
		input,
		wallTimeStart: Date.now(),
		worldTime: eventState.time,
		scheduled: [],
		runtimes,
		predictions,
		releases: [],
		horizons: [],
		steps: [],
		pairPredictions: [],
		dynamicContacts: exactContacts.map((contact) =>
			impactContact(contact, postVelocity.get(contact.id)!)
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
	return { state, contacts, response };
}

function simulationInput(): SimulationInput {
	return {
		scene: {
			id: 'represented-rest-policy',
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
		physicalShape: { type: 'circle', radius: 0.25 },
		mass: 1,
		position,
		velocity: [0, 0],
		releaseTime: 0
	};
}

function floorContact(): ExactContact {
	return {
		type: 'body-fixed',
		id: 'fixed:lower:floor',
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
	return { kind: 'prepared', bodyId, revision: 1, time: 2, eventType: 'motion-transition' };
}

function impactContact(
	contact: ExactContact,
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
