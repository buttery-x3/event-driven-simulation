import { describe, expect, it } from 'vitest';
import { boardStateScenarios } from '../board-state-scenarios';
import { defaultFixedWorldContactTolerances, findEarliestFixedWorldContact } from '../../collision';
import { constructSingleBallRun } from '../../run';
import { evaluateMotionSegmentPosition } from '../../motion';

describe('varied serialisable board-state scenarios', () => {
	it('runs every scenario through the same authoritative headless simulator', () => {
		for (const scenario of boardStateScenarios) {
			const run = constructSingleBallRun(scenario.input);
			const segments = run.trajectories[0]?.segments ?? [];

			expect(scenario.expectedOutcomes, scenario.id).toContain(run.outcome);
			expect(run.validity, scenario.id).toBe('valid');
			expect(run.diagnostics.eventCount, scenario.id).toBe(run.events.length);
			expect(run.diagnostics.segmentCount, scenario.id).toBe(segments.length);
			expect(run.diagnostics.simulatedUntilTime, scenario.id).toBe(run.terminalReason.time);
			expect(run.diagnostics.entries.at(-1)?.code, scenario.id).toBe(
				`RUN_${run.outcome.replaceAll('-', '_').toUpperCase()}`
			);

			for (let index = 0; index < segments.length; index += 1) {
				const segment = segments[index]!;
				expect(segment.endTime, `${scenario.id} segment ${index}`).toBeGreaterThan(
					segment.startTime
				);
				if (index > 0) {
					const previous = segments[index - 1]!;
					expect(segment.startTime, `${scenario.id} segment ${index}`).toBe(previous.endTime);
					expect(segment.startPosition, `${scenario.id} segment ${index}`).toEqual(
						evaluateMotionSegmentPosition(previous, previous.endTime)
					);
				}

				const certifiedUntil = segment.endTime - 1e-6;
				if (certifiedUntil > segment.startTime && segment.type === 'free-flight') {
					const previous = index > 0 ? segments[index - 1]! : null;
					const search = findEarliestFixedWorldContact({
						segment,
						ballRadius: scenario.input.initialDynamicBodies[0]!.physicalShape.radius,
						colliders: scenario.input.scene.staticColliders,
						releasedContactColliderId:
							previous && previous.type !== 'free-flight' ? previous.supportingColliderId : null,
						searchUntilTime: certifiedUntil,
						tolerances: {
							...defaultFixedWorldContactTolerances,
							...scenario.input.settings.tolerances
						}
					});
					expect(search.type, `${scenario.id} segment ${index} contains an early contact`).toBe(
						'no-event'
					);
				}
			}

			expect(JSON.parse(JSON.stringify(scenario)), scenario.id).toEqual(scenario);
			expect(JSON.stringify(JSON.parse(JSON.stringify(run))), scenario.id).toBe(
				JSON.stringify(run)
			);
		}
	});

	it('records the exact peg counts for sparse, canonical and dense production inputs', () => {
		expect(scenario('no-pegs').pegCount).toBe(0);
		expect(scenario('isolated-peg').pegCount).toBe(1);
		expect(scenario('sparse').pegCount).toBe(6);
		expect(scenario('canonical').pegCount).toBe(60);
		expect(scenario('dense').pegCount).toBe(45);
	});

	it('detects the no-peg exit at the continuous ballistic crossing time', () => {
		const run = constructSingleBallRun(scenario('no-pegs').input);
		const expectedCrossingTime = Math.sqrt((2 * (3.5 - 0.1)) / 9.81);

		expect(run.outcome).toBe('exited');
		expect(run.terminalReason).toMatchObject({
			type: 'completion-region',
			regionId: 'no-pegs-exit',
			time: expectedCrossingTime
		});
		expect(run.terminalReason.time).toBeCloseTo(expectedCrossingTime, 12);
		expect(run.events).toHaveLength(0);
		expect(run.trajectories[0]!.segments).toHaveLength(1);
	});

	it('preserves mirrored motion and ignores serialised collider ordering', () => {
		const sparse = constructSingleBallRun(scenario('sparse').input);
		const mirrored = constructSingleBallRun(scenario('mirrored-sparse').input);
		const reversed = constructSingleBallRun(scenario('reversed-sparse').input);

		expect(mirrored.outcome).toBe(sparse.outcome);
		expect(mirrored.terminalReason.time).toBeCloseTo(sparse.terminalReason.time ?? 0, 10);
		expect(mirrored.events.map(({ time }) => time)).toEqual(sparse.events.map(({ time }) => time));
		expect(mirrored.events.map(({ position }) => position)).toEqual(
			sparse.events.map(({ position }) => [-position[0], position[1]])
		);
		expect(reversed.outcome).toBe(sparse.outcome);
		expect(reversed.terminalReason).toEqual(sparse.terminalReason);
		expect(reversed.events).toEqual(sparse.events);
	});

	it('distinguishes resting support from sustained ramp sliding', () => {
		const flat = constructSingleBallRun(scenario('flat-support').input);
		const noExit = constructSingleBallRun(scenario('no-reachable-exit-settled').input);
		const ramp = constructSingleBallRun(scenario('angled-ramp').input);

		expect(flat).toMatchObject({
			outcome: 'settled',
			terminalReason: {
				type: 'resting-contact',
				colliderId: 'flat-support',
				normal: expect.any(Array)
			}
		});
		expect(noExit.outcome).toBe('settled');
		if (flat.terminalReason.type === 'resting-contact') {
			expect(flat.terminalReason.normal[0]).toBeCloseTo(0, 12);
			expect(flat.terminalReason.normal[1]).toBeCloseTo(1, 12);
		}
		expect(ramp.outcome).not.toBe('settled');
		expect(ramp.trajectories[0]!.segments.some(({ type }) => type === 'linear-contact')).toBe(true);
	});

	it('keeps no-future-event and explicit limits distinct from completion', () => {
		expect(constructSingleBallRun(scenario('no-future-event').input).outcome).toBe(
			'no-future-event'
		);
		expect(constructSingleBallRun(scenario('explicit-time-limit').input).outcome).toBe(
			'time-limit'
		);
	});
});

function scenario(id: (typeof boardStateScenarios)[number]['id']) {
	return boardStateScenarios.find((candidate) => candidate.id === id)!;
}
