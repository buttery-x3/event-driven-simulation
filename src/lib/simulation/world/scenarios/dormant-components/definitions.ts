import type {
	InitialDynamicCircleBodyState,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../../contracts';
import type { ScenarioCoverageId, VerificationScenario } from '../types';

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

export const dormantComponentScenarios = [
	scenario(
		'wedged-ball-remains-anchored',
		'Wedged ball remains anchored',
		'An inelastic incoming body transfers load through a dynamic ball into two certified fixed supports.',
		'dormant.wedged-remains-anchored',
		input(
			'wedged-ball-remains-anchored-board',
			[body('wedged', [0, 1], [0, 0]), body('incoming', [0, 3], [0, -2], 0.25)],
			wedgeSupports(),
			0
		),
		['settled']
	),
	scenario(
		'wedged-ball-dislodged',
		'Wedged ball dislodged',
		'An oblique elastic impact releases incompatible wedge contacts and reactivates the dynamic member.',
		'dormant.wedged-dislodged',
		input(
			'wedged-ball-dislodged-board',
			[body('wedged', [0, 1], [0, 0]), body('incoming', [-3, 1.8], [6, -1], 0.25)],
			wedgeSupports(),
			1
		),
		['escaped']
	),
	scenario(
		'resting-stack-reactivated',
		'Resting stack reactivated',
		'A floor-supported two-body stack is an initial dormant component before a moving body wakes it.',
		'dormant.stack-reactivated',
		input(
			'resting-stack-reactivated-board',
			[
				body('stack-lower', [0, 0.5], [0, 0]),
				body('stack-upper', [0, 1.5], [0, 0]),
				body('striker', [-3, 0.5], [6, 3], 0.25)
			],
			[floor()],
			0.5
		),
		['time-limit']
	),
	scenario(
		'component-splits-after-impact',
		'Component splits after impact',
		'An off-centre impact launches one member while a floor-supported subset remains dormant.',
		'dormant.component-split',
		input(
			'component-splits-after-impact-board',
			[
				body('left-supported', [-0.5, 0.5], [0, 0]),
				body('right-supported', [0.5, 0.5], [0, 0]),
				body('incoming', [0.1, 3], [0.5, -5], 0.25)
			],
			[floor()],
			0.75
		),
		['settled']
	),
	scenario(
		'resting-body-while-world-continues',
		'Resting body while world continues',
		'A certified dormant component retains stationary coverage while an unrelated body continues moving.',
		'dormant.world-continues',
		input(
			'resting-body-while-world-continues-board',
			[body('resting', [-3, 0.5], [0, 0]), body('continuing', [3, 5], [2, 0])],
			[floor('rest-floor', -5, -1)],
			0.5
		),
		['settled']
	),
	scenario(
		'unsupported-floating-cluster',
		'Unsupported floating cluster',
		'A touching group without fixed-world support remains active under gravity and is never marked resting.',
		'dormant.unsupported-floating',
		input(
			'unsupported-floating-cluster-board',
			[body('floating-lower', [0, 4], [0, 0]), body('floating-upper', [0, 5], [0, 0])],
			[],
			0
		),
		['escaped']
	)
] as const satisfies readonly VerificationScenario[];

function scenario(
	id: string,
	name: string,
	verificationPurpose: string,
	coverage: ScenarioCoverageId,
	scenarioInput: SimulationInput,
	expectedOutcomes: VerificationScenario['expectedOutcomes']
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
	staticColliders: readonly StaticCollider[],
	restitution: number
): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width: 12, height: 8 },
			staticColliders,
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity: [0, -2],
			restitution,
			maximumEvents: 100,
			maximumSimulationTime: 4,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function body(
	id: string,
	position: Vec2,
	velocity: Vec2,
	releaseTime = 0
): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.5 },
		mass: 1,
		position,
		velocity,
		releaseTime
	};
}

function wedgeSupports(): readonly StaticCollider[] {
	return [peg('wedge-left', [-0.6, 0.2]), peg('wedge-right', [0.6, 0.2])];
}

function peg(id: string, centre: Vec2): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		centre,
		physicalShape: { type: 'circle', radius: 0.5 }
	};
}

function floor(id = 'floor', startX = -5, endX = 5): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [startX, 0], end: [endX, 0] }
	};
}
