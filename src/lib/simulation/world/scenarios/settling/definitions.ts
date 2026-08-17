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

const defaultContactCaptureDistance = 1e-9;

export const settlingScenarios = [
	scenario(
		'three-ball-settlement',
		'Three-ball settlement frontier',
		'The supported moving FLAME-57 three-body reproducer audits whether finite contact capture replaces its contracting collision sequence.',
		'settling.three-ball-capture',
		threeBallSettlementInput(),
		['settled']
	),
	scenario(
		'off-axis-incremental-pile',
		'Off-axis incremental pile',
		'Three separately scheduled off-axis arrivals join and reactivate a mechanically supported component through changing oblique contacts before pair geometry fails closed.',
		'settling.incremental-off-axis',
		offAxisIncrementalPileInput(),
		['invalid']
	),
	scenario(
		'staggered-twenty-ball-pile',
		'Staggered twenty-ball pile',
		'Twenty initially separated bodies form a narrow-container pile from horizontally staggered rows with changing diagonal contact partners.',
		'settling.twenty-ball-staggered',
		staggeredTwentyBallInput(),
		['unresolved']
	),
	scenario(
		'legacy-twenty-ball-container-drop-control',
		'Legacy twenty-ball column control',
		'The FLAME-57 five-column input remains a control for the former indeterminate dynamic-pair topology failure, not a dense-pile acceptance case.',
		'settling.twenty-ball-legacy-control',
		legacyTwentyBallControlInput(),
		['event-limit'],
		true
	)
] as const satisfies readonly VerificationScenario[];

function scenario(
	id: string,
	name: string,
	verificationPurpose: string,
	coverage: ScenarioCoverageId,
	input: SimulationInput,
	expectedOutcomes: readonly RunOutcome[],
	regressionFixture = false
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
		regressionFixture,
		input
	};
}

function threeBallSettlementInput(): SimulationInput {
	return containerInput(
		'three-ball-settlement',
		[-2, 0, 2].map((x, index) =>
			body(
				`collapse-${index + 1}`,
				[x, 0.5],
				(
					[
						[2, 0],
						[-0.5, 0],
						[-1.5, 0]
					] as Vec2[]
				)[index]!,
				0.5
			)
		),
		0.03,
		5,
		300,
		4
	);
}

function offAxisIncrementalPileInput(): SimulationInput {
	return containerInput(
		'off-axis-incremental-pile',
		[
			body('base', [0, 0.5], [0, 0], 0.5),
			body('joining-01', [-0.45, 2.5], [0, 0], 0.5, 0.75),
			body('joining-02', [0.4, 3], [0, 0], 0.5, 3),
			body('joining-03', [-0.25, 3.5], [0, 0], 0.5, 5.5)
		],
		0.2,
		9,
		900,
		1.35
	);
}

function staggeredTwentyBallInput(): SimulationInput {
	const radius = 0.15;
	const columnSpacing = 0.36;
	const rowSpacing = 0.36;
	const bodies = Array.from({ length: 5 }, (_, row) => {
		const rowOffset = row % 2 === 0 ? 0 : -columnSpacing / 2;
		return Array.from({ length: 4 }, (_, column) =>
			body(
				`staggered-${row + 1}-${column + 1}`,
				[(column - 1.5) * columnSpacing + rowOffset, 1 + row * rowSpacing],
				[0, 0],
				radius
			)
		);
	}).flat();
	return containerInput('staggered-twenty-ball-pile', bodies, 0.1, 8, 1_200, 0.9);
}

function legacyTwentyBallControlInput(): SimulationInput {
	const radius = 0.15;
	const bodies = Array.from({ length: 5 }, (_, column) =>
		Array.from({ length: 4 }, (_, row) =>
			body(
				`legacy-${column + 1}-${row + 1}`,
				[(column - 2) * 0.7, 1 + row * 0.32],
				[column % 2 === 0 ? 0.03 : -0.03, 0],
				radius
			)
		)
	).flat();
	return containerInput('legacy-twenty-ball-container-drop-control', bodies, 0.1, 8, 1_000, 4);
}

function containerInput(
	id: string,
	bodies: readonly InitialDynamicCircleBodyState[],
	restitution: number,
	maximumSimulationTime: number,
	maximumEvents: number,
	halfWidth: number
): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width: halfWidth * 2 + 1, height: 10 },
			staticColliders: [
				line('floor', [-halfWidth, 0], [halfWidth, 0]),
				line('left-wall', [-halfWidth, 0], [-halfWidth, 10]),
				line('right-wall', [halfWidth, 0], [halfWidth, 10])
			],
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity: [0, -9.81],
			restitution,
			contactCaptureDistance: defaultContactCaptureDistance,
			maximumEvents,
			maximumSimulationTime,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function body(
	id: string,
	position: Vec2,
	velocity: Vec2,
	radius: number,
	releaseTime = 0
): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius },
		mass: 1,
		position,
		velocity,
		releaseTime
	};
}

function line(id: string, start: Vec2, end: Vec2): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start, end }
	};
}
