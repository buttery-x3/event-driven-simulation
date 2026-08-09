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
		'FLAME-46 exact-fit generalised',
		'Certifies the tangent-throat accumulation before ordinary anti-locking preserves downward release.',
		'accumulation.flame-46-exact-fit',
		denseBoard(0.135),
		['settled']
	),
	scenario(
		'flame-46-oversized-generalised',
		'FLAME-46 oversized generalised',
		'Certifies the oversized two-contact limit before ordinary support reactions establish rest.',
		'accumulation.flame-46-oversized',
		denseBoard(0.14),
		['settled']
	),
	scenario(
		'three-ball-settlement',
		'Three-ball settlement',
		'A connected three-body cluster is supported by the floor without event-count freezing.',
		'accumulation.three-ball-settlement',
		containerInput('three-ball-settlement', pileBodies(3), 0.4, 4),
		['settled']
	),
	scenario(
		'dynamic-alternating-supports',
		'Dynamic alternating supports',
		'Fixed and dynamic contact edges compete inside one connected supported participant cluster.',
		'accumulation.dynamic-alternating-supports',
		containerInput('dynamic-alternating-supports', fallingCluster(3), 0.55, 5),
		['settled', 'time-limit', 'escaped']
	),
	scenario(
		'multi-body-non-alternating-accumulation',
		'Multi-body non-alternating accumulation',
		'A changing three-body contact graph exercises connected-cluster evidence without A-B alternation.',
		'accumulation.multi-body-non-alternating',
		containerInput('multi-body-non-alternating-accumulation', fallingCluster(4), 0.5, 5),
		['settled', 'time-limit', 'escaped']
	),
	scenario(
		'lineality-created-at-accumulation',
		'Lineality created at accumulation',
		'Opposing normals become an implicit equality only at reconstructed limiting geometry.',
		'accumulation.limit-lineality',
		withSceneId(denseBoard(0.135), 'lineality-created-at-accumulation'),
		['settled']
	),
	scenario(
		'accumulation-separates-components',
		'Accumulation separates components',
		'Promotion demonstrates a common-tangent separating continuation rather than forced rest.',
		'accumulation.separating-components',
		withSettings(withSceneId(denseBoard(0.135), 'accumulation-separates-components'), {
			maximumSimulationTime: 1.7
		}),
		['time-limit']
	),
	scenario(
		'incremental-pile-formation',
		'Incremental pile formation',
		'Scheduled releases join and revise an existing supported dynamic component incrementally.',
		'accumulation.incremental-pile',
		containerInput(
			'incremental-pile-formation',
			[
				body('joining-01', [-1.5, 0.25], [0, 0], 0.25, 1, 0),
				body('joining-02', [-0.5, 0.25], [0, 0], 0.25, 1, 0.8),
				body('joining-03', [0.5, 0.25], [0, 0], 0.25, 1, 1.6),
				body('joining-04', [1.5, 0.25], [0, 0], 0.25, 1, 2.4)
			],
			0.35,
			7
		),
		['settled', 'time-limit', 'escaped']
	),
	scenario(
		'twenty-ball-container-drop',
		'Twenty-ball container drop',
		'A deterministic twenty-body supported pile remains inspectable without an event-limit freeze.',
		'accumulation.twenty-ball-pile',
		containerInput('twenty-ball-container-drop', twentySupportedBodies(), 0.3, 5, 600),
		['settled']
	),
	scenario(
		'pile-reactivated-after-settlement',
		'Pile reactivated after settlement',
		'A later scheduled striker reactivates a previously certified dynamic resting component.',
		'accumulation.pile-reactivation',
		reactivationInput(),
		['settled', 'time-limit', 'escaped']
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
		['time-limit', 'exited']
	),
	scenario(
		'uncertifiable-temporal-tail',
		'Uncertifiable temporal tail',
		'Shrinking but unsupported temporal evidence preserves a valid explicit unresolved prefix.',
		'accumulation.uncertifiable-tail',
		withSettings(withSceneId(denseBoard(0.139), 'uncertifiable-temporal-tail'), {
			restitution: 0.97,
			maximumEvents: 10,
			maximumSimulationTime: 3
		}),
		['time-limit']
	),
	scenario(
		'uncertifiable-limit-geometry',
		'Uncertifiable limit geometry',
		'Temporal pressure without a certifiable complete limiting manifold remains explicit and replayable.',
		'accumulation.uncertifiable-geometry',
		withSettings(withSceneId(denseBoard(0.137), 'uncertifiable-limit-geometry'), {
			maximumEvents: 8,
			maximumSimulationTime: 3
		}),
		['event-limit']
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
			['unresolved', 'event-limit', 'time-limit'].includes(outcome)
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

function pileBodies(count: number): readonly InitialDynamicCircleBodyState[] {
	const positions: Vec2[] = [];
	const radius = 0.25;
	const vertical = Math.sqrt(3) * radius;
	let row = 0;
	while (positions.length < count) {
		const rowCount = Math.max(1, 7 - row);
		const start = -radius * (rowCount - 1);
		for (let column = 0; column < rowCount && positions.length < count; column += 1)
			positions.push([start + column * radius * 2, radius + row * vertical]);
		row += 1;
	}
	return positions.map((position, index) =>
		body(`pile-${pad(index + 1)}`, position, [0, 0], radius)
	);
}

function twentySupportedBodies(): readonly InitialDynamicCircleBodyState[] {
	const radius = 0.15;
	return Array.from({ length: 5 }, (_, column) =>
		Array.from({ length: 4 }, (_, row) =>
			body(
				`pile-${pad(column * 4 + row + 1)}`,
				[(column - 2) * 0.7, radius + row * radius * 2],
				[0, 0],
				radius
			)
		)
	).flat();
}

function reactivationInput(): SimulationInput {
	const input = containerInput(
		'pile-reactivated-after-settlement',
		[
			body('anchored-pile', [1, 0.5], [0, 0], 0.5),
			body('late-striker', [-2, 0.5], [2, 0], 0.5, 1, 1)
		],
		0.8,
		4,
		300
	);
	return { ...input, settings: { ...input.settings, gravity: [0, -2] } };
}

function fallingCluster(count: number, releaseStep = 0): readonly InitialDynamicCircleBodyState[] {
	return Array.from({ length: count }, (_, index) =>
		body(
			`falling-${pad(index + 1)}`,
			[((index % 4) - 1.5) * 0.6, 1.2 + Math.floor(index / 4)],
			[index % 2 === 0 ? 0.15 : -0.1, -0.5],
			0.25,
			1,
			index * releaseStep
		)
	);
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
