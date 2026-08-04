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

export const accumulationScenarios = [
	scenario(
		'flame-46-exact-fit-generalised',
		'FLAME-46 exact-fit generalised accumulation',
		'Contracting alternating peg contacts promote through general accumulation, anti-locking and ordinary free-flight release.',
		'accumulation.exact-fit-generalised',
		exactFitInput(),
		['time-limit', 'exited']
	),
	scenario(
		'flame-46-oversized-generalised',
		'FLAME-46 oversized generalised accumulation',
		'Contracting alternating peg contacts promote through general accumulation and ordinary support certification into rest.',
		'accumulation.oversized-generalised',
		oversizedInput(),
		['settled']
	),
	scenario(
		'three-ball-settlement',
		'Three-ball supported settlement',
		'A small dynamic cluster promotes into a resting component without exhausting the event limit.',
		'accumulation.three-ball-settlement',
		stackInput(3, 0.2),
		['settled', 'time-limit', 'no-future-event']
	),
	scenario(
		'dynamic-alternating-supports',
		'Dynamic alternating supports',
		'Fixed and dynamic contact edges alternate inside one connected participant cluster before limit acquisition.',
		'accumulation.dynamic-alternating-supports',
		dynamicAlternatingInput(),
		['settled', 'time-limit', 'no-future-event', 'unresolved']
	),
	scenario(
		'multi-body-non-alternating-accumulation',
		'Multi-body non-alternating accumulation',
		'A changing contact graph converges without a pure A-B alternation pattern.',
		'accumulation.non-alternating',
		nonAlternatingInput(),
		['settled', 'time-limit', 'no-future-event', 'unresolved']
	),
	scenario(
		'lineality-created-at-accumulation',
		'Lineality created at accumulation',
		'Implicit equality exists at the reconstructed limiting state but not at earlier physical events.',
		'accumulation.lineality-at-limit',
		linealityAtLimitInput(),
		['time-limit', 'exited', 'settled', 'unresolved']
	),
	scenario(
		'accumulation-separates-components',
		'Accumulation separates components',
		'Promotion may produce several separating continuations rather than forced rest.',
		'accumulation.separates-components',
		separatingInput(),
		['time-limit', 'exited', 'no-future-event', 'unresolved']
	),
	scenario(
		'incremental-pile-formation',
		'Incremental pile formation',
		'Bodies join an existing resting component over several scheduled releases.',
		'accumulation.incremental-pile',
		incrementalPileInput(),
		['settled', 'time-limit', 'no-future-event']
	),
	scenario(
		'twenty-ball-container-drop',
		'Twenty-ball container drop',
		'A deterministic 20-body stress scenario forms an inspectable pile without arbitrary freezing.',
		'accumulation.twenty-ball-container',
		containerDropInput(20),
		['settled', 'time-limit', 'event-limit', 'no-future-event']
	),
	scenario(
		'pile-reactivated-after-settlement',
		'Pile reactivated after settlement',
		'A later scheduled body strikes and reactivates a promoted resting component.',
		'accumulation.pile-reactivated',
		pileReactivatedInput(),
		['settled', 'time-limit', 'no-future-event']
	),
	scenario(
		'dense-nonconverging-cascade',
		'Dense non-converging cascade',
		'Frequent impacts without sufficient convergence are not frozen.',
		'accumulation.dense-nonconverging',
		denseNonconvergingInput(),
		['time-limit', 'event-limit', 'exited', 'unresolved']
	),
	scenario(
		'uncertifiable-temporal-tail',
		'Uncertifiable temporal tail',
		'Shrinking intervals without a certified finite bound preserve the valid prefix and explicit unresolved result.',
		'accumulation.uncertifiable-temporal',
		uncertifiableTemporalInput(),
		['unresolved', 'time-limit', 'event-limit']
	),
	scenario(
		'uncertifiable-limit-geometry',
		'Uncertifiable limit geometry',
		'Temporal contraction exists but limiting contacts or states cannot be certified.',
		'accumulation.uncertifiable-geometry',
		uncertifiableGeometryInput(),
		['unresolved', 'time-limit', 'event-limit']
	)
] as const satisfies readonly VerificationScenario[];

