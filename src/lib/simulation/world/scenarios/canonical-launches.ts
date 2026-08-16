import type { Vec2 } from '../../contracts';
import { canonicalPegDimensions, canonicalPlinkoBoard } from '../canonical-board';
import type { VerificationScenario } from './types';

export interface SimulationScenario extends VerificationScenario {
	readonly initialConditionSummary: string;
}

const defaultSettings = {
	gravity: [0, -9.81],
	restitution: 0.78,
	contactCaptureDistance: 1e-9,
	maximumEvents: 1_000,
	maximumSimulationTime: 60,
	tolerances: {
		contactDistance: 1e-9,
		eventTime: 1e-9
	}
} as const;

const ballRadius = 0.13;
const grazingOffset = ballRadius + canonicalPegDimensions.radius - 0.001;

export const canonicalPlinkoScenarios = [
	scenario(
		'vertical-centre-drop',
		'Vertical centre drop',
		[0, 6.62],
		[0, 0],
		'Ball released from rest on the vertical centreline.',
		'Baseline gravity-driven traversal and symmetric first contact with the centre peg.',
		['settled'],
		['launch.symmetry-axis', 'sustained.centred-peg-settling', 'sustained.contracting-intervals']
	),
	scenario(
		'offset-drop',
		'Offset drop',
		[0.43, 6.62],
		[0, 0],
		'Ball released from rest 0.43 m right of the centreline.',
		'Asymmetric peg selection and deterministic sensitivity to launch position.',
		['exited']
	),
	scenario(
		'angled-launch',
		'Angled launch',
		[-1.45, 6.5],
		[1.8, -0.3],
		'Ball launched down and right from the upper-left entry.',
		'Combined horizontal and vertical motion through the staggered field.',
		['exited'],
		['physics.intermediate-restitution']
	),
	scenario(
		'high-speed-launch',
		'High-speed launch',
		[-1.8, 6.48],
		[8, -14],
		'Ball launched at 16.12 m/s down and right from the upper-left entry.',
		'Earliest-event solving at a speed that would expose tunnelling in sampled collision checks.',
		['exited'],
		['launch.high-downward-speed', 'launch.high-horizontal-speed']
	),
	scenario(
		'near-grazing-peg-contact',
		'Near-grazing peg contact',
		[grazingOffset, 6.62],
		[0, 0],
		`Ball released ${grazingOffset.toFixed(3)} m right of the centre peg axis.`,
		'Contact classification when the vertical path nearly grazes the first-row centre peg.',
		['exited'],
		['launch.near-tangent-peg']
	)
] as const satisfies readonly SimulationScenario[];

export const defaultCanonicalPlinkoScenario = canonicalPlinkoScenarios[0];

function scenario(
	id: string,
	name: string,
	position: Vec2,
	velocity: Vec2,
	initialConditionSummary: string,
	verificationPurpose: string,
	expectedOutcomes: SimulationScenario['expectedOutcomes'],
	coverage: SimulationScenario['coverage'] = []
): SimulationScenario {
	return {
		id,
		name,
		categoryId: 'canonical-launches',
		initialConditionSummary,
		verificationPurpose,
		expectedOutcomes,
		expectedEventCharacteristics:
			id === 'vertical-centre-drop'
				? {
						summary: 'Centred impacts contract into an explicit impact-to-resting transition.',
						minimumContactEvents: 2,
						requiredTransitions: [{ from: 'impact', to: 'resting' }]
					}
				: null,
		replayExpectation: 'complete',
		coverage,
		regressionFixture: false,
		input: {
			scene: canonicalPlinkoBoard,
			initialDynamicBodies: [
				{
					id: 'ball-primary',
					motionAuthority: 'dynamic',
					physicalShape: { type: 'circle', radius: ballRadius },
					mass: 1,
					position,
					velocity,
					releaseTime: 0
				}
			],
			settings: defaultSettings
		}
	};
}
