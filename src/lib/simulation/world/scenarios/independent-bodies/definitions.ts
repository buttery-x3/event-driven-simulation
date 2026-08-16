import type {
	InitialDynamicCircleBodyState,
	SceneDefinition,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../../contracts';
import { defaultCanonicalPlinkoScenario } from '../canonical-launches';
import type { VerificationScenario } from '../types';

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

const staggeredInput = schedulerInput(
	'staggered-independent-drops-board',
	[
		body('drop-early', [-6, 10], [0, 0], 0),
		body('drop-middle', [0, 10], [0, 0], 0.75),
		body('drop-late', [6, 10], [0, 0], 1.5)
	],
	[]
);

const mixedInput = schedulerInput(
	'mixed-independent-outcomes-board',
	[
		body('completed-body', [-6, 11], [2, 0], 0),
		body('resting-body', [0, 2], [0, 0], 0),
		body('continuing-body', [6, 10], [1, 0], 0)
	],
	[floor('rest-floor', -1, 1)],
	[
		{
			id: 'left-completion',
			type: 'axis-aligned-box',
			purpose: 'complete',
			minimum: [-4.1, 4],
			maximum: [-3.9, 9]
		}
	]
);

const restingContinuationInput = schedulerInput(
	'resting-while-another-continues-board',
	[body('early-rest', [-4, 2], [0, 0], 0), body('multi-event-body', [4, 8], [0, 0], 0)],
	[floor('left-rest-floor', -6, -2), floor('right-bounce-floor', 2, 6)],
	[],
	0.55
);

const simultaneousInput = schedulerInput(
	'simultaneous-independent-events-board',
	[body('simultaneous-left', [-4, 4], [0, 0], 0), body('simultaneous-right', [4, 4], [0, 0], 0)],
	[floor('simultaneous-left-floor', -6, -2), floor('simultaneous-right-floor', 2, 6)],
	[],
	0
);

export const independentBodySchedulerScenarios = [
	scenario(
		'staggered-independent-drops',
		'Staggered independent drops',
		'Scheduled releases enter one monotonic world history while existing free-flight predictions remain continuous.',
		['escaped'],
		'scheduler.staggered-releases',
		staggeredInput
	),
	scenario(
		'mixed-independent-outcomes',
		'Mixed independent outcomes',
		'Completed, escaped and dormant bodies retain separate lifecycle outcomes before the aggregate world completes.',
		['settled'],
		'scheduler.mixed-outcomes',
		mixedInput
	),
	scenario(
		'resting-while-another-continues',
		'Resting while another continues',
		'One body receives a single stationary coverage interval while another advances through repeated fixed-world events.',
		['settled'],
		'scheduler.resting-continuation',
		restingContinuationInput,
		{
			summary: 'The continuing body records several impacts after the other body becomes dormant.',
			minimumContactEvents: 3
		}
	),
	scenario(
		'simultaneous-independent-events',
		'Simultaneous independent events',
		'Two spatially separated contacts share an exact world time and use deterministic body-ID batch ordering.',
		['settled'],
		'scheduler.simultaneous-events',
		simultaneousInput,
		{
			summary: 'Both independent fixed-world contacts occur at the same exact simulation time.',
			minimumContactEvents: 2
		}
	),
	scenario(
		'single-body-scheduler-equivalence',
		'Single-body scheduler equivalence',
		'The canonical verified single-body input is routed through the same world scheduler used for several bodies.',
		defaultCanonicalPlinkoScenario.expectedOutcomes,
		'scheduler.single-body-equivalence',
		defaultCanonicalPlinkoScenario.input,
		defaultCanonicalPlinkoScenario.expectedEventCharacteristics
	)
] as const satisfies readonly VerificationScenario[];

function scenario(
	id: string,
	name: string,
	verificationPurpose: string,
	expectedOutcomes: VerificationScenario['expectedOutcomes'],
	coverage: VerificationScenario['coverage'][number],
	input: SimulationInput,
	expectedEventCharacteristics: VerificationScenario['expectedEventCharacteristics'] = null
): VerificationScenario {
	return {
		id,
		name,
		categoryId: 'multi-body-scheduler',
		verificationPurpose,
		expectedOutcomes,
		expectedEventCharacteristics,
		replayExpectation: 'complete',
		coverage: [coverage],
		regressionFixture: false,
		input
	};
}

function schedulerInput(
	id: string,
	bodies: readonly InitialDynamicCircleBodyState[],
	staticColliders: readonly StaticCollider[],
	terminationRegions: SceneDefinition['terminationRegions'] = [],
	restitution = 0
): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width: 16, height: 12 },
			staticColliders,
			terminationRegions
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity: [0, -9.81],
			restitution,
			contactCaptureDistance: 1e-9,
			maximumEvents: 100,
			maximumSimulationTime: 20,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function body(
	id: string,
	position: Vec2,
	velocity: Vec2,
	releaseTime: number
): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.25 },
		mass: 1,
		position,
		velocity,
		releaseTime
	};
}

function floor(id: string, startX: number, endX: number): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [startX, 0], end: [endX, 0] }
	};
}
