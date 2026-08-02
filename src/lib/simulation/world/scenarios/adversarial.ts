import type {
	AxisAlignedTerminationRegion,
	RunOutcome,
	SceneDefinition,
	SimulationInput,
	SimulationSettings,
	StaticCollider,
	Vec2
} from '../../contracts';
import type {
	ScenarioCategoryId,
	ScenarioCoverageId,
	ScenarioEventExpectation,
	VerificationScenario
} from './types';

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

const defaultSettings = {
	gravity: [0, -10],
	restitution: 0.5,
	maximumEvents: 100,
	maximumSimulationTime: 5,
	tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
} as const satisfies SimulationSettings;

const supportPeg = circle('support-peg', [0, 1], 0.5);
const flatFloor = line('flat-floor', [-5, 0], [5, 0]);

export const adversarialScenarios = [
	adversarialScenario({
		id: 'high-downward-centred-impact',
		name: 'High downward centred impact',
		purpose:
			'Challenges contracting high-energy impacts while preserving exact centreline symmetry.',
		coverage: ['launch.high-downward-speed', 'launch.symmetry-axis', 'initial.directly-above-peg'],
		input: input({ colliders: [supportPeg], position: [0, 4], velocity: [0, -30] }),
		expectedOutcomes: ['escaped'],
		events: {
			summary: 'One high-speed centred impact is committed before the rebound escapes.',
			minimumContactEvents: 1
		}
	}),
	adversarialScenario({
		id: 'high-horizontal-free-flight',
		name: 'High horizontal free flight',
		purpose: 'Exercises continuous bounds escape at high lateral speed without sampled stepping.',
		coverage: ['launch.high-horizontal-speed'],
		input: input({ position: [-4, 2], velocity: [40, 0], gravity: [0, 0] }),
		expectedOutcomes: ['escaped']
	}),
	adversarialScenario({
		id: 'shallow-angle-floor-approach',
		name: 'Shallow-angle floor approach',
		purpose: 'Approaches a flat collider with dominant tangential speed and small inward speed.',
		coverage: ['launch.shallow-angle-approach'],
		input: input({
			colliders: [flatFloor],
			position: [-3, 0.2],
			velocity: [3, -0.1],
			gravity: [0, 0]
		}),
		expectedOutcomes: ['escaped'],
		events: {
			summary: 'One shallow face impact precedes continued free flight.',
			minimumContactEvents: 1
		}
	}),
	adversarialScenario({
		id: 'segment-endpoint-strike',
		name: 'Finite segment endpoint strike',
		purpose: 'Targets a line-segment endpoint rather than its infinite supporting line.',
		coverage: ['launch.collider-endpoint-strike'],
		input: input({
			colliders: [line('endpoint-segment', [1, 1], [1, 3])],
			position: [-2, 3.05],
			velocity: [4, 0],
			gravity: [0, 0]
		}),
		expectedOutcomes: ['escaped'],
		events: {
			summary: 'The accepted candidate is the finite segment endpoint.',
			minimumContactEvents: 1
		}
	}),
	...mirroredNearCentreScenarios(),
	adversarialScenario({
		id: 'just-outside-peg-contact',
		name: 'Just outside peg contact tolerance',
		purpose: 'Starts two nanometres outside the expanded peg boundary with no initial overlap.',
		coverage: ['initial.outside-contact-tolerance', 'initial.near-peg-no-overlap'],
		input: input({
			colliders: [supportPeg],
			position: [0, 1.600000002],
			velocity: [0, 0],
			restitution: 0
		}),
		expectedOutcomes: ['settled'],
		events: {
			summary: 'A positive-time impact collapses to resting instead of becoming initial contact.',
			minimumContactEvents: 1,
			requiredTransitions: [{ from: 'impact', to: 'resting' }]
		}
	}),
	adversarialScenario({
		id: 'near-right-board-bound',
		name: 'Near right board bound',
		purpose: 'Begins close to the board edge and certifies the first outward bounds crossing.',
		coverage: ['initial.near-board-bounds'],
		input: input({ position: [4.999, 2], velocity: [0.25, 0], gravity: [0, 0] }),
		expectedOutcomes: ['escaped']
	}),
	adversarialScenario({
		id: 'narrow-two-peg-passage',
		name: 'Narrow two-peg passage entry',
		purpose: 'Drops a small ball through a passage only slightly wider than its diameter.',
		coverage: ['initial.narrow-passage-entry'],
		input: input({
			colliders: [
				circle('passage-left', [-0.21, 1.5], 0.1),
				circle('passage-right', [0.21, 1.5], 0.1)
			],
			position: [0.005, 3],
			velocity: [0, 0],
			radius: 0.1
		}),
		expectedOutcomes: ['escaped']
	}),
	adversarialScenario({
		id: 'invalid-initial-peg-overlap',
		name: 'Invalid initial peg overlap',
		purpose: 'Fails closed when the submitted ball begins inside a static peg.',
		coverage: ['initial.invalid-overlap'],
		input: input({ colliders: [supportPeg], position: [0, 1.59], velocity: [0, 0] }),
		expectedOutcomes: ['invalid'],
		replayExpectation: 'valid-prefix'
	}),
	...gravityScenarios(),
	adversarialScenario({
		id: 'unit-restitution-floor-bounces',
		name: 'Unit-restitution floor bounces',
		categoryId: 'physical-settings',
		purpose: 'Preserves normal speed across repeated impacts when restitution is exactly one.',
		coverage: ['physics.unit-restitution'],
		input: input({
			colliders: [flatFloor],
			position: [0, 1],
			velocity: [0, 0],
			restitution: 1,
			maximumSimulationTime: 2
		}),
		expectedOutcomes: ['time-limit'],
		events: {
			summary: 'At least two elastic floor contacts occur before the time limit.',
			minimumContactEvents: 2
		}
	}),
	adversarialScenario({
		id: 'small-radius-isolated-peg',
		name: 'Small-radius isolated peg',
		categoryId: 'physical-settings',
		purpose: 'Exercises a valid ball radius substantially smaller than the catalogue default.',
		coverage: ['physics.small-radius'],
		input: input({
			colliders: [circle('small-ball-peg', [0, 1], 0.2)],
			position: [0.12, 3],
			velocity: [0, 0],
			radius: 0.02
		}),
		expectedOutcomes: ['escaped'],
		events: { summary: 'The small ball records a fixed-circle contact.', minimumContactEvents: 1 }
	}),
	adversarialScenario({
		id: 'large-radius-open-board',
		name: 'Large-radius open board',
		categoryId: 'physical-settings',
		purpose: 'Exercises a large valid ball without conflating size with initial overlap.',
		coverage: ['physics.large-radius'],
		input: input({ position: [0, 3], velocity: [0, 0], radius: 0.8 }),
		expectedOutcomes: ['escaped']
	}),
	adversarialScenario({
		id: 'single-event-limit-boundary',
		name: 'Single-event limit boundary',
		categoryId: 'physical-settings',
		purpose: 'Stops exactly after the first accepted impact at the configured event limit.',
		coverage: ['physics.event-limit-boundary'],
		input: input({ colliders: [flatFloor], position: [0, 1], velocity: [0, 0], maximumEvents: 1 }),
		expectedOutcomes: ['event-limit'],
		events: {
			summary: 'Exactly one contact is committed.',
			minimumContactEvents: 1,
			maximumContactEvents: 1
		}
	}),
	adversarialScenario({
		id: 'circular-support-detachment',
		name: 'Circular support then detachment',
		purpose:
			'Enters sustained circular contact and detaches when the peg can no longer support the ball.',
		coverage: ['sustained.circular-detachment'],
		input: input({
			colliders: [circle('detachment-peg', [0, 0], 0.5)],
			position: [0.08, 2],
			velocity: [0, 0],
			restitution: 0,
			maximumSimulationTime: 3
		}),
		expectedOutcomes: ['escaped'],
		events: {
			summary: 'Circular sliding is followed by a support-lost transition to free flight.',
			minimumContactEvents: 1,
			requiredMotionModes: ['circular-contact'],
			requiredTransitions: [
				{ from: 'impact', to: 'sliding' },
				{ from: 'sliding', to: 'free-flight' }
			]
		}
	}),
	adversarialScenario({
		id: 'unsupported-ceiling-contact',
		name: 'Unsupported ceiling contact detaches',
		purpose: 'Starts at a ceiling manifold that cannot supply support and must fall away.',
		coverage: ['sustained.unsupported-detachment'],
		input: input({
			colliders: [line('ceiling', [5, 1], [-5, 1])],
			position: [0, 0.9],
			velocity: [0, 0],
			restitution: 0
		}),
		expectedOutcomes: ['escaped'],
		events: {
			summary: 'The touching ceiling produces no resting or sliding transition before detachment.',
			maximumContactEvents: 1
		}
	}),
	adversarialScenario(unresolvedContinuationScenario())
] as const satisfies readonly VerificationScenario[];

