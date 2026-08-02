import { describe, expect, it } from 'vitest';
import type { RunOutcome, RunTerminalReason } from '../../contracts';
import { getRunOutcome, isCompleteRunOutcome } from '../outcome';

describe('terminal outcome contract', () => {
	it('maps detailed terminal reasons to the eight public outcomes', () => {
		const cases = [
			[{ type: 'completion-region', regionId: 'exit', time: 1 }, 'exited'],
			[{ type: 'bounds-escape', boundary: 'right', time: 1 }, 'escaped'],
			[
				{
					type: 'resting-contact',
					colliderId: 'floor',
					time: 1,
					position: [0, 1],
					normal: [0, 1],
					reason: 'impact-collapse'
				},
				'settled'
			],
			[{ type: 'no-future-event', time: 1, detail: 'none' }, 'no-future-event'],
			[{ type: 'time-limit', time: 1, limit: 1 }, 'time-limit'],
			[{ type: 'event-limit', time: 1, limit: 1 }, 'event-limit'],
			[
				{ type: 'zero-time-loop', time: 1, colliderId: 'ramp', detail: 'unsupported' },
				'unresolved'
			],
			[{ type: 'invalid-state', time: null, detail: 'invalid' }, 'invalid']
		] as const satisfies readonly (readonly [RunTerminalReason, RunOutcome])[];

		for (const [reason, outcome] of cases) {
			expect(getRunOutcome(reason)).toBe(outcome);
		}
	});

	it('admits only exited and narrowly supported settled histories as complete', () => {
		const outcomes = [
			'exited',
			'escaped',
			'settled',
			'no-future-event',
			'time-limit',
			'event-limit',
			'unresolved',
			'invalid'
		] as const satisfies readonly RunOutcome[];

		expect(outcomes.filter(isCompleteRunOutcome)).toEqual(['exited', 'settled']);
	});
});
