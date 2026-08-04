import type {
	InitialDynamicCircleBodyState,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../../contracts';
import type { VerificationScenario } from '../types';

const coordinateSystem = {
	origin: 'centre-bottom',
	horizontalAxis: 'right',
	verticalAxis: 'up',
	lengthUnit: 'metre'
} as const;

const headOnBodies = [
	body('head-left', [-3, 5], [1, 0]),
	body('head-right', [3, 5], [-1, 0])
] as const;

export const dynamicPairScenarios = [
	scenario(
		'predicted-head-on-contact',
		'Predicted head-on contact',
		'Two free bodies reach an exact continuous-path contact boundary before either local event.',
		'pair.head-on-contact',
		input('predicted-head-on-contact-board', headOnBodies)
	),
	scenario(
		'predicted-glancing-contact',
		'Predicted glancing contact',
		'Offset free paths produce an incoming contact with a non-axis-aligned first-to-second normal.',
		'pair.glancing-contact',
		input('predicted-glancing-contact-board', [
			body('glance-left', [-3, 4.6], [1, 0]),
			body('glance-right', [3, 5.4], [-1, 0])
		])
	),
	scenario(
		'dynamic-near-miss',
		'Dynamic near miss',
		'Close relative paths remain separated throughout their shared certified interval.',
		'pair.near-miss',
		input('dynamic-near-miss-board', [
			body('miss-left', [-3, 4.45], [1, 0]),
			body('miss-right', [3, 5.55], [-1, 0])
		]),
		['time-limit'],
		'valid-prefix'
	),
	scenario(
		'pair-search-clipped-by-peg-event',
		'Pair search clipped by peg event',
		'An earlier fixed-peg impact clips the first pair search before the unmodified free paths would meet.',
		'pair.clipped-by-local-event',
		input(
			'pair-search-clipped-by-peg-event-board',
			[body('peg-runner', [-4, 5], [2, 0]), body('slow-counterpart', [4, 5], [-0.2, 0])],
			[peg('clipping-peg', [-1, 5])],
			[0, 0],
			1
		),
		['time-limit'],
		'valid-prefix'
	),
	scenario(
		'linear-contact-pair-prediction',
		'Linear-contact pair prediction',
		'A free body reaches one moving along a retained straight support before its own floor event.',
		'pair.linear-contact-path',
		input(
			'linear-contact-pair-prediction-board',
			[body('supported-slider', [-2, 0.5], [0.5, 0]), body('free-approach', [2, 1.4], [-10, 0])],
			[floor('linear-support', -7, 7)],
			[0, -9.81],
			0
		)
	),
	scenario(
		'swapped-pair-equivalence',
		'Swapped pair equivalence',
		'Reversing serialized body order preserves the head-on event time and physical classification.',
		'pair.swapped-equivalence',
		input('swapped-pair-equivalence-board', [...headOnBodies].reverse())
	)
] as const satisfies readonly VerificationScenario[];

function scenario(
	id: string,
	name: string,
	verificationPurpose: string,
	coverage: VerificationScenario['coverage'][number],
	scenarioInput: SimulationInput,
	expectedOutcomes: VerificationScenario['expectedOutcomes'] = ['unresolved'],
	replayExpectation: VerificationScenario['replayExpectation'] = 'valid-prefix'
): VerificationScenario {
	return {
		id,
		name,
		categoryId: 'multi-body-scheduler',
		verificationPurpose,
		expectedOutcomes,
		expectedEventCharacteristics: null,
		replayExpectation,
		coverage: [coverage],
		regressionFixture: false,
		input: scenarioInput
	};
}

function input(
	id: string,
	bodies: readonly InitialDynamicCircleBodyState[],
	staticColliders: readonly StaticCollider[] = [],
	gravity: Vec2 = [0, 0],
	restitution = 0,
	maximumSimulationTime = 6
): SimulationInput {
	return {
		scene: {
			id,
			coordinateSystem,
			bounds: { width: 16, height: 10 },
			staticColliders,
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity,
			restitution,
			maximumEvents: 100,
			maximumSimulationTime,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
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

function peg(id: string, centre: Vec2): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'circle', radius: 0.5 },
		centre
	};
}

function floor(id: string, startX: number, endX: number): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [startX, 0], end: [endX, 0] }
	};
}
