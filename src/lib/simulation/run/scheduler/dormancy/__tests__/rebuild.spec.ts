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

	it('rests a supportable jammed stack whose raw post-impact speeds exceed perceptual rest', () => {
		const { state, contacts, response } = jammedStackFixture();
		const dormantBodyIds = rebuildDormantComponents(state, contacts, response, tolerance);
		const dormant = state.contactComponents.find(({ type }) => type === 'resting-anchored');

		expect([...dormantBodyIds].sort()).toEqual(['lower', 'upper']);
		expect(dormant).toMatchObject({
			bodyIds: ['lower', 'upper'],
			fixedColliderIds: ['floor']
		});
		expect(state.runtimes.get('lower')?.state.velocity).toEqual([0, 0]);
		expect(state.runtimes.get('upper')?.state.velocity).toEqual([0, 0]);
		expect(response.bodyVelocities.every(({ velocity }) => Math.hypot(...velocity) > 0.01)).toBe(
			true
		);
	});

	it('does not rest a floor slider whose tangential residual remains large', () => {
		const { state, contacts, response } = sliderFixture();
		const dormantBodyIds = rebuildDormantComponents(state, contacts, response, tolerance);

		expect([...dormantBodyIds]).toEqual([]);
		expect(state.runtimes.get('slider')?.state.velocity).toEqual([0.4, -0.8]);
	});

	it('does not freeze a previously dormant body that still has admissible tangent motion', () => {
		const { state, contacts, response } = anchoredSupportFixture();
		const dormantBodyIds = rebuildDormantComponents(state, contacts, response, tolerance);

		expect([...dormantBodyIds]).toEqual(['support']);
		expect(state.runtimes.get('support')?.state.velocity).toEqual([0, 0]);
		expect(state.runtimes.get('slider')?.state.velocity).toEqual([0, 0.8]);
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
		constrainedImpactSolves: [],
		dynamicSupports: new Map(),
		dynamicSupportPredictions: new Map(),
		dynamicSupportDiagnostics: [],
		releasedDynamicPairs: new Set(),
		rejectedBodyIds: new Set()
	};
	return { state, contacts, response };
}

function jammedStackFixture(): {
	readonly state: SchedulerState;
	readonly contacts: ResolvedContactState;
	readonly response: CoupledImpactResponse;
} {
	const input = jammedInput();
	const bodies = [
		exactBody('lower', [0, 0.25], [0, -0.5]),
		exactBody('upper', [0, 0.75], [0, -0.5])
	];
	const exactContacts: ExactContact[] = [
		{
			type: 'body-body',
			id: 'body:lower:upper',
			firstBodyId: 'lower',
			secondBodyId: 'upper',
			normalFromFirstToSecond: [0, 1],
			contactPoint: [0, 0.5]
		},
		floorContact()
	];
	return componentFixture(
		input,
		bodies,
		exactContacts,
		new Map([
			['body:lower:upper', 0],
			['fixed:lower:floor', 0]
		])
	);
}

function anchoredSupportFixture(): {
	readonly state: SchedulerState;
	readonly contacts: ResolvedContactState;
	readonly response: CoupledImpactResponse;
} {
	const input = jammedInput(
		['support', 'slider'],
		[
			[0, 0.25],
			[0.5, 0.25]
		]
	);
	const bodies = [
		exactBody('support', [0, 0.25], [0, 0]),
		exactBody('slider', [0.5, 0.25], [0, 0.8])
	];
	const exactContacts: ExactContact[] = [
		floorContact('support'),
		{
			type: 'body-body',
			id: 'body:support:slider',
			firstBodyId: 'support',
			secondBodyId: 'slider',
			normalFromFirstToSecond: [1, 0],
			contactPoint: [0.25, 0.25]
		}
	];
	const fixture = componentFixture(
		input,
		bodies,
		exactContacts,
		new Map([
			['fixed:support:floor', 0],
			['body:support:slider', 0]
		])
	);
	fixture.state.contactComponents.push({
		id: 'resting-component:0:support+slider:r0',
		type: 'resting-anchored',
		createdAtTime: 0,
		dissolvedAtTime: null,
		bodyIds: ['slider', 'support'],
		fixedColliderIds: ['floor'],
		activeContactIds: ['fixed:support:floor', 'body:support:slider'],
		retainedSupportReactions: [
			{ contactId: 'fixed:support:floor', impulsePerTime: 10 },
			{ contactId: 'body:support:slider', impulsePerTime: 0 }
		],
		revision: 0,
		futureScheduledEventTimes: []
	});
	fixture.state.runtimes.get('support')!.dormantComponentId =
		'resting-component:0:support+slider:r0';
	fixture.state.runtimes.get('slider')!.dormantComponentId =
		'resting-component:0:support+slider:r0';
	return fixture;
}

