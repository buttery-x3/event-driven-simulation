import type { SimulationRunRecord } from '$lib/simulation/contracts';
import {
	flight,
	releasedState,
	stationary,
	syntheticBody,
	syntheticRun,
	terminalState
} from './synthetic-run-builder';

export interface SyntheticWorkbenchFixture {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly run: SimulationRunRecord;
}

const staggeredBodies = Array.from({ length: 20 }, (_, index) =>
	syntheticBody(
		`staggered-${String(index + 1).padStart(2, '0')}`,
		[-9 + (index % 10) * 2, 2 + Math.floor(index / 10) * 3],
		[index % 2 === 0 ? 0.2 : -0.2, 0],
		index * 0.2,
		{ mass: 1 + index * 0.1 }
	)
);
const staggeredHorizon = 6;

const contactA = syntheticBody('contact-a', [-3, 5], [1, 0], 0, { mass: 2, radius: 0.5 });
const contactB = syntheticBody('contact-b', [3, 5], [-1, 0], 0, { mass: 2, radius: 0.5 });

const resting = syntheticBody('resting-body', [-3, 0.25], [0, 0], 0, {
	mass: 4,
	radius: 0.25
});
const active = syntheticBody('active-body', [4, 6], [-0.5, 0], 2, { mass: 1.5 });

const splitA = syntheticBody('split-a', [-2, 4], [0, 0]);
const splitB = syntheticBody('split-b', [0, 4], [0, 0]);
const splitC = syntheticBody('split-c', [2, 4], [0, 0]);

const partialA = syntheticBody('partial-a', [-3, 7], [0.5, -0.2]);
const partialB = syntheticBody('partial-b', [3, 7], [-0.5, -0.2], 1);

const staggeredRun = syntheticRun(
	staggeredBodies,
	staggeredBodies.map((body) => releasedState(body, staggeredHorizon)),
	staggeredBodies.map((body) => ({
		bodyId: body.id,
		segments: [flight(body, body.releaseTime, staggeredHorizon)]
	})),
	staggeredHorizon,
	{
		bodyEventHorizons: staggeredBodies.map((body) => ({
			bodyId: body.id,
			interval: [body.releaseTime, staggeredHorizon],
			revision: { bodyId: body.id, revision: 0 },
			eventType: 'none'
		}))
	}
);

const twoBodyContactRun = syntheticRun(
	[contactA, contactB],
	[releasedState(contactA, 6), releasedState(contactB, 6)],
	[
		{
			bodyId: contactA.id,
			segments: [flight(contactA, 0, 2.5), flight(contactA, 2.5, 6, [-0.5, 5], [-1, 0])]
		},
		{
			bodyId: contactB.id,
			segments: [flight(contactB, 0, 2.5), flight(contactB, 2.5, 6, [0.5, 5], [1, 0])]
		}
	],
	6,
	{
		dynamicContacts: [
			{
				id: 'contact-a-b',
				time: 2.5,
				participants: [
					{ type: 'body', bodyId: contactA.id },
					{ type: 'body', bodyId: contactB.id }
				],
				contactPoint: [0, 5],
				normalFromFirstToSecond: [1, 0],
				preImpactNormalVelocity: -2,
				postImpactNormalVelocity: 2,
				impulse: 4,
				state: 'released'
			}
		],
		contactComponents: [
			{
				id: 'impact-a-b',
				type: 'exact-time-impact',
				createdAtTime: 2.5,
				dissolvedAtTime: 2.5,
				bodyIds: [contactA.id, contactB.id],
				fixedColliderIds: [],
				activeContactIds: ['contact-a-b'],
				retainedSupportReactions: []
			}
		],
		componentEvents: [
			{
				type: 'contact-component-lifecycle',
				time: 2.5,
				change: 'created',
				componentIds: [],
				resultingComponentIds: ['impact-a-b']
			},
			{
				type: 'contact-component-lifecycle',
				time: 2.5,
				change: 'dissolved',
				componentIds: ['impact-a-b'],
				resultingComponentIds: []
			}
		],
		bodyEventHorizons: [contactA, contactB].map((body) => ({
			bodyId: body.id,
			interval: [0, 2.5],
			revision: { bodyId: body.id, revision: 0 },
			eventType: 'body-contact'
		})),
		pairPredictions: [
			{
				id: 'pair-a-b-r0',
				bodyIds: [contactA.id, contactB.id],
				predictedTime: 2.5,
				validInterval: [0, 2.5],
				revisions: [
					{ bodyId: contactA.id, revision: 0 },
					{ bodyId: contactB.id, revision: 0 }
				],
				decision: 'selected',
				reason: 'The exact-time pair contact invalidated both prior independent futures.'
			}
		]
	}
);

const restingAndActiveRun = syntheticRun(
	[resting, active],
	[releasedState(resting, 6, 'resting'), releasedState(active, 6)],
	[
		{ bodyId: resting.id, segments: [stationary(resting, 6, 'resting-floor')] },
		{ bodyId: active.id, segments: [flight(active, 2, 6)] }
	],
	6,
	{
		dynamicContacts: [
			{
				id: 'resting-floor-contact',
				time: 0,
				participants: [
					{ type: 'fixed-collider', colliderId: 'floor' },
					{ type: 'body', bodyId: resting.id }
				],
				contactPoint: [-3, 0],
				normalFromFirstToSecond: [0, 1],
				preImpactNormalVelocity: 0,
				postImpactNormalVelocity: 0,
				impulse: 0,
				state: 'retained'
			}
		],
		contactComponents: [
			{
				id: 'resting-floor',
				type: 'resting-anchored',
				createdAtTime: 0,
				dissolvedAtTime: null,
				bodyIds: [resting.id],
				fixedColliderIds: ['floor'],
				activeContactIds: ['resting-floor-contact'],
				retainedSupportReactions: [{ contactId: 'resting-floor-contact', impulsePerTime: 0 }]
			}
		],
		componentEvents: [
			{
				type: 'contact-component-lifecycle',
				time: 0,
				change: 'created',
				componentIds: [],
				resultingComponentIds: ['resting-floor']
			}
		]
	}
);

