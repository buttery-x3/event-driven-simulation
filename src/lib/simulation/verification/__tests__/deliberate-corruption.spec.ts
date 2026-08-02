import { describe, expect, it } from 'vitest';
import type { SimulationInput, SimulationRunRecord, StaticCollider } from '../../contracts';
import { evaluateMotionSegmentPosition } from '../../motion';
import { constructSingleBallRun } from '../../run';
import { parseSimulationRunFixture } from '../../serialization/run-record';
import { boardStateScenarios, canonicalPlinkoScenarios } from '../../world';
import { validateSimulationRun, type RunValidationFailureCode } from '..';
import releaseForensicJson from '../../../../../fixtures/regressions/flame-42-post-detachment-zero-time-loop.json?raw';
import turningPointJson from '../../../../../fixtures/regressions/flame-43-circular-turning-point.json?raw';

const canonicalInput = canonicalPlinkoScenarios.find(({ id }) => id === 'offset-drop')!.input;
const closeContactsInput = boardStateScenarios.find(({ id }) => id === 'close-contacts')!.input;

describe('deliberate run-record corruption', () => {
	it('rejects non-finite data and unresolved references', () => {
		const nonFinite = cloneRun(constructSingleBallRun(canonicalInput));
		Object.assign(nonFinite.events[0]!, { time: Number.NaN });
		expectFailure(canonicalInput, nonFinite, 'NON_FINITE_VALUE');

		const unresolved = cloneRun(constructSingleBallRun(canonicalInput));
		Object.assign(unresolved.events[0]!, { colliderId: 'missing-collider' });
		expectFailure(canonicalInput, unresolved, 'UNRESOLVED_REFERENCE');
	});

	it('rejects a backdated, discontinuous trajectory join', () => {
		const run = cloneRun(constructSingleBallRun(canonicalInput));
		const segments = run.trajectories[0]!.segments;
		Object.assign(segments[1]!, {
			startTime: segments[0]!.startTime - 0.1,
			startPosition: [99, 99]
		});

		expectFailure(canonicalInput, run, 'NON_MONOTONIC_TIME');
		expectFailure(canonicalInput, run, 'DISCONTINUOUS_POSITION');
	});

	it('rejects contact geometry and normal evidence inconsistent with the collider', () => {
		const run = cloneRun(constructSingleBallRun(closeContactsInput));
		const event = run.events.find(({ type }) => type === 'contact')!;
		Object.assign(event, { normal: [1, 0] });
		const contact = event.type === 'contact' ? event.contacts?.[0] : undefined;
		if (contact) Object.assign(contact, { contactPoint: [99, 99] });

		expectFailure(closeContactsInput, run, 'CONTACT_NORMAL_MISMATCH');
		expectFailure(closeContactsInput, run, 'CONTACT_OFF_BOUNDARY');
	});

	it('rejects an obvious earlier fixed-world crossing in committed free flight', () => {
		const noPegsInput = boardStateScenarios.find(({ id }) => id === 'no-pegs')!.input;
		const run = cloneRun(constructSingleBallRun(noPegsInput));
		const segment = run.trajectories[0]!.segments[0]!;
		const time = segment.startTime + (segment.endTime - segment.startTime) / 2;
		const centre = evaluateMotionSegmentPosition(segment, time);
		const blocker: StaticCollider = {
			id: 'corruption-blocker',
			motionAuthority: 'static',
			physicalShape: { type: 'circle', radius: 0.25 },
			centre
		};
		Object.assign(run.input.scene, {
			staticColliders: [...run.input.scene.staticColliders, blocker]
		});

		expectFailure(run.input, run, 'EARLY_GEOMETRY_CROSSING');
	});

	it('rejects inward manifold velocity and negative impulse evidence', () => {
		const run = cloneRun(constructSingleBallRun(closeContactsInput));
		const event = run.events.find(({ type }) => type === 'contact')!;
		const contact = event.type === 'contact' ? event.contacts?.[0] : undefined;
		if (contact) Object.assign(contact, { impulse: -1, postImpactNormalVelocity: -1 });

		expectFailure(closeContactsInput, run, 'NEGATIVE_IMPULSE');
		expectFailure(closeContactsInput, run, 'PENETRATING_POST_IMPACT_VELOCITY');
	});

	it('rejects constrained drift and an invalid circular turning boundary', () => {
		const drift = cloneRun(parseSimulationRunFixture(turningPointJson));
		const circular = drift.trajectories[0]!.segments.find(
			(segment) => segment.type === 'circular-contact'
		)!;
		if (circular.type === 'circular-contact') {
			Object.assign(circular, { centre: [circular.centre[0] + 0.1, circular.centre[1]] });
		}
		expectFailure(drift.input, drift, 'CONSTRAINED_PATH_DRIFT');

		const turning = cloneRun(parseSimulationRunFixture(turningPointJson));
		const reversed = turning.trajectories[0]!.segments.filter(
			(segment) => segment.type === 'circular-contact'
		)[1]!;
		if (reversed.type === 'circular-contact') {
			Object.assign(reversed, { startTangentialSpeed: 1, startVelocity: [1, 0] });
		}
		expectFailure(turning.input, turning, 'INVALID_TURNING_POINT');
	});

	it('rejects infeasible rest and inconsistent terminal limits', () => {
		const rest = cloneRun(constructSingleBallRun(closeContactsInput));
		if (rest.terminalReason.type === 'resting-contact') {
			Object.assign(rest.terminalReason, { supportReactions: [-1, -1] });
		}
		expectFailure(closeContactsInput, rest, 'INFEASIBLE_RESTING_SUPPORT');

		const limitedInput = {
			...closeContactsInput,
			settings: { ...closeContactsInput.settings, maximumEvents: 1 }
		};
		const limited = cloneRun(constructSingleBallRun(limitedInput));
		Object.assign(limited.terminalReason, { limit: 99 });
		expectFailure(limitedInput, limited, 'LIMIT_MISMATCH');
	});

	it('rejects a partial run whose playable prefix extends beyond failure', () => {
		const run = cloneRun(parseSimulationRunFixture(releaseForensicJson));
		const finalSegment = run.trajectories[0]!.segments.at(-1)!;
		Object.assign(finalSegment, { endTime: run.diagnostics.simulatedUntilTime + 1 });

		expectFailure(run.input, run, 'PREFIX_AFTER_TERMINAL');
	});
});

function cloneRun(run: SimulationRunRecord): SimulationRunRecord {
	return structuredClone(run);
}

function expectFailure(
	input: SimulationInput,
	run: SimulationRunRecord,
	code: RunValidationFailureCode
): void {
	const result = validateSimulationRun(input, run);
	expect(result.valid).toBe(false);
	expect(result.failures, code).toContainEqual(expect.objectContaining({ code }));
}