function sliderFixture(): {
	readonly state: SchedulerState;
	readonly contacts: ResolvedContactState;
	readonly response: CoupledImpactResponse;
} {
	const input = jammedInput(['slider'], [[0, 0.25]]);
	const bodies = [exactBody('slider', [0, 0.25], [0.4, -0.8])];
	return componentFixture(
		input,
		bodies,
		[floorContact('slider')],
		new Map([['fixed:slider:floor', 0]])
	);
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

function jammedInput(
	ids: readonly string[] = ['lower', 'upper'],
	positions: readonly Vec2[] = [
		[0, 0.25],
		[0, 0.75]
	]
): SimulationInput {
	const input = simulationInput();
	return {
		...input,
		scene: { ...input.scene, id: 'jammed-stack-rest' },
		initialDynamicBodies: ids.map((id, index) => body(id, positions[index]!))
	};
}

function exactBody(
	id: string,
	position: Vec2,
	velocity: Vec2
): ExactTimeComponent['bodies'][number] {
	return { id, mass: 1, radius: 0.25, position, velocity, prefixSegment: null };
}

function componentFixture(
	input: SimulationInput,
	bodies: ExactTimeComponent['bodies'],
	exactContacts: readonly ExactContact[],
	postVelocity: ReadonlyMap<string, number>
): {
	readonly state: SchedulerState;
	readonly contacts: ResolvedContactState;
	readonly response: CoupledImpactResponse;
} {
	const eventState: ExactTimeComponent = {
		id: 'exact-component:1',
		time: 1,
		bodies,
		contacts: exactContacts,
		candidateEvidence: [],
		selectionDiagnosticIds: []
	};
	const contacts: ResolvedContactState = {
		eventState,
		contacts: exactContacts.map((contact) => ({
			contact,
			participation: 'impact',
			disposition: (postVelocity.get(contact.id) ?? 0) > tolerance ? 'released' : 'retained',
			preResponseNormalVelocity: -0.5,
			postResponseNormalVelocity: postVelocity.get(contact.id) ?? 0,
			impulse: 0,
			supportReaction: null
		}))
	};
	const response: CoupledImpactResponse = {
		bodyVelocities: bodies.map(({ id: bodyId, velocity }) => ({ bodyId, velocity })),
		contacts: exactContacts.map(({ id: contactId }) => ({
			contactId,
			impulse: 0,
			preImpactNormalVelocity: -0.5,
			postImpactNormalVelocity: postVelocity.get(contactId) ?? 0
		})),
		inelasticVelocity: [],
		elasticVelocity: [],
		finalVelocity: [],
		diagnostic: {} as CoupledImpactResponse['diagnostic']
	};
	const runtimes = new Map(
		input.initialDynamicBodies.map((item) => {
			const runtime = createLocalBodyRuntime(input, item);
			const velocity = response.bodyVelocities.find(({ bodyId }) => bodyId === item.id)!.velocity;
			runtime.committedTime = eventState.time;
			runtime.state = { ...runtime.state, time: eventState.time, velocity };
			return [item.id, runtime] as const;
		})
	);
	const predictions = new Map(
		input.initialDynamicBodies.map((item) => [item.id, prediction(item.id)] as const)
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
			impactContact(contact, postVelocity.get(contact.id) ?? 0)
		),
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
	return { state, contacts, response };
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

function floorContact(bodyId = 'lower'): ExactContact {
	return {
		type: 'body-fixed',
		id: `fixed:${bodyId}:floor`,
		bodyId,
		colliderId: 'floor',
		normal: [0, 1],
		contactPoint: [0, 0],
		candidate: {
			type: 'contact-candidate',
			bodyId,
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
