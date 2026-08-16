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

export const dynamicSupportScenarios = [
	scenario(
		'ball-slides-on-wedged-ball',
		'Ball slides on wedged ball',
		'A moving body follows a certified circular path around a dynamic body wedged between fixed pegs.',
		'dynamic-support.circular-slide',
		wedgeInput('ball-slides-on-wedged-ball-board', 0.65, 0.6),
		['time-limit']
	),
	scenario(
		'transmitted-load-remains-supported',
		'Transmitted load remains supported',
		'The anchored peg network carries equal-and-opposite load from a short dynamic-support interval.',
		'dynamic-support.transmitted-load-retained',
		wedgeInput('transmitted-load-remains-supported-board', 0.4, 0.25),
		['time-limit']
	),
	scenario(
		'transmitted-load-releases-support',
		'Transmitted load releases support',
		'A changing body-body reaction drives one required peg reaction to its exact unilateral boundary.',
		'dynamic-support.transmitted-load-release',
		wedgeInput(
			'transmitted-load-releases-support-board',
			0.4,
			0.69921772,
			10,
			narrowWedgeSupports()
		),
		['time-limit']
	),
	scenario(
		'third-ball-hits-dynamic-support',
		'Third ball hits dynamic support',
		'An external body strikes the dynamic supporting member and invalidates the old relative path.',
		'dynamic-support.external-impact',
		input(
			'third-ball-hits-dynamic-support-board',
			[
				body('support', [0, 1], [0, 0]),
				body('slider', [0, 2], [0.45, 0]),
				body('third-ball', [-3, 1], [8, 0], 0.2, 1, 0.25)
			],
			wedgeSupports(),
			0.5,
			2
		),
		['escaped', 'settled', 'time-limit', 'unresolved']
	),
	scenario(
		'slider-launched-from-support',
		'Slider launched from support',
		'The moving body reaches its zero-reaction detachment boundary while the dynamic support stays anchored.',
		'dynamic-support.detachment',
		wedgeInput('slider-launched-from-support-board', 1.3, 3),
		['settled', 'escaped', 'time-limit']
	),
	scenario(
		'unsupported-free-moving-pair',
		'Unsupported free-moving pair',
		'An energetic external impact removes the anchor while retained body contact would require a moving constrained pair.',
		'dynamic-support.unsupported-moving-pair',
		wedgeInput('unsupported-free-moving-pair-board', 0.4, 4, 10, narrowWedgeSupports()),
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
		expectedEventCharacteristics: {
			summary: verificationPurpose,
			requiredMotionModes: ['circular-contact']
		},
		replayExpectation: expectedOutcomes.includes('unresolved') ? 'valid-prefix' : 'complete',
		coverage: [coverage],
		regressionFixture: false,
		input: scenarioInput
	};
}

function wedgeInput(
	id: string,
	sliderSpeed: number,
	maximumSimulationTime: number,
	sliderMass = 1,
	supports: readonly StaticCollider[] = wedgeSupports()
): SimulationInput {
	return input(
		id,
		[body('support', [0, 1], [0, 0]), body('slider', [0, 2], [sliderSpeed, 0], 0.5, sliderMass)],
		supports,
		0,
		maximumSimulationTime
	);
}

function input(
	id: string,
	bodies: readonly InitialDynamicCircleBodyState[],
	staticColliders: readonly StaticCollider[],
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
			gravity: [0, -2],
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
	radius = 0.5,
	mass = 1,
	releaseTime = 0
): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius },
		mass,
		position,
		velocity,
		releaseTime
	};
}

function wedgeSupports(): readonly StaticCollider[] {
	return [peg('wedge-left', [-0.6, 0.2]), peg('wedge-right', [0.6, 0.2])];
}

function narrowWedgeSupports(): readonly StaticCollider[] {
	const centreY = 1 - Math.sqrt(0.7 ** 2 - 0.2 ** 2);
	return [peg('wedge-left', [-0.2, centreY], 0.2), peg('wedge-right', [0.2, centreY], 0.2)];
}

function peg(id: string, centre: Vec2, radius = 0.5): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		centre,
		physicalShape: { type: 'circle', radius }
	};
}
