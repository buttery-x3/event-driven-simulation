import { describe, expect, it } from 'vitest';
import { isEquivalentEvent, zeroTimeLoopReason } from '../identity';
import { isFreezeAndContinue, isRecoverableFrontier } from '../policy';
import type { SelectedEventIdentity } from '../types';
import type { SimulationInput } from '../../../../contracts';

const identity = (overrides: Partial<SelectedEventIdentity> = {}): SelectedEventIdentity => ({
	time: 1,
	source: 'body-pair',
	bodyIds: ['a', 'b'],
	topology: 'contact:a:b',
	...overrides
});

describe('failure-continuation identity and policy', () => {
	it('treats omitted failureContinuation as strict', () => {
		expect(isFreezeAndContinue({ settings: {} } as SimulationInput)).toBe(false);
		expect(
			isFreezeAndContinue({
				settings: { failureContinuation: 'freeze-and-continue' }
			} as SimulationInput)
		).toBe(true);
	});

	it('classifies recoverable local frontiers without recovering corrupt state', () => {
		expect(
			isRecoverableFrontier({
				type: 'zero-time-loop',
				time: 1,
				colliderId: 'scheduler',
				detail: 'stagnant'
			})
		).toBe(true);
		expect(isRecoverableFrontier({ type: 'invalid-state', time: null, detail: 'bad' })).toBe(false);
		expect(
			isRecoverableFrontier({ type: 'numerical-failure', time: 1, detail: 'closed' }, true)
		).toBe(true);
		expect(
			isRecoverableFrontier({ type: 'numerical-failure', time: 1, detail: 'closed' }, false)
		).toBe(false);
	});

	it('detects equivalent same-time events and distinguishes distinct topology', () => {
		expect(isEquivalentEvent(identity(), identity())).toBe(true);
		expect(isEquivalentEvent(identity(), identity({ topology: 'other' }))).toBe(false);
		expect(isEquivalentEvent(identity(), identity({ bodyIds: ['a', 'c'] }))).toBe(false);
		expect(isEquivalentEvent(identity(), identity({ time: 2 }))).toBe(false);
		expect(isEquivalentEvent(null, identity())).toBe(false);
	});

	it('names first-recurrence termination without a retry budget', () => {
		expect(zeroTimeLoopReason(3, 'left')).toMatchObject({
			type: 'zero-time-loop',
			time: 3,
			colliderId: 'left'
		});
		const reason = zeroTimeLoopReason(3, 'left');
		expect(reason.type).toBe('zero-time-loop');
		if (reason.type === 'zero-time-loop') expect(reason.detail).not.toMatch(/256/);
	});
});
