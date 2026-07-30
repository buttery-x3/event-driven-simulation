import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from './snapshot';

describe('simulation snapshot', () => {
	it('is a renderer-independent serialisable contract', () => {
		const snapshot = createInitialSnapshot();
		const roundTrip = JSON.parse(JSON.stringify(snapshot));

		expect(roundTrip).toEqual(snapshot);
		expect(snapshot.bodies.some((body) => body.motion === 'dynamic')).toBe(true);
	});
});
