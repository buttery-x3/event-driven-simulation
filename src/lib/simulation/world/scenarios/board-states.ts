import type {
	RunOutcome,
	SceneDefinition,
	SimulationInput,
	SimulationSettings,
	StaticCircleCollider,
	StaticLineSegmentCollider,
	Vec2
} from '../../contracts';
import { canonicalPlinkoScenarios } from './canonical-launches';
import { getBoardStateScenarioMetadata } from './board-state-metadata';
import type { VerificationScenario } from './types';

export interface BoardStateScenario extends VerificationScenario {
	readonly pegCount: number;
}

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

const defaultSettings = {
	gravity: [0, -9.81],
	restitution: 0.6,
	contactCaptureDistance: 1e-9,
	maximumEvents: 200,
	maximumSimulationTime: 8,
	tolerances: {
		contactDistance: 1e-9,
		eventTime: 1e-9
	}
} as const satisfies SimulationSettings;

const sparsePegs = [
	peg('sparse-peg-01', [-1.1, 2.8]),
	peg('sparse-peg-02', [0.2, 2.8]),
	peg('sparse-peg-03', [1.2, 2.8]),
	peg('sparse-peg-04', [-0.7, 1.8]),
	peg('sparse-peg-05', [0.7, 1.8]),
	peg('sparse-peg-06', [0, 0.9])
] as const;

const sparseInput = simulationInput(
	scene('sparse-board', 4, 4, sparsePegs, [wideBottomExit('sparse-exit', 4)]),
	[0.36, 3.7],
	[0, 0]
);

const mirroredSparseInput = mirrorInput(sparseInput, 'mirrored-sparse-board', 'mirrored-');
const reversedSparseInput: SimulationInput = {
	...sparseInput,
	scene: {
		...sparseInput.scene,
		id: 'reversed-sparse-board',
		staticColliders: [...sparseInput.scene.staticColliders].reverse()
	}
};

const densePegs = pegRows({
	idPrefix: 'dense',
	rowCount: 5,
	columns: 9,
	firstY: 3.25,
	verticalSpacing: 0.58,
	horizontalSpacing: 0.42,
	radius: 0.075
});

const canonicalInput = canonicalPlinkoScenarios.find(({ id }) => id === 'offset-drop')!.input;

