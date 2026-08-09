import { describe, expect, it } from 'vitest';
import { certifyTemporalTail, unsupportedObservedRatioReason } from '..';
import type { AccumulationObservation } from '../types';

describe('accumulation temporal-tail certification', () => {
	it('does not promote an observed geometric prefix into an unproved future bound', () => {
		const result = certifyTemporalTail(observations([0, 1, 1.5, 1.75, 1.875]), 0.2);

		expect(result).toBe(unsupportedObservedRatioReason);
	});

	it('rejects shrinking intervals without a stable ratio bounded away from one', () => {
		const result = certifyTemporalTail(observations([0, 1, 1.99, 2.9701, 3.940399]), 100);

		expect(result).toBeTypeOf('string');
		expect(result).toContain('bounded away from one');
	});

	it('rejects same-time solver iterations as physical source intervals', () => {
		const result = certifyTemporalTail(observations([0, 1, 1, 1.5, 1.75]), 1);

		expect(result).toBeTypeOf('string');
		expect(result).toContain('strictly positive');
	});
});

function observations(times: readonly number[]): AccumulationObservation[] {
	return times.map((time, index) => ({
		id: `physical-${index}`,
		time,
		participantBodyIds: ['body'],
		candidateFixedColliderIds: ['floor'],
		bodyStates: [{ bodyId: 'body', mass: 1, radius: 1, position: [0, 1], velocity: [0, 0] }],
		contacts: [
			{ type: 'body-fixed', bodyId: 'body', colliderId: 'floor', feature: 'face', normal: [0, 1] }
		],
		maximumRelativeNormalSpeed: 1 / (index + 1),
		kind: 'physical-contact'
	}));
}
