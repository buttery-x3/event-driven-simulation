import type {
	InitialDynamicCircleBodyState,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../../contracts';
import type { VerificationScenario } from '../types';

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

export const dynamicPairScenarios = [
	scenario(
		'equal-mass-head-on',
		'Equal-mass head-on',
		'Equal masses exchange their normal velocities under unit restitution.',
		'pair.equal-mass-head-on',
		input(
			'equal-mass-head-on-board',
			[body('left', [-3, 5], [1, 0]), body('right', [3, 5], [-1, 0])],
			[],
			[0, 0],
			1
		)
	),
	scenario(
		'unequal-mass-head-on',
		'Unequal-mass head-on',
		'Closed-form impulse exchange uses both positive body masses.',
		'pair.unequal-mass-head-on',
		input(
			'unequal-mass-head-on-board',
			[body('light', [-3, 5], [2, 0], 1), body('heavy', [3, 5], [0, 0], 3)],
			[],
			[0, 0],
			1
		)
	),
	scenario(
		'glancing-impulse-transfer',
		'Glancing impulse transfer',
		'Only velocity along the contact normal changes during a frictionless glancing impact.',
		'pair.glancing-impulse-transfer',
		input(
			'glancing-impulse-transfer-board',
			[body('glance-left', [-3, 4.6], [1, 0]), body('glance-right', [3, 5.4], [-1, 0])],
			[],
			[0, 0],
			0.75
		)
	),
	scenario(
		'peg-event-interrupted-by-ball',
		'Peg event interrupted by ball',
		"An earlier rear impact invalidates and rebuilds a heavy runner's predicted peg event.",
		'pair.peg-event-interrupted',
		input(
			'peg-event-interrupted-by-ball-board',
			[body('peg-runner', [-4, 5], [2, 0], 10), body('rear-ball', [-7, 5], [4, 0], 1)],
			[peg('target-peg', [2, 5])],
			[0, 0],
			1,
			3
		)
	),
	scenario(
		'unrelated-prediction-survives',
		'Unrelated prediction survives',
		'An A/B impact retains the revision-stamped future prediction between unchanged C and D.',
		'pair.unrelated-prediction-survives',
		input(
			'unrelated-prediction-survives-board',
			[
				body('a', [-3, 3], [2, 0]),
				body('b', [2, 3], [-2, 0]),
				body('c', [-4, 7], [1, 0]),
				body('d', [4, 7], [-1, 0])
			],
			[],
			[0, 0],
			1,
			5
		)
	),
	scenario(
		'repeated-isolated-collisions',
		'Repeated isolated collisions',
		'Several pair impacts resolve over strictly positive world intervals.',
		'pair.repeated-isolated-collisions',
		input(
			'repeated-isolated-collisions-board',
			[
				body('left', [-5, 5], [3, 0]),
				body('middle', [0, 5], [0, 0]),
				body('right', [5, 5], [-1, 0])
			],
			[],
			[0, 0],
			1,
			6
		)
	)
] as const satisfies readonly VerificationScenario[];

function scenario(
	id: string,
	name: string,
	verificationPurpose: string,
	coverage: VerificationScenario['coverage'][number],
	scenarioInput: SimulationInput,
	expectedOutcomes: VerificationScenario['expectedOutcomes'] = ['time-limit']
): VerificationScenario {
	return {
		id,
		name,
		categoryId: 'multi-body-scheduler',
		verificationPurpose,
		expectedOutcomes,
		expectedEventCharacteristics: null,
		replayExpectation: expectedOutcomes.includes('unresolved') ? 'valid-prefix' : 'complete',
		coverage: [coverage],
		regressionFixture: false,
		input: scenarioInput
	};
}

function input(
	id: string,
	bodies: readonly InitialDynamicCircleBodyState[],
	staticColliders: readonly StaticCollider[] = [],
	gravity: Vec2 = [0, 0],
	restitution = 1,
	maximumSimulationTime = 6
): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width: 20, height: 10 },
			staticColliders,
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity,
			restitution,
			maximumEvents: 100,
			maximumSimulationTime,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function body(id: string, position: Vec2, velocity: Vec2, mass = 1): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.5 },
		mass,
		position,
		velocity,
		releaseTime: 0
	};
}

function peg(id: string, centre: Vec2): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'circle', radius: 0.5 },
		centre
	};
}
