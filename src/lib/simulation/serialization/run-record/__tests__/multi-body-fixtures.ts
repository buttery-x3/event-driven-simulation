import type {
	BodyRunState,
	InitialDynamicCircleBodyState,
	MotionSegment,
	SimulationInput,
	SimulationRunRecord
} from '../../../contracts';

const settings = {
	gravity: [0, 0],
	restitution: 1,
	contactCaptureDistance: 1e-9,
	maximumEvents: 20,
	maximumSimulationTime: 10,
	tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
} as const;

const scene = {
	id: 'multi-body-contract-scene',
	coordinateSystem: {
		origin: 'centre-bottom',
		horizontalAxis: 'right',
		verticalAxis: 'up',
		lengthUnit: 'metre'
	},
	bounds: { width: 20, height: 10 },
	staticColliders: [
		{
			id: 'floor',
			motionAuthority: 'static',
			physicalShape: { type: 'line-segment', start: [-10, 0], end: [10, 0] }
		}
	],
	terminationRegions: []
} as const;

function body(
	id: string,
	position: readonly [number, number],
	velocity: readonly [number, number],
	releaseTime = 0
): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.5 },
		mass: id === 'body-a' ? 2 : 3,
		position,
		velocity,
		releaseTime
	};
}

function flight(
	value: InitialDynamicCircleBodyState,
	startTime: number,
	endTime: number,
	startPosition = value.position,
	startVelocity = value.velocity
): MotionSegment {
	return {
		type: 'free-flight',
		bodyId: value.id,
		startTime,
		endTime,
		startPosition,
		startVelocity,
		acceleration: [0, 0]
	};
}

function activeState(value: InitialDynamicCircleBodyState, untilTime: number): BodyRunState {
	return {
		bodyId: value.id,
		lifecycle: 'active',
		releaseTime: value.releaseTime,
		activeFromTime: value.releaseTime,
		recordedUntilTime: untilTime,
		terminalOutcome: null
	};
}

function release(value: InitialDynamicCircleBodyState) {
	return {
		type: 'body-release' as const,
		time: value.releaseTime,
		bodyId: value.id,
		position: value.position,
		velocity: value.velocity,
		status: 'released' as const,
		reason: null
	};
}

function partialRun(
	input: SimulationInput,
	bodyStates: readonly BodyRunState[],
	trajectories: SimulationRunRecord['trajectories'],
	releases: SimulationRunRecord['releases'],
	extra: Partial<
		Pick<
			SimulationRunRecord,
			'dynamicContacts' | 'contactComponents' | 'componentEvents' | 'outcome' | 'terminalReason'
		>
	> & {
		readonly bodyEventHorizons?: SimulationRunRecord['diagnostics']['bodyEventHorizons'];
		readonly pairPredictions?: SimulationRunRecord['diagnostics']['pairPredictions'];
	} = {}
): SimulationRunRecord {
	const outcome = extra.outcome ?? 'time-limit';
	const terminalReason = extra.terminalReason ?? { type: 'time-limit', time: 4, limit: 4 };
	return {
		contractVersion: 7,
		input,
		validity: 'valid',
		outcome,
		terminalReason,
		bodyStates,
		trajectories,
		events: [],
		releases,
		dynamicContacts: extra.dynamicContacts ?? [],
		contactComponents: extra.contactComponents ?? [],
		componentEvents: extra.componentEvents ?? [],
		diagnostics: {
			iterations: 0,
			simulatedUntilTime: 4,
			eventCount: 0,
			candidateCount: 0,
			segmentCount: trajectories.reduce((sum, trajectory) => sum + trajectory.segments.length, 0),
			simulationWallTimeMilliseconds: 0,
			contactSearches: [],
			bodyEventHorizons: extra.bodyEventHorizons ?? [],
			pairPredictions: extra.pairPredictions ?? [],
			entries: [
				{
					severity: 'warning',
					code: outcome === 'unresolved' ? 'RUN_UNRESOLVED' : 'RUN_TIME_LIMIT',
					message: 'Synthetic contract fixture boundary.',
					time: 4,
					bodyId: null
				}
			]
		}
	};
}

