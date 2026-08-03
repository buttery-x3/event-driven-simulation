import { describe, expect, it } from 'vitest';
import reverseThroatJson from '../../../../../../fixtures/regressions/flame-47-unit-restitution-reverse-throat.json?raw';
import { assertRecordedInspectionEligible, toRendererPlaybackInput } from '$lib/rendering/playback';
import { parseSimulationInputFixture } from '../../../serialization/simulation-input';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { validateSimulationRun } from '../../../verification';
import { constructSingleBallRun } from '../construct';

const input = parseSimulationInputFixture(reverseThroatJson);
const throatColliderIds = ['throat-left', 'throat-right'];

describe('FLAME-47 direction-invariant contact classification', () => {
	it('passes the exact-fit throat in both directions without a tangent impulse', () => {
		const run = constructSingleBallRun(input);

		expect(run.terminalReason.type).not.toBe('zero-time-loop');
		const contacts = run.events.filter(({ type }) => type === 'contact');
		expect(contacts.length).toBeGreaterThan(0);
		expect(contacts.every(({ colliderId }) => colliderId === 'rebound-peg')).toBe(true);
		const rebound = run.events.find(
			(event) => event.type === 'contact' && event.colliderId === 'rebound-peg'
		);
		expect(rebound).toMatchObject({
			type: 'contact',
			colliderId: 'rebound-peg',
			preContactVelocity: [0, expect.any(Number)],
			postContactVelocity: [0, expect.any(Number)]
		});
		if (rebound?.type !== 'contact' || !rebound.preContactVelocity || !rebound.postContactVelocity)
			return;
		expect(rebound.preContactVelocity[1]).toBeLessThan(0);
		expect(rebound.postContactVelocity[1]).toBeCloseTo(-rebound.preContactVelocity[1], 12);
		expect(rebound.contacts?.every(({ impulse }) => impulse >= 0)).toBe(true);

		const throatCandidates = run.diagnostics.contactSearches
			.flatMap(({ candidates }) => candidates)
			.filter(({ colliderId }) => throatColliderIds.includes(colliderId));
		for (const colliderId of throatColliderIds) {
			const grazing = throatCandidates.filter(
				(candidate) =>
					candidate.colliderId === colliderId && candidate.classification === 'rejected-grazing'
			);
			expect(grazing.some(({ time }) => time < rebound.time)).toBe(true);
			expect(grazing.some(({ time }) => time > rebound.time)).toBe(true);
		}
		expect(
			run.events.some(
				(event) => event.type === 'contact' && throatColliderIds.includes(event.colliderId)
			)
		).toBe(false);
		expect(
			run.trajectories[0]!.segments.every(
				(segment) => Math.abs(segment.startVelocity[0]) <= input.settings.tolerances.eventTime
			)
		).toBe(true);
		expect(validateSimulationRun(input, run).failures).toEqual([]);

		const serialized = parseSimulationRunFixture(JSON.stringify(run));
		expect(serialized).toEqual(run);
		const playback = toRendererPlaybackInput(serialized);
		expect(() => assertRecordedInspectionEligible(playback)).not.toThrow();
		expect(playback.trajectories).toEqual(run.trajectories);
		expect(playback.events).toEqual(run.events);
	});
});