const splitContacts = [
	{
		id: 'split-a-b-contact',
		time: 2,
		participants: [
			{ type: 'body' as const, bodyId: splitA.id },
			{ type: 'body' as const, bodyId: splitB.id }
		] as const,
		contactPoint: [-1, 4] as const,
		normalFromFirstToSecond: [1, 0] as const,
		preImpactNormalVelocity: 0,
		postImpactNormalVelocity: 0,
		impulse: 0,
		state: 'released' as const
	},
	{
		id: 'split-b-c-contact',
		time: 2,
		participants: [
			{ type: 'body' as const, bodyId: splitB.id },
			{ type: 'body' as const, bodyId: splitC.id }
		] as const,
		contactPoint: [1, 4] as const,
		normalFromFirstToSecond: [1, 0] as const,
		preImpactNormalVelocity: 0,
		postImpactNormalVelocity: 0,
		impulse: 0,
		state: 'released' as const
	}
];

const componentSplitRun = syntheticRun(
	[splitA, splitB, splitC],
	[releasedState(splitA, 5), releasedState(splitB, 5), releasedState(splitC, 5)],
	[splitA, splitB, splitC].map((body) => ({ bodyId: body.id, segments: [flight(body, 0, 5)] })),
	5,
	{
		dynamicContacts: splitContacts,
		contactComponents: [
			{
				id: 'component-before-split',
				type: 'exact-time-impact',
				createdAtTime: 2,
				dissolvedAtTime: 2,
				bodyIds: [splitA.id, splitB.id, splitC.id],
				fixedColliderIds: [],
				activeContactIds: splitContacts.map(({ id }) => id),
				retainedSupportReactions: []
			},
			{
				id: 'component-left-after-split',
				type: 'exact-time-impact',
				createdAtTime: 2,
				dissolvedAtTime: 2,
				bodyIds: [splitA.id, splitB.id],
				fixedColliderIds: [],
				activeContactIds: ['split-a-b-contact'],
				retainedSupportReactions: []
			},
			{
				id: 'component-right-after-split',
				type: 'exact-time-impact',
				createdAtTime: 2,
				dissolvedAtTime: 2,
				bodyIds: [splitC.id],
				fixedColliderIds: [],
				activeContactIds: [],
				retainedSupportReactions: []
			}
		],
		componentEvents: [
			{
				type: 'contact-component-lifecycle',
				time: 2,
				change: 'split',
				componentIds: ['component-before-split'],
				resultingComponentIds: ['component-left-after-split', 'component-right-after-split']
			}
		]
	}
);

const partialRun = syntheticRun(
	[partialA, partialB],
	[terminalState(partialA, 3.5, 'unresolved'), terminalState(partialB, 3.5, 'unresolved')],
	[
		{ bodyId: partialA.id, segments: [flight(partialA, 0, 3.5)] },
		{ bodyId: partialB.id, segments: [flight(partialB, 1, 3.5)] }
	],
	3.5,
	{
		outcome: 'unresolved',
		terminalReason: {
			type: 'unresolved-collision-search',
			time: 3.5,
			detail: 'Synthetic pair prediction could not be certified beyond this committed prefix.'
		},
		pairPredictions: [
			{
				id: 'partial-pair-r2',
				bodyIds: [partialA.id, partialB.id],
				predictedTime: null,
				validInterval: [3, 3.5],
				revisions: [
					{ bodyId: partialA.id, revision: 2 },
					{ bodyId: partialB.id, revision: 1 }
				],
				decision: 'invalidated',
				reason: 'The unresolved shared future ends at the certified prefix boundary.'
			}
		]
	}
);

export const syntheticMultiBodyFixtures = [
	{
		id: 'synthetic-staggered-releases',
		name: 'synthetic-staggered-releases.json',
		description: 'Twenty bodies released on a staggered schedule.',
		run: staggeredRun
	},
	{
		id: 'synthetic-two-body-contact',
		name: 'synthetic-two-body-contact.json',
		description: 'Two bodies exchange velocity at one exact-time contact.',
		run: twoBodyContactRun
	},
	{
		id: 'synthetic-resting-and-active',
		name: 'synthetic-resting-and-active.json',
		description: 'An anchored resting body remains visible while another body moves.',
		run: restingAndActiveRun
	},
	{
		id: 'synthetic-component-split',
		name: 'synthetic-component-split.json',
		description: 'An exact-time contact component splits into two recorded components.',
		run: componentSplitRun
	},
	{
		id: 'synthetic-partial-multi-body-run',
		name: 'synthetic-partial-multi-body-run.json',
		description: 'Two unresolved bodies stop at a certified partial-history boundary.',
		run: partialRun
	}
] as const satisfies readonly SyntheticWorkbenchFixture[];
