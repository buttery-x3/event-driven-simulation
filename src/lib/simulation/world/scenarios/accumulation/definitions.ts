import type {
	InitialDynamicCircleBodyState,
	RunOutcome,
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

export const accumulationScenarios = [
	scenario(
		'flame-46-exact-fit-generalised',
		'FLAME-46 exact-fit candidate (blocked)',
		'Production replay of the tangent-throat contraction; promotion is blocked until a future-tail bound is proved.',
		'accumulation.flame-46-exact-fit',
		denseBoard(0.135),
		['unresolved']
	),
	scenario(
		'flame-46-oversized-generalised',
		'FLAME-46 oversized candidate (blocked)',
		'Production replay of the oversized two-contact contraction; promotion is blocked until a future-tail bound is proved.',
		'accumulation.flame-46-oversized',
		denseBoard(0.14),
		['invalid']
	),
	scenario(
		'three-ball-settlement',
		'Three-ball settlement candidate (blocked)',
		'Three moving supported bodies generate a real contracting impact sequence; the finite prefix reaches its time limit without an unsupported promotion.',
		'accumulation.three-ball-settlement',
		supportedInelasticCollapse('three-ball-settlement', [
			[2, 0],
			[-0.5, 0],
			[-1.5, 0]
		]),
		['time-limit']
	),
	scenario(
		'dynamic-alternating-supports',
		'Dynamic alternating supports candidate (blocked)',
		'Alternating body-body impacts repeatedly include the fixed floor in a genuine supported participant cluster.',
		'accumulation.dynamic-alternating-supports',
		supportedInelasticCollapse('dynamic-alternating-supports', [
			[2, 0],
			[0, 0],
			[-1, 0]
		]),
		['time-limit']
	),
	scenario(
		'multi-body-non-alternating-accumulation',
		'Multi-body non-alternating candidate (blocked)',
		'Four moving bodies produce several changing contact edges and overlapping three/four-body limit candidates.',
		'accumulation.multi-body-non-alternating',
		fourBodyInelasticCollapse(),
		['time-limit']
	),
	scenario(
		'lineality-created-at-accumulation',
		'Lineality-at-limit candidate (blocked)',
		'A minimal two-peg throat produces alternating one-edge events approaching opposing limiting normals without reusing the dense board.',
		'accumulation.limit-lineality',
		minimalThroatInput('lineality-created-at-accumulation', 0.135),
		['unresolved']
	),
	scenario(
		'accumulation-separates-components',
		'Separation-after-promotion candidate (blocked)',
		'A genuine unsupported three-body inelastic-collapse run remains unresolved because no certified promotion exists yet.',
		'accumulation.separating-components',
		unsupportedInelasticCollapse('accumulation-separates-components'),
		['time-limit']
	),
	scenario(
		'incremental-pile-formation',
		'Incremental pile formation (known unresolved)',
		'Scheduled bodies fall toward an existing supported body; the first join reaches the unresolved accumulation boundary before the full pile can form.',
		'accumulation.incremental-pile',
		incrementalStackInput(),
		['unresolved']
	),
	scenario(
		'twenty-ball-container-drop',
		'Twenty-ball dynamic drop (known unresolved)',
		'Twenty falling bodies form five dynamic collision stacks; the replay preserves the real pair-topology failure instead of faking settlement.',
		'accumulation.twenty-ball-pile',
		twentyBallDynamicDrop(),
		['unresolved']
	),
	scenario(
		'pile-reactivated-after-settlement',
		'Pile reactivation (blocked upstream)',
		'A later striker is scheduled, but the genuine pile-forming prefix becomes unresolved before the stack can be certified or reactivated.',
		'accumulation.pile-reactivation',
		reactivationInput(),
		['unresolved']
	),
	scenario(
		'dense-nonconverging-cascade',
		'Dense nonconverging cascade',
		'Frequent elastic contacts do not qualify as accumulation without a contracting finite tail.',
		'accumulation.nonconverging',
		withSettings(withSceneId(denseBoard(0.135), 'dense-nonconverging-cascade'), {
			restitution: 1,
			maximumSimulationTime: 3
		}),
		['time-limit']
	),
	scenario(
		'uncertifiable-temporal-tail',
		'Uncertifiable temporal tail',
		'A genuine three-body inelastic collapse has shrinking intervals but no analytic bound on the unobserved future tail.',
		'accumulation.uncertifiable-tail',
		unsupportedInelasticCollapse('uncertifiable-temporal-tail'),
		['time-limit']
	),
	scenario(
		'uncertifiable-limit-geometry',
		'Uncertifiable limit geometry (blocked prerequisite)',
		'A genuine changing-edge candidate is retained, but geometry certification cannot be reached before a temporal family is proved.',
		'accumulation.uncertifiable-geometry',
		withSceneId(fourBodyInelasticCollapse(), 'uncertifiable-limit-geometry'),
		['time-limit']
	)
] as const satisfies readonly VerificationScenario[];

function scenario(
	id: string,
	name: string,
	verificationPurpose: string,
	coverage: ScenarioCoverageId,
	input: SimulationInput,
	expectedOutcomes: readonly RunOutcome[]
): VerificationScenario {
	return {
		id,
		name,
		categoryId: 'multi-body-scheduler',
		verificationPurpose,
		expectedOutcomes,
		expectedEventCharacteristics: null,
		replayExpectation: expectedOutcomes.some((outcome) =>
			['unresolved', 'invalid', 'event-limit', 'time-limit'].includes(outcome)
		)
			? 'valid-prefix'
			: 'complete',
		coverage: [coverage],
		regressionFixture: id.startsWith('flame-46-'),
		input
	};
}

function denseBoard(radius: number): SimulationInput {
	const colliders: StaticCollider[] = [];
	for (let row = 0; row < 5; row += 1) {
		const y = 3.25 - row * 0.58;
		const offset = row % 2 === 0 ? -1.68 : -1.47;
		for (let column = 0; column < 9; column += 1)
			colliders.push(
				peg(`dense-peg-${pad(row + 1)}-${pad(column + 1)}`, [offset + column * 0.42, y])
			);
	}
	return {
		scene: {
			id: 'dense-board',
			coordinateSystem,
			bounds: { width: 4.4, height: 4.2 },
			staticColliders: colliders,
			terminationRegions: [
				{
					id: 'dense-exit',
					type: 'axis-aligned-box',
					purpose: 'complete',
					minimum: [-2.2, -0.25],
					maximum: [2.2, 0.1]
				}
			]
		},
		initialDynamicBodies: [body('ball-primary', [0.11, 3.95], [0, 0], radius)],
		settings: settings(0.6, 8, 200)
	};
}

function containerInput(
	id: string,
	bodies: readonly InitialDynamicCircleBodyState[],
	restitution: number,
	maximumSimulationTime: number,
	maximumEvents = 200
): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width: 10, height: 8 },
			staticColliders: [
				line('floor', [-4, 0], [4, 0]),
				line('left-wall', [-4, 0], [-4, 8]),
				line('right-wall', [4, 0], [4, 8])
			],
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: settings(restitution, maximumSimulationTime, maximumEvents)
	};
}

