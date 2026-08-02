import { describe, expect, it } from 'vitest';
import type { SimulationInput, StaticCollider, Vec2 } from '../../contracts';
import { evaluateMotionSegmentPosition } from '../../motion';
import { constructSingleBallRun } from '../../run';
import { parseSimulationRunFixture } from '../../serialization/run-record';
import { adversarialScenarios, boardStateScenarios, canonicalPlinkoScenarios } from '../../world';
import { validateSimulationRun } from '..';
import highSpeedPegJson from '../../../../../fixtures/regressions/flame-27-high-speed-peg-contact.json?raw';
import highSpeedWallJson from '../../../../../fixtures/regressions/flame-28-high-speed-wall-contact.json?raw';
import releaseForensicJson from '../../../../../fixtures/regressions/flame-42-post-detachment-zero-time-loop.json?raw';
import turningPointJson from '../../../../../fixtures/regressions/flame-43-circular-turning-point.json?raw';

describe('bounded difficult-family challenges', () => {
	it('checks FLAME-42 release ownership locally without reconstructing contact roots', () => {
		const forensic = parseSimulationRunFixture(releaseForensicJson);
		const corrected = constructSingleBallRun(forensic.input);
		const release = corrected.events.find(
			(event) => event.type === 'contact-mode-transition' && event.reason === 'support-lost'
		)!;
		const search = corrected.diagnostics.contactSearches.find(
			(candidate) => candidate.searchInterval[0] === release.time
		)!;
		const releasedCandidate = search.candidates.find(
			({ colliderId }) => colliderId === release.colliderId
		)!;
		const outgoing = corrected.trajectories[0]!.segments.find(
			(segment) => segment.type === 'free-flight' && segment.startTime === release.time
		)!;
		const nearbyTime = Math.min(outgoing.endTime, outgoing.startTime + 1e-5);
		const nearbyPosition = evaluateMotionSegmentPosition(outgoing, nearbyTime);
		const collider = corrected.input.scene.staticColliders.find(
			({ id }) => id === release.colliderId
		)!;

		expect(releasedCandidate.classification).toBe('rejected-release-owned');
		expect(releasedCandidate.eventContactSetMember).not.toBe(true);
		expect(circleClearance(corrected.input, collider, nearbyPosition)).toBeGreaterThan(0);
		expect(validateSimulationRun(forensic.input, corrected).failures).toEqual([]);
	});

	it('checks the FLAME-43 zero-speed circular reversal and serialized fixture', () => {
		const run = parseSimulationRunFixture(turningPointJson);
		const circular = run.trajectories[0]!.segments.filter(
			(segment) => segment.type === 'circular-contact'
		);
		const incoming = circular[0]!;
		const outgoing = circular[1]!;

		expect(incoming.endTime).toBe(outgoing.startTime);
		expect(outgoing.startTangentialSpeed).toBe(0);
		expect(outgoing.direction).toBe(-incoming.direction);
		expect(validateSimulationRun(run.input, run).failures).toEqual([]);
	});

	it('checks FLAME-44 manifold conditions and collider order/name invariance', () => {
		const input = boardStateScenarios.find(({ id }) => id === 'close-contacts')!.input;
		const baseline = constructSingleBallRun(input);
		const reversedInput = withColliders(input, [...input.scene.staticColliders].reverse());
		const renamedInput = withColliders(
			input,
			input.scene.staticColliders.map((collider, index) => ({
				...collider,
				id: `renamed-${index}`
			}))
		);
		const reversed = constructSingleBallRun(reversedInput);
		const renamed = constructSingleBallRun(renamedInput);
		const first = baseline.events.find(({ type }) => type === 'contact');

		expect(first).toMatchObject({ type: 'contact', contacts: [{}, {}] });
		if (first?.type === 'contact') {
			expect(first.contacts?.every(({ impulse }) => impulse >= 0)).toBe(true);
			expect(
				first.contacts?.every(({ postImpactNormalVelocity }) => postImpactNormalVelocity >= -1e-9)
			).toBe(true);
		}
		expect(baseline.terminalReason).toMatchObject({
			type: 'resting-contact',
			contacts: [{}, {}]
		});
		expect(reversed.trajectories).toEqual(baseline.trajectories);
		expect(renamed.trajectories).toEqual(baseline.trajectories);
		expect(validateSimulationRun(input, baseline).failures).toEqual([]);
		expect(validateSimulationRun(reversedInput, reversed).failures).toEqual([]);
		expect(validateSimulationRun(renamedInput, renamed).failures).toEqual([]);
	});

	it('checks high-speed and mirrored scenarios independently of presentation frames', () => {
		for (const json of [highSpeedPegJson, highSpeedWallJson]) {
			const run = parseSimulationRunFixture(json);
			expect(validateSimulationRun(run.input, run).failures).toEqual([]);
		}
		const leftInput = adversarialScenarios.find(
			({ id }) => id === 'near-centre-left-selection'
		)!.input;
		const rightInput = adversarialScenarios.find(
			({ id }) => id === 'near-centre-right-selection'
		)!.input;
		const left = constructSingleBallRun(leftInput);
		const right = constructSingleBallRun(rightInput);
		expect(right.outcome).toBe(left.outcome);
		for (const [index, leftEvent] of left.events.entries()) {
			expect(right.events[index]!.position[0]).toBeCloseTo(-leftEvent.position[0], 10);
			expect(right.events[index]!.position[1]).toBeCloseTo(leftEvent.position[1], 10);
		}
		expect(validateSimulationRun(leftInput, left)).toEqual(validateSimulationRun(leftInput, left));
	});

	it('accepts representative complete, unresolved and invalid certified prefixes', () => {
		const completeInput = canonicalPlinkoScenarios[0].input;
		const complete = constructSingleBallRun(completeInput);
		const unresolved = parseSimulationRunFixture(releaseForensicJson);
		const invalidInput = adversarialScenarios.find(
			({ id }) => id === 'invalid-initial-peg-overlap'
		)!.input;
		const invalid = constructSingleBallRun(invalidInput);

		expect(complete.outcome).not.toMatch(/unresolved|invalid/);
		expect(unresolved.outcome).toBe('unresolved');
		expect(invalid.outcome).toBe('invalid');
		expect(validateSimulationRun(completeInput, complete).failures).toEqual([]);
		expect(validateSimulationRun(unresolved.input, unresolved).failures).toEqual([]);
		expect(validateSimulationRun(invalidInput, invalid).failures).toEqual([]);
	});
});

function circleClearance(input: SimulationInput, collider: StaticCollider, position: Vec2): number {
	if (!('centre' in collider)) return Number.POSITIVE_INFINITY;
	return (
		Math.hypot(position[0] - collider.centre[0], position[1] - collider.centre[1]) -
		collider.physicalShape.radius -
		input.initialDynamicBodies[0]!.physicalShape.radius
	);
}

function withColliders(
	input: SimulationInput,
	staticColliders: readonly StaticCollider[]
): SimulationInput {
	return { ...input, scene: { ...input.scene, staticColliders } };
}