function mirroredNearCentreScenarios(): readonly VerificationScenario[] {
	return ([-0.02, 0.02] as const).map((x) =>
		adversarialScenario({
			id: x < 0 ? 'near-centre-left-selection' : 'near-centre-right-selection',
			name: x < 0 ? 'Near-centre left selection' : 'Near-centre right selection',
			purpose: 'Uses a mirrored perturbation to verify that geometry determines the selected side.',
			coverage: [
				x < 0 ? 'launch.near-symmetry-left' : 'launch.near-symmetry-right',
				'initial.mirrored-equivalent',
				'sustained.near-centred-side-selection'
			],
			input: input({ colliders: [supportPeg], position: [x, 3], velocity: [0, 0], restitution: 0 }),
			expectedOutcomes: ['escaped'],
			events: {
				summary: 'Impact enters circular sliding on the physically selected side.',
				minimumContactEvents: 1,
				requiredMotionModes: ['circular-contact'],
				requiredTransitions: [{ from: 'impact', to: 'sliding' }]
			}
		})
	);
}

function gravityScenarios(): readonly VerificationScenario[] {
	return [
		gravityScenario(
			'low-downward-gravity',
			'Low downward gravity',
			[0, -0.5],
			[0, 3],
			[0, 0],
			'physics.low-downward-gravity'
		),
		gravityScenario(
			'high-downward-gravity',
			'High downward gravity',
			[0, -100],
			[0, 3],
			[0, 0],
			'physics.high-downward-gravity'
		),
		gravityScenario(
			'zero-gravity-launch',
			'Zero gravity with launch velocity',
			[0, 0],
			[-3, 2],
			[2, 0],
			'physics.zero-gravity-launch'
		),
		gravityScenario(
			'lateral-gravity',
			'Lateral gravity',
			[8, 0],
			[-2, 2],
			[0, 0],
			'physics.lateral-gravity'
		),
		gravityScenario(
			'inverted-gravity',
			'Inverted gravity',
			[0, 10],
			[0, 2],
			[0, 0],
			'physics.inverted-gravity'
		)
	];
}

