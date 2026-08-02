import { describe, expect, it } from 'vitest';
import type { ContactModeTransitionEvent } from '../../contracts';
import { constructSingleBallRun } from '../../run';
import {
	parseSimulationInputFixture,
	serializeSimulationInputFixture
} from '../../serialization/simulation-input';
import {
	adversarialScenarios,
	boardStateScenarios,
	canonicalPlinkoScenarios,
	type ScenarioCoverageId,
	type VerificationScenario
} from '../scenarios';

const requiredCoverage = [
	'launch.high-downward-speed',
	'launch.high-horizontal-speed',
	'launch.shallow-angle-approach',
	'launch.near-tangent-peg',
	'launch.collider-endpoint-strike',
	'launch.symmetry-axis',
	'launch.near-symmetry-left',
	'launch.near-symmetry-right',
	'sustained.contracting-intervals',
	'launch.simultaneous-candidates',
	'initial.outside-contact-tolerance',
	'initial.near-peg-no-overlap',
	'initial.near-board-bounds',
	'initial.directly-above-peg',
	'initial.narrow-passage-entry',
	'initial.mirrored-equivalent',
	'initial.invalid-overlap',
	'board.no-pegs',
	'board.isolated-peg',
	'board.sparse',
	'board.canonical',
	'board.dense',
	'board.mirrored',
	'board.reversed',
	'board.flat-support',
	'board.angled-ramp',
	'board.close-contacts',
	'board.no-reachable-exit',
	'physics.low-downward-gravity',
	'physics.high-downward-gravity',
	'physics.zero-gravity-launch',
	'physics.lateral-gravity',
	'physics.inverted-gravity',
	'physics.zero-restitution',
	'physics.intermediate-restitution',
	'physics.unit-restitution',
	'physics.small-radius',
	'physics.large-radius',
	'physics.event-limit-boundary',
	'physics.time-limit-boundary',
	'sustained.centred-peg-settling',
	'sustained.near-centred-side-selection',
	'sustained.flat-resting',
	'sustained.line-sliding',
	'sustained.circular-detachment',
	'sustained.unsupported-detachment',
	'sustained.unresolved-continuation'
] as const satisfies readonly ScenarioCoverageId[];

const completeCatalogue: readonly VerificationScenario[] = [
	...canonicalPlinkoScenarios,
	...boardStateScenarios,
	...adversarialScenarios
];

describe('inspectable adversarial scenario catalogue', () => {
	it('covers every required family with stable, complete metadata', () => {
		const actualCoverage = new Set(completeCatalogue.flatMap(({ coverage }) => coverage));
		expect([...actualCoverage].sort()).toEqual([...requiredCoverage].sort());
		expect(new Set(completeCatalogue.map(({ id }) => id)).size).toBe(completeCatalogue.length);

		for (const scenario of completeCatalogue) {
			expect(scenario.id, scenario.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
			expect(scenario.name.length, scenario.id).toBeGreaterThan(5);
			expect(scenario.verificationPurpose.length, scenario.id).toBeGreaterThan(20);
			expect(scenario.input.scene.id.length, scenario.id).toBeGreaterThan(5);
			expect(scenario.input.initialDynamicBodies, scenario.id).toHaveLength(1);
			expect(scenario.expectedOutcomes.length, scenario.id).toBeGreaterThan(0);
			expect(['complete', 'valid-prefix'], scenario.id).toContain(scenario.replayExpectation);
			expect(JSON.parse(JSON.stringify(scenario)), scenario.id).toEqual(scenario);
		}
	});

	it('runs every named scenario through the authoritative simulator and satisfies its contract', () => {
		for (const scenario of completeCatalogue) {
			const run = constructSingleBallRun(scenario.input);
			expect(scenario.expectedOutcomes, scenario.id).toContain(run.outcome);
			expect(run.input, scenario.id).toBe(scenario.input);
			assertEventExpectation(scenario, run);

			if (scenario.replayExpectation === 'complete') {
				expect(['invalid', 'unresolved'], scenario.id).not.toContain(run.outcome);
			} else if (run.outcome === 'unresolved') {
				expect(run.trajectories[0]?.segments.length, scenario.id).toBeGreaterThan(0);
			}
		}
	});

	it('round-trips every semantically valid input through the versioned scenario format', () => {
		for (const scenario of completeCatalogue) {
			const serialized = serializeSimulationInputFixture(scenario.input);
			if (scenario.expectedOutcomes.includes('invalid')) {
				expect(JSON.parse(serialized).input, scenario.id).toEqual(scenario.input);
			} else {
				expect(parseSimulationInputFixture(serialized), scenario.id).toEqual(scenario.input);
			}
		}
	});

	it('preserves mirrored near-centre evidence with opposite horizontal signs', () => {
		const left = constructSingleBallRun(adversarial('near-centre-left-selection').input);
		const right = constructSingleBallRun(adversarial('near-centre-right-selection').input);

		expect(right.outcome).toBe(left.outcome);
		expect(right.terminalReason.time).toBeCloseTo(left.terminalReason.time ?? 0, 12);
		expect(right.events).toHaveLength(left.events.length);
		for (const [index, leftEvent] of left.events.entries()) {
			const rightEvent = right.events[index]!;
			expect(rightEvent.time, `event ${index} time`).toBeCloseTo(leftEvent.time, 12);
			expect(rightEvent.position[0], `event ${index} x`).toBeCloseTo(-leftEvent.position[0], 12);
			expect(rightEvent.position[1], `event ${index} y`).toBeCloseTo(leftEvent.position[1], 12);
		}
	});
});

function assertEventExpectation(
	scenario: VerificationScenario,
	run: ReturnType<typeof constructSingleBallRun>
): void {
	const expectation = scenario.expectedEventCharacteristics;
	if (!expectation) return;
	const contacts = run.events.filter(({ type }) => type === 'contact');
	const transitions = run.events.filter(
		(event): event is ContactModeTransitionEvent => event.type === 'contact-mode-transition'
	);
	const modes = new Set(
		run.trajectories.flatMap(({ segments }) => segments.map(({ type }) => type))
	);

	if (expectation.minimumContactEvents !== undefined) {
		expect(contacts.length, scenario.id).toBeGreaterThanOrEqual(expectation.minimumContactEvents);
	}
	if (expectation.maximumContactEvents !== undefined) {
		expect(contacts.length, scenario.id).toBeLessThanOrEqual(expectation.maximumContactEvents);
	}
	for (const mode of expectation.requiredMotionModes ?? []) {
		expect(modes.has(mode), `${scenario.id} requires ${mode}`).toBe(true);
	}
	for (const required of expectation.requiredTransitions ?? []) {
		expect(
			transitions.some(({ from, to }) => from === required.from && to === required.to),
			`${scenario.id} requires ${required.from}->${required.to}`
		).toBe(true);
	}
	if (expectation.nearSimultaneousCandidate) {
		expect(
			run.diagnostics.contactSearches.some(({ candidates }) =>
				candidates.some(({ nearSimultaneous }) => nearSimultaneous)
			),
			scenario.id
		).toBe(true);
	}
}

function adversarial(id: (typeof adversarialScenarios)[number]['id']) {
	return adversarialScenarios.find((scenario) => scenario.id === id)!;
}