export const boardStateScenarios = [
	boardScenario(
		'no-pegs',
		'No pegs',
		'Proves unobstructed ballistic motion reaches a declared exit continuously.',
		['exited'],
		simulationInput(
			scene('no-pegs-board', 4, 4, [], [wideBottomExit('no-pegs-exit', 4)]),
			[0, 3.5],
			[0, 0]
		)
	),
	boardScenario(
		'isolated-peg',
		'One isolated peg',
		'Exercises the smallest complete run containing a fixed-circle contact.',
		['exited'],
		simulationInput(
			scene(
				'isolated-peg-board',
				4,
				4,
				[peg('isolated-peg', [0, 2.25])],
				[wideBottomExit('isolated-exit', 4)]
			),
			[0.16, 3.5],
			[0, 0]
		)
	),
	boardScenario(
		'sparse',
		'Sparse peg board',
		'Exercises six pegs across three widely separated rows.',
		['escaped'],
		sparseInput
	),
	boardScenario(
		'canonical',
		'Canonical Plinko board',
		'Runs the production canonical 60-peg board without a solver mode change.',
		['exited'],
		canonicalInput
	),
	boardScenario(
		'dense',
		'Dense peg board',
		'Exercises 45 pegs with narrower passages than the canonical layout.',
		['exited'],
		simulationInput(
			scene('dense-board', 4.4, 4.2, densePegs, [wideBottomExit('dense-exit', 4.4)]),
			[0.11, 3.95],
			[0, 0]
		)
	),
	boardScenario(
		'mirrored-sparse',
		'Mirrored sparse board',
		'Reflects collider and launch coordinates across x = 0 to expose sign assumptions.',
		['escaped'],
		mirroredSparseInput
	),
	boardScenario(
		'reversed-sparse',
		'Reversed sparse collider order',
		'Reverses serialised collider order to expose ordering assumptions.',
		['escaped'],
		reversedSparseInput
	),
	boardScenario(
		'flat-support',
		'Declared flat supporting surface',
		'Exercises explicit resting contact on a horizontal supporting surface.',
		['settled'],
		simulationInput(
			scene('flat-support-board', 6, 4, [supportingFloor('flat-support', -2, 2, 0.5)], []),
			[0, 3],
			[0, 0],
			{ ...defaultSettings, restitution: 0 }
		)
	),
	boardScenario(
		'angled-ramp',
		'Angled ramp',
		'Exercises continuous frictionless sliding under tangential gravity.',
		['escaped'],
		simulationInput(
			scene('angled-ramp-board', 6, 4, [line('angled-ramp', [-2, 0.5], [2, 1.5])], []),
			[-0.6, 3],
			[0.8, 0],
			{ ...defaultSettings, restitution: 0 }
		)
	),
	boardScenario(
		'close-contacts',
		'Closely spaced contacts',
		'Creates an exact two-peg tie that must preserve deterministic diagnostics.',
		['settled'],
		simulationInput(
			scene(
				'close-contact-board',
				4,
				4,
				[peg('close-left', [-0.1, 2], 0.08), peg('close-right', [0.1, 2], 0.08)],
				[wideBottomExit('close-contact-exit', 4)]
			),
			[0, 3.5],
			[0, 0],
			{ ...defaultSettings, contactCaptureDistance: 2e-9 }
		)
	),
	boardScenario(
		'no-reachable-exit-settled',
		'No reachable normal exit with support',
		'Uses a declared but unreachable exit and terminates honestly as settled.',
		['settled'],
		simulationInput(
			scene(
				'no-reachable-exit-board',
				6,
				4,
				[supportingFloor('no-exit-floor', -2, 2, 0.5)],
				[
					{
						id: 'unreachable-exit',
						type: 'axis-aligned-box',
						purpose: 'complete',
						minimum: [2.4, 3.6],
						maximum: [2.8, 3.9]
					}
				]
			),
			[0, 3],
			[0, 0],
			{ ...defaultSettings, restitution: 0 }
		)
	),
	boardScenario(
		'no-future-event',
		'No future supported event',
		'Distinguishes stationary unsupported continuation from normal completion.',
		['no-future-event'],
		simulationInput(scene('no-future-event-board', 20, 4, [], []), [0, 2], [0, 0], {
			...defaultSettings,
			gravity: [0, 0]
		})
	),
	boardScenario(
		'explicit-time-limit',
		'Explicit time limit',
		'Preserves a valid moving prefix when no event occurs before the configured limit.',
		['time-limit'],
		simulationInput(scene('time-limit-board', 20, 4, [], []), [0, 2], [0.5, 0], {
			...defaultSettings,
			gravity: [0, 0],
			maximumSimulationTime: 1
		})
	)
] as const satisfies readonly BoardStateScenario[];

function boardScenario(
	id: string,
	name: string,
	verificationPurpose: string,
	expectedOutcomes: readonly RunOutcome[],
	input: SimulationInput
): BoardStateScenario {
	const metadata = getBoardStateScenarioMetadata(id);

	return {
		id,
		name,
		categoryId: metadata.categoryId,
		verificationPurpose,
		pegCount: input.scene.staticColliders.filter(
			(collider) => collider.physicalShape.type === 'circle'
		).length,
		expectedOutcomes,
		expectedEventCharacteristics: metadata.expectedEventCharacteristics,
		replayExpectation: metadata.replayExpectation,
		coverage: metadata.coverage,
		regressionFixture: false,
		input
	};
}