function scenario(
	id: string,
	name: string,
	verificationPurpose: string,
	coverage: ScenarioCoverageId,
	input: SimulationInput,
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
			minimumContactEvents: 1
		},
		replayExpectation: expectedOutcomes.includes('unresolved') ? 'valid-prefix' : 'complete',
		coverage: [coverage],
		regressionFixture: id.startsWith('flame-46'),
		input
	};
}

function exactFitInput(): SimulationInput {
	return pegThroatInput(0.135, 8);
}

function oversizedInput(): SimulationInput {
	return pegThroatInput(0.14, 8);
}

function pegThroatInput(radius: number, maximumSimulationTime: number): SimulationInput {
	return {
		scene: {
			id: `accumulation-throat-r${radius}`,
			coordinateSystem,
			bounds: { width: 4, height: 5 },
			staticColliders: [
				circle('left-peg', [0.42, 3.25], 0.075),
				circle('right-peg', [0.84, 3.25], 0.075),
				horizontalLine('floor', 0)
			],
			terminationRegions: []
		},
		initialDynamicBodies: [body('ball', [0.63, 4.2], [0, 0], radius, 0)],
		settings: {
			gravity: [0, -9.81],
			restitution: 0.6,
			maximumEvents: 200,
			maximumSimulationTime,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function stackInput(count: number, radius: number): SimulationInput {
	const bodies = Array.from({ length: count }, (_, index) =>
		body(`ball-${index}`, [0, radius + index * 2 * radius + 0.01], [0, 0], radius, 0)
	);
	return {
		scene: {
			id: `accumulation-stack-${count}`,
			coordinateSystem,
			bounds: { width: 6, height: 8 },
			staticColliders: [
				horizontalLine('floor', 0),
				verticalLine('left-wall', -1.5),
				verticalLine('right-wall', 1.5)
			],
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity: [0, -10],
			restitution: 0.2,
			maximumEvents: 400,
			maximumSimulationTime: 6,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function dynamicAlternatingInput(): SimulationInput {
	return {
		scene: {
			id: 'accumulation-dynamic-alternating',
			coordinateSystem,
			bounds: { width: 6, height: 6 },
			staticColliders: [horizontalLine('floor', 0)],
			terminationRegions: []
		},
		initialDynamicBodies: [
			body('support', [0, 0.2], [0, 0], 0.2, 0),
			body('mover', [0, 0.65], [0.4, 0], 0.2, 0)
		],
		settings: {
			gravity: [0, -10],
			restitution: 0.5,
			maximumEvents: 200,
			maximumSimulationTime: 4,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function nonAlternatingInput(): SimulationInput {
	return {
		scene: {
			id: 'accumulation-non-alternating',
			coordinateSystem,
			bounds: { width: 6, height: 6 },
			staticColliders: [
				horizontalLine('floor', 0),
				circle('peg-a', [-0.3, 0.2], 0.15),
				circle('peg-b', [0.3, 0.2], 0.15),
				circle('peg-c', [0, 0.55], 0.12)
			],
			terminationRegions: []
		},
		initialDynamicBodies: [body('ball', [0, 1.4], [0.2, 0], 0.12, 0)],
		settings: {
			gravity: [0, -10],
			restitution: 0.55,
			maximumEvents: 250,
			maximumSimulationTime: 5,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function linealityAtLimitInput(): SimulationInput {
	return pegThroatInput(0.135, 5);
}

function separatingInput(): SimulationInput {
	return {
		scene: {
			id: 'accumulation-separating',
			coordinateSystem,
			bounds: { width: 8, height: 4 },
			staticColliders: [horizontalLine('floor', 0)],
			terminationRegions: []
		},
		initialDynamicBodies: [
			body('left', [-0.5, 0.2], [1, 0], 0.2, 0),
			body('right', [0.5, 0.2], [-1, 0], 0.2, 0)
		],
		settings: {
			gravity: [0, -10],
			restitution: 1,
			maximumEvents: 80,
			maximumSimulationTime: 2,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function incrementalPileInput(): SimulationInput {
	return {
		scene: {
			id: 'accumulation-incremental-pile',
			coordinateSystem,
			bounds: { width: 6, height: 8 },
			staticColliders: [
				horizontalLine('floor', 0),
				verticalLine('left-wall', -1),
				verticalLine('right-wall', 1)
			],
			terminationRegions: []
		},
		initialDynamicBodies: [
			body('base', [0, 0.2], [0, 0], 0.2, 0),
			body('join-a', [0, 1.2], [0, 0], 0.2, 0.8),
			body('join-b', [0, 2.2], [0, 0], 0.2, 1.6)
		],
		settings: {
			gravity: [0, -10],
			restitution: 0.15,
			maximumEvents: 300,
			maximumSimulationTime: 6,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function containerDropInput(count: number): SimulationInput {
	const bodies = Array.from({ length: count }, (_, index) => {
		const column = index % 4;
		const row = Math.floor(index / 4);
		return body(`ball-${index}`, [-0.45 + column * 0.3, 2.5 + row * 0.35], [0, 0], 0.12, 0);
	});
	return {
		scene: {
			id: 'accumulation-twenty-ball-container',
			coordinateSystem,
			bounds: { width: 8, height: 10 },
			staticColliders: [
				horizontalLine('floor', 0),
				verticalLine('left-wall', -1),
				verticalLine('right-wall', 1)
			],
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity: [0, -10],
			restitution: 0.1,
			maximumEvents: 2000,
			maximumSimulationTime: 12,
			tolerances: { contactDistance: 1e-7, eventTime: 1e-7 }
		}
	};
}

function pileReactivatedInput(): SimulationInput {
	return {
		scene: {
			id: 'accumulation-pile-reactivated',
			coordinateSystem,
			bounds: { width: 6, height: 8 },
			staticColliders: [
				horizontalLine('floor', 0),
				verticalLine('left-wall', -1),
				verticalLine('right-wall', 1)
			],
			terminationRegions: []
		},
		initialDynamicBodies: [
			body('resting-a', [-0.15, 0.2], [0, 0], 0.2, 0),
			body('resting-b', [0.15, 0.2], [0, 0], 0.2, 0),
			body('striker', [0, 2.5], [0, -2], 0.2, 1.5)
		],
		settings: {
			gravity: [0, -10],
			restitution: 0.2,
			maximumEvents: 300,
			maximumSimulationTime: 6,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function denseNonconvergingInput(): SimulationInput {
	return {
		scene: {
			id: 'accumulation-dense-nonconverging',
			coordinateSystem,
			bounds: { width: 6, height: 4 },
			staticColliders: [
				horizontalLine('floor', 0),
				verticalLine('left-wall', -1),
				verticalLine('right-wall', 1)
			],
			terminationRegions: []
		},
		initialDynamicBodies: [
			body('a', [-0.4, 0.2], [2, 0], 0.15, 0),
			body('b', [0.4, 0.2], [-2, 0], 0.15, 0)
		],
		settings: {
			gravity: [0, 0],
			restitution: 1,
			maximumEvents: 120,
			maximumSimulationTime: 3,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function uncertifiableTemporalInput(): SimulationInput {
	return {
		scene: {
			id: 'accumulation-uncertifiable-temporal',
			coordinateSystem,
			bounds: { width: 4, height: 4 },
			staticColliders: [horizontalLine('floor', 0)],
			terminationRegions: []
		},
		initialDynamicBodies: [body('ball', [0, 0.2], [0.5, 0], 0.2, 0)],
		settings: {
			gravity: [0, -10],
			restitution: 0.95,
			maximumEvents: 80,
			maximumSimulationTime: 2,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function uncertifiableGeometryInput(): SimulationInput {
	return {
		scene: {
			id: 'accumulation-uncertifiable-geometry',
			coordinateSystem,
			bounds: { width: 6, height: 4 },
			staticColliders: [circle('lonely-peg', [0, 0.5], 0.2)],
			terminationRegions: []
		},
		initialDynamicBodies: [body('ball', [0, 2], [0, 0], 0.15, 0)],
		settings: {
			gravity: [0, -10],
			restitution: 0.9,
			maximumEvents: 100,
			maximumSimulationTime: 3,
			tolerances: { contactDistance: 1e-8, eventTime: 1e-8 }
		}
	};
}

function body(
	id: string,
	position: Vec2,
	velocity: Vec2,
	radius: number,
	releaseTime: number
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

function circle(id: string, centre: Vec2, radius: number): StaticCollider {
	return { id, motionAuthority: 'static', physicalShape: { type: 'circle', radius }, centre };
}

function horizontalLine(id: string, y: number): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [-3, y], end: [3, y] }
	};
}

function verticalLine(id: string, x: number): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [x, 0], end: [x, 4] }
	};
}
