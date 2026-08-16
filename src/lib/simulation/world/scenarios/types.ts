import type { RunOutcome, SimulationInput } from '../../contracts';

export type ScenarioCategoryId =
	| 'canonical-launches'
	| 'board-layouts'
	| 'physical-settings'
	| 'multi-body-scheduler'
	| 'adversarial-contacts'
	| 'saved-regression-cases';

export type ScenarioCoverageId =
	| 'launch.high-downward-speed'
	| 'launch.high-horizontal-speed'
	| 'launch.shallow-angle-approach'
	| 'launch.near-tangent-peg'
	| 'launch.collider-endpoint-strike'
	| 'launch.symmetry-axis'
	| 'launch.near-symmetry-left'
	| 'launch.near-symmetry-right'
	| 'sustained.contracting-intervals'
	| 'launch.simultaneous-candidates'
	| 'initial.outside-contact-tolerance'
	| 'initial.near-peg-no-overlap'
	| 'initial.near-board-bounds'
	| 'initial.directly-above-peg'
	| 'initial.narrow-passage-entry'
	| 'initial.mirrored-equivalent'
	| 'initial.invalid-overlap'
	| 'board.no-pegs'
	| 'board.isolated-peg'
	| 'board.sparse'
	| 'board.canonical'
	| 'board.dense'
	| 'board.mirrored'
	| 'board.reversed'
	| 'board.flat-support'
	| 'board.angled-ramp'
	| 'board.close-contacts'
	| 'board.no-reachable-exit'
	| 'physics.low-downward-gravity'
	| 'physics.high-downward-gravity'
	| 'physics.zero-gravity-launch'
	| 'physics.lateral-gravity'
	| 'physics.inverted-gravity'
	| 'physics.zero-restitution'
	| 'physics.intermediate-restitution'
	| 'physics.unit-restitution'
	| 'physics.small-radius'
	| 'physics.large-radius'
	| 'physics.event-limit-boundary'
	| 'physics.time-limit-boundary'
	| 'sustained.centred-peg-settling'
	| 'sustained.near-centred-side-selection'
	| 'sustained.flat-resting'
	| 'sustained.line-sliding'
	| 'sustained.circular-detachment'
	| 'sustained.unsupported-detachment'
	| 'sustained.circular-turning-point'
	| 'manifold.circular-acquisition'
	| 'manifold.multi-support-rest'
	| 'manifold.support-release'
	| 'manifold.mixed-support'
	| 'scheduler.staggered-releases'
	| 'scheduler.mixed-outcomes'
	| 'scheduler.resting-continuation'
	| 'scheduler.simultaneous-events'
	| 'scheduler.single-body-equivalence'
	| 'pair.equal-mass-head-on'
	| 'pair.unequal-mass-head-on'
	| 'pair.glancing-impulse-transfer'
	| 'pair.peg-event-interrupted'
	| 'pair.unrelated-prediction-survives'
	| 'pair.repeated-isolated-collisions'
	| 'pair.unsupported-simultaneous-third-body'
	| 'impact.newtons-cradle'
	| 'impact.dynamic-fixed-component'
	| 'impact.symmetric-component'
	| 'impact.inactive-contact-rejection'
	| 'impact.exact-event-ordering'
	| 'impact.participant-order-invariance'
	| 'impact.unsupported-retained-contact'
	| 'impact.implicit-equality'
	| 'impact.scale-invariance'
	| 'impact.multi-body-lineality'
	| 'impact.termination-certification-failure'
	| 'dormant.wedged-remains-anchored'
	| 'dormant.wedged-dislodged'
	| 'dormant.stack-reactivated'
	| 'dormant.component-split'
	| 'dormant.world-continues'
	| 'dormant.unsupported-floating'
	| 'path-interruption.free-circular'
	| 'path-interruption.before-detachment'
	| 'path-interruption.linear-side-impact'
	| 'path-interruption.slider-reactivates-resting'
	| 'path-interruption.circular-circular'
	| 'path-interruption.unsupported-dynamic-support'
	| 'dynamic-support.circular-slide'
	| 'dynamic-support.transmitted-load-retained'
	| 'dynamic-support.transmitted-load-release'
	| 'dynamic-support.external-impact'
	| 'dynamic-support.detachment'
	| 'dynamic-support.unsupported-moving-pair'
	| 'settling.three-ball-capture'
	| 'settling.incremental-off-axis'
	| 'settling.twenty-ball-staggered'
	| 'settling.twenty-ball-legacy-control';

export type ScenarioMotionMode = 'free-flight' | 'linear-contact' | 'circular-contact';

export interface ScenarioContactModeTransitionExpectation {
	readonly from: 'free-flight' | 'impact' | 'resting' | 'sliding';
	readonly to: 'free-flight' | 'impact' | 'resting' | 'sliding';
}

export interface ScenarioEventExpectation {
	readonly summary: string;
	readonly minimumContactEvents?: number;
	readonly maximumContactEvents?: number;
	readonly requiredMotionModes?: readonly ScenarioMotionMode[];
	readonly requiredTransitions?: readonly ScenarioContactModeTransitionExpectation[];
	readonly nearSimultaneousCandidate?: boolean;
}

export interface VerificationScenario {
	readonly id: string;
	readonly name: string;
	readonly categoryId: ScenarioCategoryId;
	readonly verificationPurpose: string;
	readonly expectedOutcomes: readonly RunOutcome[];
	readonly expectedEventCharacteristics: ScenarioEventExpectation | null;
	readonly replayExpectation: 'complete' | 'valid-prefix';
	readonly coverage: readonly ScenarioCoverageId[];
	readonly regressionFixture: boolean;
	readonly input: SimulationInput;
}
