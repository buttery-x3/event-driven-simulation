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

export const simultaneousImpactScenarios = [
	scenario(
		'three-ball-newtons-cradle',
		"Three-ball Newton's cradle",
		'A coupled elastic reflection propagates through a stationary touching contact and permits break-away.',
		'impact.newtons-cradle',
		input('three-ball-newtons-cradle-board', chain([2, 0, 0]), [], 1)
	),
	scenario(
		'two-balls-and-floor-simultaneous',
		'Two balls and floor simultaneous',
		'A dynamic impact and pre-existing fixed floor contact resolve as one exact-time component.',
		'impact.dynamic-fixed-component',
		input(
			'two-balls-and-floor-simultaneous-board',
			[body('upper', [0, 1.5], [0, -2]), body('lower', [0, 0.5], [0, 0])],
			[horizontalLine('floor', 0)],
			0.5
		)
	),
	scenario(
		'symmetric-three-body-impact',
		'Symmetric three-body impact',
		'Symmetric simultaneous input produces a stationary centre and symmetric outgoing endpoints.',
		'impact.symmetric-component',
		input('symmetric-three-body-impact-board', chain([2, 0, -2]), [], 0.5)
	),
	scenario(
		'inactive-contact-removed',
		'Inactive contact removed',
		'Nearby separated geometry is retained as rejected evidence and excluded from the active graph.',
		'impact.inactive-contact-rejection',
		input(
			'inactive-contact-removed-board',
			[
				body('incoming', [-0.5, 5], [1, 0]),
				body('target', [0.5, 5], [0, 0]),
				body('nearby', [1.5001, 5], [0, 0])
			],
			[],
			1,
			0.00002
		)
	),
	scenario(
		'exact-versus-near-simultaneous',
		'Exact versus near simultaneous',
		'An exact contact resolves first while a positive-time later contact remains an ordered event.',
		'impact.exact-event-ordering',
		input(
			'exact-versus-near-simultaneous-board',
			[
				body('incoming', [-0.5, 5], [1, 0]),
				body('middle', [0.5, 5], [0, 0]),
				body('later', [1.5001, 5], [0, 0])
			],
			[],
			1,
			0.001
		)
	),
	scenario(
		'participant-order-invariance',
		'Participant order invariance',
		'Reversed declarations and unrelated names preserve the geometry-equivalent coupled trajectory.',
		'impact.participant-order-invariance',
		input(
			'participant-order-invariance-board',
			[
				body('renamed-right', [1, 5], [-2, 0]),
				body('renamed-centre', [0, 5], [0, 0]),
				body('renamed-left', [-1, 5], [2, 0])
			],
			[],
			0.5
		)
	),
	scenario(
		'unsupported-retained-dynamic-contact',
		'Retained dynamic support contact',
		'Instantaneous response promotes a retained body-body graph with fixed support into a dormant component.',
		'impact.unsupported-retained-contact',
		input(
			'unsupported-retained-dynamic-contact-board',
			[body('lower', [0, 0.5], [0, 1]), body('upper', [0, 1.5], [0, 0])],
			[horizontalLine('floor', 0), horizontalLine('ceiling', 2)],
			1
		),
		['settled']
	),
	scenario(
		'implicit-equality-anti-locking',
		'Implicit equality anti-locking',
		'Opposing fixed contacts remove forbidden horizontal motion without erasing admissible vertical tangent motion.',
		'impact.implicit-equality',
		input(
			'implicit-equality-anti-locking-board',
			[body('throat-body', [0, 5], [1e-6, -1]), body('striker', [0, 6], [0, -2])],
			[verticalLine('left-wall', -0.5), verticalLine('right-wall', 0.5)],
			1,
			0.1
		)
	),
	scenario(
		'floating-point-scale-invariance',
		'Floating-point scale invariance',
		'Disconnected exact-time pairs at several velocity scales share stable classifications without residual loops.',
		'impact.scale-invariance',
		input(
			'floating-point-scale-invariance-board',
			[...pairAt('slow', 2, 1e-6), ...pairAt('unit', 5, 1), ...pairAt('fast', 8, 1e6)],
			[],
			1,
			1e-6
		)
	),
	scenario(
		'multi-body-lineality-component',
		'Multi-body lineality component',
		'Lineality certification spans a touching body chain terminated by an opposing fixed contact.',
		'impact.multi-body-lineality',
		input(
			'multi-body-lineality-component-board',
			chain([1, 0, 0]),
			[verticalLine('left-stop', -1.5), verticalLine('right-stop', 1.5)],
			1
		),
		['settled']
	),
	scenario(
		'termination-certification-failure',
		'Termination certification failure',
		'An intentionally oversized exact-time component preserves its prefix and fails at the declared solver resource boundary.',
		'impact.termination-certification-failure',
		input(
			'termination-certification-failure-board',
			Array.from({ length: 18 }, (_, index) =>
				body(
					`resource-${index.toString().padStart(2, '0')}`,
					[index - 8.5, 5],
					[index === 0 ? 1 : 0, 0]
				)
			),
			[],
			1,
			0.1,
			40
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
	staticColliders: readonly StaticCollider[],
	restitution: number,
	maximumSimulationTime = 0.25,
	width = 20
): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width, height: 10 },
			staticColliders,
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity: [0, 0],
			restitution,
			maximumEvents: 100,
			maximumSimulationTime,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function chain(
	speeds: readonly [number, number, number]
): readonly InitialDynamicCircleBodyState[] {
	return [
		body('left', [-1, 5], [speeds[0], 0]),
		body('centre', [0, 5], [speeds[1], 0]),
		body('right', [1, 5], [speeds[2], 0])
	];
}

function pairAt(
	prefix: string,
	y: number,
	speed: number
): readonly InitialDynamicCircleBodyState[] {
	return [body(`${prefix}-left`, [-0.5, y], [speed, 0]), body(`${prefix}-right`, [0.5, y], [0, 0])];
}

function body(id: string, position: Vec2, velocity: Vec2): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.5 },
		mass: 1,
		position,
		velocity,
		releaseTime: 0
	};
}

function horizontalLine(id: string, y: number): StaticCollider {
	return line(id, [-5, y], [5, y]);
}

function verticalLine(id: string, x: number): StaticCollider {
	return line(id, [x, 0], [x, 10]);
}

function line(id: string, start: Vec2, end: Vec2): StaticCollider {
	return { id, motionAuthority: 'static', physicalShape: { type: 'line-segment', start, end } };
}