const independentA = body('body-a', [-3, 3], [1, 0]);
const independentB = body('body-b', [3, 5], [-1, 0]);
const independentInput = { scene, initialDynamicBodies: [independentB, independentA], settings };

export const twoIndependentBodiesFixture = partialRun(
	independentInput,
	[activeState(independentA, 4), activeState(independentB, 4)],
	[
		{ bodyId: independentA.id, segments: [flight(independentA, 0, 4)] },
		{ bodyId: independentB.id, segments: [flight(independentB, 0, 4)] }
	],
	[release(independentA), release(independentB)]
);

const staggeredA = body('body-a', [-3, 3], [1, 0]);
const staggeredB = body('body-b', [3, 5], [-1, 0], 10);
export const staggeredReleaseFixture = partialRun(
	{ scene, initialDynamicBodies: [staggeredB, staggeredA], settings },
	[
		activeState(staggeredA, 4),
		{
			bodyId: staggeredB.id,
			lifecycle: 'scheduled',
			releaseTime: 10,
			activeFromTime: null,
			recordedUntilTime: null,
			terminalOutcome: null
		}
	],
	[{ bodyId: staggeredA.id, segments: [flight(staggeredA, 0, 4)] }],
	[release(staggeredA)]
);

const completedA = body('body-a', [-3, 3], [1, 0]);
const continuingB = body('body-b', [3, 5], [-1, 0]);
export const completedWhileActiveFixture = partialRun(
	{ scene, initialDynamicBodies: [completedA, continuingB], settings },
	[
		{
			bodyId: completedA.id,
			lifecycle: 'completed',
			releaseTime: 0,
			activeFromTime: 0,
			recordedUntilTime: 2,
			terminalOutcome: 'completed'
		},
		activeState(continuingB, 4)
	],
	[
		{ bodyId: completedA.id, segments: [flight(completedA, 0, 2)] },
		{ bodyId: continuingB.id, segments: [flight(continuingB, 0, 4)] }
	],
	[release(completedA), release(continuingB)]
);

const contactA = body('body-a', [-2, 4], [1, 0]);
const contactB = body('body-b', [2, 4], [-1, 0]);
export const bodyContactFixture = partialRun(
	{ scene, initialDynamicBodies: [contactA, contactB], settings },
	[activeState(contactA, 4), activeState(contactB, 4)],
	[
		{
			bodyId: contactA.id,
			segments: [flight(contactA, 0, 2), flight(contactA, 2, 4, [0, 4], [-1, 0])]
		},
		{
			bodyId: contactB.id,
			segments: [flight(contactB, 0, 2), flight(contactB, 2, 4, [0, 4], [1, 0])]
		}
	],
	[release(contactA), release(contactB)],
	{
		dynamicContacts: [
			{
				id: 'contact-a-b-2',
				time: 2,
				participants: [
					{ type: 'body', bodyId: contactA.id },
					{ type: 'body', bodyId: contactB.id }
				],
				contactPoint: [0, 4],
				normalFromFirstToSecond: [1, 0],
				preImpactNormalVelocity: -2,
				postImpactNormalVelocity: 2,
				impulse: 4,
				state: 'released'
			}
		],
		contactComponents: [
			{
				id: 'impact-a-b-2',
				type: 'exact-time-impact',
				createdAtTime: 2,
				dissolvedAtTime: 2,
				bodyIds: [contactA.id, contactB.id],
				fixedColliderIds: [],
				activeContactIds: ['contact-a-b-2'],
				retainedSupportReactions: []
			}
		],
		componentEvents: [
			{
				type: 'contact-component-lifecycle',
				time: 2,
				change: 'created',
				componentIds: [],
				resultingComponentIds: ['impact-a-b-2']
			},
			{
				type: 'contact-component-lifecycle',
				time: 2,
				change: 'dissolved',
				componentIds: ['impact-a-b-2'],
				resultingComponentIds: []
			}
		],
		bodyEventHorizons: [
			{
				bodyId: contactA.id,
				interval: [0, 2],
				revision: { bodyId: contactA.id, revision: 0 },
				eventType: 'body-contact'
			},
			{
				bodyId: contactB.id,
				interval: [0, 2],
				revision: { bodyId: contactB.id, revision: 0 },
				eventType: 'body-contact'
			}
		],
		pairPredictions: [
			{
				id: 'prediction-a-b-0',
				bodyIds: [contactA.id, contactB.id],
				predictedTime: 2,
				validInterval: [0, 2],
				revisions: [
					{ bodyId: contactA.id, revision: 0 },
					{ bodyId: contactB.id, revision: 0 }
				],
				decision: 'selected',
				reason: 'Earliest certified pair event in the shared validity interval.'
			}
		]
	}
);