function gravityScenario(
	id: string,
	name: string,
	gravity: Vec2,
	position: Vec2,
	velocity: Vec2,
	coverage: ScenarioCoverageId
): VerificationScenario {
	return adversarialScenario({
		id,
		name,
		categoryId: 'physical-settings',
		purpose: `Exercises the declared ${name.toLowerCase()} vector as authoritative acceleration.`,
		coverage: [coverage],
		input: input({ position, velocity, gravity, maximumSimulationTime: 10 }),
		expectedOutcomes: ['escaped']
	});
}

function unresolvedContinuationScenario(): ScenarioArguments {
	const angle = 2;
	const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
	const tangent: Vec2 = [normal[1], -normal[0]];
	return {
		id: 'unresolved-circular-turning-point',
		name: 'Unresolved circular turning continuation',
		purpose:
			'Fails closed when constrained circular motion reverses before a next event can be certified.',
		coverage: ['sustained.unresolved-continuation'],
		input: input({
			colliders: [circle('turning-peg', [0, 0], 0.5)],
			position: [normal[0] * 0.601, normal[1] * 0.601],
			velocity: [tangent[0] * 0.1 - normal[0] * 0.1, tangent[1] * 0.1 - normal[1] * 0.1],
			restitution: 0
		}),
		expectedOutcomes: ['unresolved'],
		replayExpectation: 'valid-prefix',
		events: {
			summary:
				'A valid free-flight prefix reaches circular sliding before unresolved continuation.',
			minimumContactEvents: 1,
			requiredTransitions: [{ from: 'sliding', to: 'free-flight' }]
		}
	};
}

interface ScenarioArguments {
	readonly id: string;
	readonly name: string;
	readonly purpose: string;
	readonly coverage: readonly ScenarioCoverageId[];
	readonly input: SimulationInput;
	readonly expectedOutcomes: readonly RunOutcome[];
	readonly categoryId?: ScenarioCategoryId;
	readonly events?: ScenarioEventExpectation;
	readonly replayExpectation?: VerificationScenario['replayExpectation'];
}

function adversarialScenario(arguments_: ScenarioArguments): VerificationScenario {
	const scenarioInput = {
		...arguments_.input,
		scene: { ...arguments_.input.scene, id: `adversarial-${arguments_.id}` }
	};
	return {
		id: arguments_.id,
		name: arguments_.name,
		categoryId: arguments_.categoryId ?? 'adversarial-contacts',
		verificationPurpose: arguments_.purpose,
		expectedOutcomes: arguments_.expectedOutcomes,
		expectedEventCharacteristics: arguments_.events ?? null,
		replayExpectation: arguments_.replayExpectation ?? 'complete',
		coverage: arguments_.coverage,
		regressionFixture: false,
		input: scenarioInput
	};
}

function input({
	position,
	velocity,
	colliders = [],
	regions = [],
	radius = 0.1,
	gravity = defaultSettings.gravity,
	restitution = defaultSettings.restitution,
	maximumEvents = defaultSettings.maximumEvents,
	maximumSimulationTime = defaultSettings.maximumSimulationTime
}: {
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly colliders?: readonly StaticCollider[];
	readonly regions?: readonly AxisAlignedTerminationRegion[];
	readonly radius?: number;
	readonly gravity?: Vec2;
	readonly restitution?: number;
	readonly maximumEvents?: number;
	readonly maximumSimulationTime?: number;
}): SimulationInput {
	const scene: SceneDefinition = {
		id: 'adversarial-scenario',
		coordinateSystem,
		bounds: { width: 10, height: 8 },
		staticColliders: colliders,
		terminationRegions: regions
	};
	return {
		scene,
		initialDynamicBodies: [
			{
				id: 'ball-primary',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius },
				position,
				velocity
			}
		],
		settings: {
			...defaultSettings,
			gravity,
			restitution,
			maximumEvents,
			maximumSimulationTime
		}
	};
}

function circle(id: string, centre: Vec2, radius: number): StaticCollider {
	return { id, motionAuthority: 'static', physicalShape: { type: 'circle', radius }, centre };
}

function line(id: string, start: Vec2, end: Vec2): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start, end }
	};
}