function simulationInput(
	sceneDefinition: SceneDefinition,
	position: Vec2,
	velocity: Vec2,
	settings: SimulationSettings = defaultSettings
): SimulationInput {
	return {
		scene: sceneDefinition,
		initialDynamicBodies: [
			{
				id: 'ball-primary',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius: 0.12 },
				mass: 1,
				position,
				velocity,
				releaseTime: 0
			}
		],
		settings
	};
}

function scene(
	id: string,
	width: number,
	height: number,
	staticColliders: SceneDefinition['staticColliders'],
	terminationRegions: SceneDefinition['terminationRegions']
): SceneDefinition {
	return {
		id,
		coordinateSystem,
		bounds: { width, height },
		staticColliders,
		terminationRegions
	};
}

function peg(id: string, centre: Vec2, radius = 0.08): StaticCircleCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'circle', radius },
		centre
	};
}

function line(id: string, start: Vec2, end: Vec2): StaticLineSegmentCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start, end }
	};
}

function supportingFloor(
	id: string,
	startX: number,
	endX: number,
	y: number
): StaticLineSegmentCollider {
	return line(id, [startX, y], [endX, y]);
}

function wideBottomExit(id: string, boardWidth: number) {
	return {
		id,
		type: 'axis-aligned-box',
		purpose: 'complete',
		minimum: [-boardWidth / 2, -0.25],
		maximum: [boardWidth / 2, 0.1]
	} as const;
}

function mirrorInput(input: SimulationInput, sceneId: string, idPrefix: string): SimulationInput {
	return {
		...input,
		scene: {
			...input.scene,
			id: sceneId,
			staticColliders: input.scene.staticColliders.map((collider) =>
				'centre' in collider
					? {
							...collider,
							id: `${idPrefix}${collider.id}`,
							centre: [mirrorCoordinate(collider.centre[0]), collider.centre[1]]
						}
					: {
							...collider,
							id: `${idPrefix}${collider.id}`,
							physicalShape: {
								...collider.physicalShape,
								start: [
									mirrorCoordinate(collider.physicalShape.start[0]),
									collider.physicalShape.start[1]
								],
								end: [
									mirrorCoordinate(collider.physicalShape.end[0]),
									collider.physicalShape.end[1]
								]
							}
						}
			),
			terminationRegions: input.scene.terminationRegions.map((region) => ({
				...region,
				id: `${idPrefix}${region.id}`,
				minimum: [-region.maximum[0], region.minimum[1]],
				maximum: [-region.minimum[0], region.maximum[1]]
			}))
		},
		initialDynamicBodies: input.initialDynamicBodies.map((body) => ({
			...body,
			position: [mirrorCoordinate(body.position[0]), body.position[1]],
			velocity: [mirrorCoordinate(body.velocity[0]), body.velocity[1]]
		}))
	};
}

function mirrorCoordinate(value: number): number {
	return value === 0 ? 0 : -value;
}

function pegRows({
	idPrefix,
	rowCount,
	columns,
	firstY,
	verticalSpacing,
	horizontalSpacing,
	radius
}: {
	readonly idPrefix: string;
	readonly rowCount: number;
	readonly columns: number;
	readonly firstY: number;
	readonly verticalSpacing: number;
	readonly horizontalSpacing: number;
	readonly radius: number;
}): readonly StaticCircleCollider[] {
	return Array.from({ length: rowCount }, (_, rowIndex) => {
		const offset = rowIndex % 2 === 0 ? 0 : horizontalSpacing / 2;
		return Array.from({ length: columns }, (_, columnIndex) =>
			peg(
				`${idPrefix}-peg-${String(rowIndex + 1).padStart(2, '0')}-${String(columnIndex + 1).padStart(2, '0')}`,
				[
					(columnIndex - (columns - 1) / 2) * horizontalSpacing + offset,
					firstY - rowIndex * verticalSpacing
				],
				radius
			)
		);
	}).flat();
}