const restingA = body('body-a', [-2, 0.5], [0, 0]);
const incomingB = body('body-b', [3, 4], [-1, 0], 2);
export const restingThenIncomingFixture = partialRun(
	{ scene, initialDynamicBodies: [restingA, incomingB], settings },
	[{ ...activeState(restingA, 4), lifecycle: 'resting' }, activeState(incomingB, 4)],
	[
		{
			bodyId: restingA.id,
			segments: [
				{
					type: 'stationary',
					bodyId: restingA.id,
					startTime: 0,
					endTime: 4,
					startPosition: restingA.position,
					startVelocity: [0, 0],
					reason: 'dormant-component',
					componentId: 'resting-a-floor'
				}
			]
		},
		{ bodyId: incomingB.id, segments: [flight(incomingB, 2, 4)] }
	],
	[release(restingA), release(incomingB)],
	{
		dynamicContacts: [
			{
				id: 'contact-a-floor',
				time: 0,
				participants: [
					{ type: 'fixed-collider', colliderId: 'floor' },
					{ type: 'body', bodyId: restingA.id }
				],
				contactPoint: [-2, 0],
				normalFromFirstToSecond: [0, 1],
				preImpactNormalVelocity: 0,
				postImpactNormalVelocity: 0,
				impulse: 0,
				state: 'retained'
			}
		],
		contactComponents: [
			{
				id: 'resting-a-floor',
				type: 'resting-anchored',
				createdAtTime: 0,
				dissolvedAtTime: null,
				bodyIds: [restingA.id],
				fixedColliderIds: ['floor'],
				activeContactIds: ['contact-a-floor'],
				retainedSupportReactions: [{ contactId: 'contact-a-floor', impulsePerTime: 0 }]
			}
		],
		componentEvents: [
			{
				type: 'contact-component-lifecycle',
				time: 0,
				change: 'created',
				componentIds: [],
				resultingComponentIds: ['resting-a-floor']
			}
		]
	}
);

const unresolvedA = body('body-a', [-2, 4], [1, 0]);
const unresolvedB = body('body-b', [2, 4], [-1, 0]);
export const unresolvedPrefixFixture = partialRun(
	{ scene, initialDynamicBodies: [unresolvedA, unresolvedB], settings },
	[
		{ ...activeState(unresolvedA, 4), lifecycle: 'unresolved', terminalOutcome: 'unresolved' },
		{ ...activeState(unresolvedB, 4), lifecycle: 'unresolved', terminalOutcome: 'unresolved' }
	],
	[
		{ bodyId: unresolvedA.id, segments: [flight(unresolvedA, 0, 4)] },
		{ bodyId: unresolvedB.id, segments: [flight(unresolvedB, 0, 4)] }
	],
	[release(unresolvedA), release(unresolvedB)],
	{
		outcome: 'unresolved',
		terminalReason: {
			type: 'unresolved-collision-search',
			time: 4,
			detail: 'Pair root could not be certified.'
		}
	}
);

export const duplicateBodyIdsFixture: unknown = {
	...twoIndependentBodiesFixture,
	input: {
		...twoIndependentBodiesFixture.input,
		initialDynamicBodies: [independentA, { ...independentB, id: independentA.id }]
	}
};

export const overlappingReleaseFixture: unknown = {
	...twoIndependentBodiesFixture,
	input: {
		...twoIndependentBodiesFixture.input,
		initialDynamicBodies: [independentA, { ...independentB, position: independentA.position }]
	}
};

export const validMultiBodyContractFixtures = [
	twoIndependentBodiesFixture,
	staggeredReleaseFixture,
	completedWhileActiveFixture,
	bodyContactFixture,
	restingThenIncomingFixture,
	unresolvedPrefixFixture
] as const;
