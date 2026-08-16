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

export const pathInterruptionScenarios = [
	scenario(
		'free-ball-hits-peg-slider',
		'Free ball hits peg slider',
		'A free-flight body interrupts another body moving authoritatively around a fixed peg.',
		'path-interruption.free-circular',
		input(
			'free-ball-hits-peg-slider-board',
			[body('peg-slider', [0, 3], [0.6, 0]), body('free-striker', [2.4, 3], [-5, 0], 1, 0.15)],
			[peg('slider-peg', [0, 2])],
			[0, -2],
			1,
			3
		),
		['escaped']
	),
	scenario(
		'slider-interrupted-before-detachment',
		'Slider interrupted before detachment',
		'A body-body impact invalidates a circular support-loss prediction before it can execute.',
		'path-interruption.before-detachment',
		input(
			'slider-interrupted-before-detachment-board',
			[
				body('detaching-slider', [0, 3], [0.6, 0]),
				body('detachment-interrupter', [2.4, 3], [-5, 0], 1, 0.15)
			],
			[peg('detachment-peg', [0, 2])],
			[0, -2],
			0.8,
			3
		),
		['escaped', 'time-limit']
	),
	scenario(
		'linear-slider-hit-sideways',
		'Linear slider hit sideways',
		'A floor-supported linear path is interrupted and its support is reconsidered in the coupled solve.',
		'path-interruption.linear-side-impact',
		input(
			'linear-slider-hit-sideways-board',
			[body('line-slider', [-2, 0.5], [2, 0]), body('side-striker', [-1, 3.75], [0, -4])],
			[floor()],
			[0, -2],
			0.5,
			3
		),
		['settled', 'escaped', 'time-limit']
	),
	scenario(
		'resting-component-hit-by-slider',
		'Resting component hit by slider',
		'Sustained floor motion interrupts and reactivates an anchored dormant body.',
		'path-interruption.slider-reactivates-resting',
		input(
			'resting-component-hit-by-slider-board',
			[body('floor-slider', [-2, 0.5], [2, 0]), body('anchored-body', [1, 0.5], [0, 0])],
			[floor()],
			[0, -2],
			0.8,
			3
		),
		['time-limit', 'settled']
	),
	scenario(
		'two-circular-paths-approach',
		'Two circular paths approach',
		'Two fixed-peg circular paths use bounded continuous isolation to discover their approach.',
		'path-interruption.circular-circular',
		input(
			'two-circular-paths-approach-board',
			[body('left-circular', [-1, 3], [1, 0]), body('right-circular', [1, 3], [-1, 0])],
			[peg('left-peg', [-1, 2]), peg('right-peg', [1, 2])],
			[0, -2],
			1,
			1.2
		),
		['time-limit']
	),
	scenario(
		'unsupported-dynamic-support-after-impact',
		'Unsupported dynamic support after impact',
		'A certified impact ends explicitly when continuation would require persistent dynamic support.',
		'path-interruption.unsupported-dynamic-support',
		input(
			'unsupported-dynamic-support-after-impact-board',
			[
				body('supported-slider', [0, 3], [0.6, 0]),
				body('captured-striker', [2.4, 3], [-5, 0], 1, 0.15)
			],
			[peg('capture-peg', [0, 2])],
			[0, -2],
			0,
			3
		),
		['unresolved']
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
	gravity: Vec2,
	restitution: number,
	maximumSimulationTime: number
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
			gravity,
			restitution,
			contactCaptureDistance: 1e-9,
			maximumEvents: 100,
			maximumSimulationTime,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function body(
	id: string,
	position: Vec2,
	velocity: Vec2,
	mass = 1,
	releaseTime = 0
): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.5 },
		mass,
		position,
		velocity,
		releaseTime
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

function floor(): StaticCollider {
	return {
		id: 'floor',
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [-5, 0], end: [5, 0] }
	};
}
