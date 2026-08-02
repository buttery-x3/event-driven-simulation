import { describe, expect, it } from 'vitest';
import forensicRunJson from '../../../../../../fixtures/regressions/flame-42-post-detachment-zero-time-loop.json?raw';
import { evaluateMotionSegmentPosition } from '../../../motion';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { constructSingleBallRun } from '../construct';

const releasedCircleId = 'peg-row-03-column-05';

describe('FLAME-42 post-detachment circle contact regression', () => {
	it('preserves the failure and continues the authoritative rerun from certified release', () => {
		const forensicRun = parseSimulationRunFixture(forensicRunJson);
		expect(forensicRun).toMatchObject({
			validity: 'valid',
			outcome: 'unresolved',
			terminalReason: { type: 'zero-time-loop', colliderId: releasedCircleId }
		});

		const corrected = constructSingleBallRun(forensicRun.input);
		expect(corrected.terminalReason.type).not.toBe('zero-time-loop');
		expect(corrected.events).toContainEqual(
			expect.objectContaining({
				type: 'contact-mode-transition',
				colliderId: releasedCircleId,
				from: 'sliding',
				to: 'free-flight',
				reason: 'support-lost'
			})
		);

		const release = corrected.events.find(
			(event) =>
				event.type === 'contact-mode-transition' &&
				event.colliderId === releasedCircleId &&
				event.reason === 'support-lost'
		)!;
		const microscopicRootTime = forensicRun.events.find(
			(event) =>
				event.type === 'contact' &&
				event.colliderId === releasedCircleId &&
				event.time > release.time
		)!.time;
		expect(
			corrected.events.some(
				(event) =>
					event.type === 'contact' &&
					event.colliderId === releasedCircleId &&
					event.time > release.time &&
					event.time <= microscopicRootTime
			)
		).toBe(false);
		const releaseSearch = corrected.diagnostics.contactSearches.find(
			(search) => search.searchInterval[0] === release.time
		)!;
		expect(releaseSearch.selectedColliderId).not.toBe(releasedCircleId);
		expect(releaseSearch.candidates).toContainEqual(
			expect.objectContaining({
				colliderId: releasedCircleId,
				classification: 'rejected-release-owned'
			})
		);

		const laterSameCircleContacts = corrected.events.filter(
			(event) =>
				event.type === 'contact' &&
				event.colliderId === releasedCircleId &&
				event.time > release.time
		);
		for (const contact of laterSameCircleContacts) {
			const search = corrected.diagnostics.contactSearches.find(
				(candidate) =>
					candidate.selectedColliderId === releasedCircleId &&
					candidate.candidates.some((entry) => entry.time === contact.time)
			)!;
			expect(search.candidates).toContainEqual(
				expect.objectContaining({
					colliderId: releasedCircleId,
					time: contact.time,
					classification: expect.stringMatching(/^accepted-/)
				})
			);
		}

		const segments = corrected.trajectories[0]!.segments;
		for (let index = 0; index < segments.length - 1; index += 1) {
			const current = segments[index]!;
			const next = segments[index + 1]!;
			expect(current.endTime).toBe(next.startTime);
			expect(evaluateMotionSegmentPosition(current, current.endTime)[0]).toBeCloseTo(
				next.startPosition[0],
				10
			);
			expect(evaluateMotionSegmentPosition(current, current.endTime)[1]).toBeCloseTo(
				next.startPosition[1],
				10
			);
		}
		expect(corrected.events.map(({ time }) => time)).toEqual(
			[...corrected.events].map(({ time }) => time).sort((left, right) => left - right)
		);
		expect(parseSimulationRunFixture(JSON.stringify(corrected))).toEqual(corrected);
	});
});
