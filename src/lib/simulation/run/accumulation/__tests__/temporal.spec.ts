import { describe, expect, it } from 'vitest';
import { certifyTemporalTail, isAccumulationSequenceCandidate } from '../temporal';
import type { AccumulationPhysicalEvent } from '../types';

describe('accumulation temporal certification', () => {
	it('certifies a geometrically contracting positive interval tail', () => {
		const events = contractingEvents([0, 0.1, 0.16, 0.196, 0.2176, 0.23056]);
		const result = certifyTemporalTail({ events, eventTimeTolerance: 1e-9 });
		expect(result.type).toBe('certified');
		if (result.type !== 'certified') return;
		expect(result.certificate.remainingTimeUpperBound).toBeGreaterThan(0);
		expect(Number.isFinite(result.certificate.remainingTimeUpperBound)).toBe(true);
		expect(result.certificate.method).toBe('geometric-interval-contraction');
	});

	it('rejects non-positive intervals and non-contracting tails', () => {
		expect(
			certifyTemporalTail({
				events: contractingEvents([0, 0.1, 0.1, 0.2, 0.3]),
				eventTimeTolerance: 1e-9
			}).type
		).toBe('rejected');
		expect(
			certifyTemporalTail({
				events: contractingEvents([0, 0.01, 0.03, 0.06, 0.1]),
				eventTimeTolerance: 1e-9
			}).type
		).toBe('rejected');
	});

	it('does not treat low event counts alone as certification', () => {
		const events = contractingEvents([0, 0.1, 0.15]);
		expect(certifyTemporalTail({ events, eventTimeTolerance: 1e-9 }).type).toBe('rejected');
		expect(
			isAccumulationSequenceCandidate(
				{
					settings: { tolerances: { eventTime: 1e-9, contactDistance: 1e-9 } }
				} as never,
				events
			)
		).toBe(false);
	});
});

function contractingEvents(times: readonly number[]): AccumulationPhysicalEvent[] {
	return times.map((time, index) => ({
		eventId: `e${index}`,
		time,
		participantBodyIds: ['ball'],
		fixedColliderIds: index % 2 === 0 ? ['left'] : ['right'],
		dynamicPartnerBodyIds: [],
		contactEdgeKeys: [index % 2 === 0 ? 'left:circle' : 'right:circle'],
		bodyStates: [
			{
				bodyId: 'ball',
				mass: 1,
				radius: 0.1,
				position: [0, 0],
				velocity: [0, -1]
			}
		],
		maxRelativeNormalSpeed: 1 / (index + 1)
	}));
}
