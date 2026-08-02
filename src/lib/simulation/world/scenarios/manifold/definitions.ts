import type { SceneDefinition, SimulationInput, StaticCollider, Vec2 } from '../../../contracts';
import type { VerificationScenario } from '../types';

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

export const manifoldContactScenarios = [
	scenario(
		'circular-slide-second-peg',
		'Circular slide reaches a second peg at pace',
		'A supported circular path reaches another peg, retains support, reverses and settles after contracting returns.',
		['settled'],
		input(circularAcquisitionColliders(), [0, 0.6], [1, 0], 0.5),
		'manifold.circular-acquisition',
		['circular-contact']
	),
	scenario(
		'sustained-two-support-rest',
		'Sustained contact settles into two supports',
		'A zero-restitution slide into the opposite side of a V certifies two non-negative support reactions.',
		['settled'],
		input(vSupportColliders(), [-0.8, 3], [0, 0], 0),
		'manifold.multi-support-rest',
		['linear-contact']
	),
	scenario(
		'new-impact-releases-support',
		'Support is released by the new impact',
		'An angled circle impact produces upward separation and proves the old floor impulse is zero.',
		['exited'],
		releaseInput(),
		'manifold.support-release',
		['linear-contact']
	),
	scenario(
		'circle-line-multi-support-rest',
		'Circle-line multi-support rest',
		'An exact initial mixed manifold balances gravity using positive circle and line reactions.',
		['settled'],
		input(mixedSupportColliders(), [0, 1], [0, 0], 0),
		'manifold.mixed-support',
		[]
	)
] as const satisfies readonly VerificationScenario[];

function scenario(
	id: string,
	name: string,
	verificationPurpose: string,
	expectedOutcomes: VerificationScenario['expectedOutcomes'],
	value: SimulationInput,
	coverage: VerificationScenario['coverage'][number],
	requiredMotionModes: NonNullable<
		VerificationScenario['expectedEventCharacteristics']
	>['requiredMotionModes']
): VerificationScenario {
	return {
		id,
		name,
		categoryId: 'adversarial-contacts',
		verificationPurpose,
		expectedOutcomes,
		expectedEventCharacteristics: {
			summary: verificationPurpose,
			minimumContactEvents: 1,
			requiredMotionModes
		},
		replayExpectation: 'complete',
		coverage: [coverage],
		regressionFixture: false,
		input: value
	};
}

function input(
	staticColliders: readonly StaticCollider[],
	position: Vec2,
	velocity: Vec2,
	restitution: number
): SimulationInput {
	return {
		scene: scene(staticColliders),
		initialDynamicBodies: [
			{
				id: 'manifold-ball',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius: 0.1 },
				position,
				velocity
			}
		],
		settings: {
			gravity: [0, -10],
			restitution,
			maximumEvents: 100,
			maximumSimulationTime: 3,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function scene(staticColliders: readonly StaticCollider[]): SceneDefinition {
	return {
		id: `manifold-${staticColliders.map(({ id }) => id).join('-')}`,
		coordinateSystem,
		bounds: { width: 8, height: 5 },
		staticColliders,
		terminationRegions: []
	};
}

function circularAcquisitionColliders(): readonly StaticCollider[] {
	const angle = 1;
	const contact: Vec2 = [0.6 * Math.cos(angle), 0.6 * Math.sin(angle)];
	return [
		circle('support-peg', [0, 0], 0.5),
		circle('impact-peg', [contact[0] + 0.6, contact[1]], 0.5)
	];
}

function vSupportColliders(): readonly StaticCollider[] {
	return [line('left-v', [-2, 2.5], [0, 0.5]), line('right-v', [0, 0.5], [2, 2.5])];
}

function releaseColliders(): readonly StaticCollider[] {
	const normal: Vec2 = [-Math.SQRT1_2, Math.SQRT1_2];
	const impact: Vec2 = [0, 0.1];
	return [
		line('release-floor', [-3, 0], [3, 0]),
		circle('lifting-circle', [impact[0] - 0.2 * normal[0], impact[1] - 0.2 * normal[1]], 0.1)
	];
}

function releaseInput(): SimulationInput {
	const value = input(releaseColliders(), [-1, 0.1], [2, 0], 0.5);
	return {
		...value,
		scene: {
			...value.scene,
			terminationRegions: [
				{
					id: 'released-upward',
					type: 'axis-aligned-box',
					purpose: 'complete',
					minimum: [-1, 0.2],
					maximum: [2, 0.4]
				}
			]
		}
	};
}

function mixedSupportColliders(): readonly StaticCollider[] {
	const position: Vec2 = [0, 1];
	const circleNormal: Vec2 = [-0.6, 0.8];
	const lineNormal: Vec2 = [0.6, 0.8];
	const contactPoint: Vec2 = [position[0] - 0.1 * lineNormal[0], position[1] - 0.1 * lineNormal[1]];
	const tangent: Vec2 = [-lineNormal[1], lineNormal[0]];
	return [
		circle(
			'mixed-circle',
			[position[0] - 0.2 * circleNormal[0], position[1] - 0.2 * circleNormal[1]],
			0.1
		),
		line(
			'mixed-line',
			[contactPoint[0] - tangent[0], contactPoint[1] - tangent[1]],
			[contactPoint[0] + tangent[0], contactPoint[1] + tangent[1]]
		)
	];
}

function circle(id: string, centre: Vec2, radius: number): StaticCollider {
	return { id, motionAuthority: 'static', physicalShape: { type: 'circle', radius }, centre };
}

function line(id: string, start: Vec2, end: Vec2): StaticCollider {
	return { id, motionAuthority: 'static', physicalShape: { type: 'line-segment', start, end } };
}