function supportedInelasticCollapse(id: string, velocities: readonly Vec2[]): SimulationInput {
	return containerInput(
		id,
		[-2, 0, 2].map((x, index) => body(`collapse-${index + 1}`, [x, 0.5], velocities[index]!, 0.5)),
		0.03,
		5,
		300
	);
}

function unsupportedInelasticCollapse(id: string): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width: 10, height: 3 },
			staticColliders: [],
			terminationRegions: []
		},
		initialDynamicBodies: [-2, 0, 2].map((x, index) =>
			body(
				`collapse-${index + 1}`,
				[x, 1],
				(
					[
						[2, 0],
						[0, 0],
						[-1, 0]
					] as Vec2[]
				)[index]!,
				0.5
			)
		),
		settings: { ...settings(0.05, 5, 300), gravity: [0, 0] }
	};
}

function fourBodyInelasticCollapse(): SimulationInput {
	return {
		...unsupportedInelasticCollapse('multi-body-non-alternating-accumulation'),
		initialDynamicBodies: [-3, -1, 1, 3].map((x, index) =>
			body(
				`collapse-${index + 1}`,
				[x, 1],
				(
					[
						[2.5, 0],
						[0.25, 0],
						[-0.2, 0],
						[-1.5, 0]
					] as Vec2[]
				)[index]!,
				0.5
			)
		),
		settings: { ...settings(0.03, 5, 500), gravity: [0, 0] }
	};
}

function minimalThroatInput(id: string, radius: number): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width: 4.4, height: 4.2 },
			staticColliders: [
				peg('throat-left', [0.42, 3.25]),
				peg('throat-right', [0.84, 3.25]),
				line('floor', [-2.2, 0], [2.2, 0])
			],
			terminationRegions: []
		},
		initialDynamicBodies: [body('throat-ball', [0.55, 3.95], [0, 0], radius)],
		settings: settings(0.6, 5, 300)
	};
}

function incrementalStackInput(): SimulationInput {
	return containerInput(
		'incremental-pile-formation',
		[
			body('base', [0, 0.5], [0, 0], 0.5),
			body('joining-01', [0, 2], [0, 0], 0.5, 1, 0.75),
			body('joining-02', [0, 3], [0, 0], 0.5, 1, 2.5),
			body('joining-03', [0, 4], [0, 0], 0.5, 1, 4.5)
		],
		0.2,
		8,
		600
	);
}

function twentyBallDynamicDrop(): SimulationInput {
	const radius = 0.15;
	return containerInput(
		'twenty-ball-container-drop',
		Array.from({ length: 5 }, (_, column) =>
			Array.from({ length: 4 }, (_, row) =>
				body(
					`drop-${column + 1}-${row + 1}`,
					[(column - 2) * 0.7, 1 + row * 0.32],
					[column % 2 === 0 ? 0.03 : -0.03, 0],
					radius
				)
			)
		).flat(),
		0.1,
		8,
		1000
	);
}

function reactivationInput(): SimulationInput {
	const input = incrementalStackInput();
	return {
		...input,
		scene: { ...input.scene, id: 'pile-reactivated-after-settlement' },
		initialDynamicBodies: [
			...input.initialDynamicBodies,
			body('late-striker', [-3, 0.5], [3, 0], 0.5, 1, 6)
		],
		settings: { ...input.settings, maximumSimulationTime: 9, maximumEvents: 900 }
	};
}

function body(
	id: string,
	position: Vec2,
	velocity: Vec2,
	radius: number,
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

function peg(id: string, centre: Vec2): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'circle', radius: 0.075 },
		centre
	};
}

function line(id: string, start: Vec2, end: Vec2): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start, end }
	};
}

function settings(restitution: number, maximumSimulationTime: number, maximumEvents: number) {
	return {
		gravity: [0, -9.81] as Vec2,
		restitution,
		maximumEvents,
		maximumSimulationTime,
		tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
	};
}

function withSceneId(input: SimulationInput, id: string): SimulationInput {
	return { ...input, scene: { ...input.scene, id } };
}

function withSettings(
	input: SimulationInput,
	settingsPatch: Partial<SimulationInput['settings']>
): SimulationInput {
	return { ...input, settings: { ...input.settings, ...settingsPatch } };
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}
