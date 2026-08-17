import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../../contracts';
import type { FixedWorldContactCandidate } from '../../../../collision';
import { solveImpactManifold } from '..';

describe('fixed-world impact manifolds', () => {
	it('preserves symmetry and shares the coupled impulse', () => {
		const contacts = [
			candidate('left', [-0.5, Math.sqrt(0.75)]),
			candidate('right', [0.5, Math.sqrt(0.75)])
		];
		const result = solveImpactManifold(contacts, [0, -4], 0.6, 1e-9)!;

		expect(result.outgoingVelocity[0]).toBeCloseTo(0, 12);
		expect(result.outgoingVelocity[1]).toBeCloseTo(2.4, 12);
		expect(result.contacts[0]!.impulse).toBeCloseTo(result.contacts[1]!.impulse, 12);
		for (const contact of result.contacts) {
			expect(contact.impulse).toBeGreaterThanOrEqual(0);
			expect(contact.postImpactNormalVelocity).toBeGreaterThanOrEqual(-1e-9);
		}
	});

	it('removes a separating asymmetric contact instead of creating attraction', () => {
		const result = solveImpactManifold(
			[candidate('floor', [0, 1]), candidate('left-wall', [1, 0])],
			[1, -2],
			0.5,
			1e-9
		)!;

		expect(result.outgoingVelocity).toEqual([1, 1]);
		expect(result.contacts.find(({ colliderId }) => colliderId === 'left-wall')!.impulse).toBe(0);
	});
});

function candidate(
	id: string,
	normal: Vec2,
	feature: FixedWorldContactCandidate['feature'] = 'circle'
): FixedWorldContactCandidate {
	return {
		type: 'contact-candidate',
		bodyId: 'ball',
		colliderId: id,
		colliderKind: feature === 'circle' ? 'circle' : 'boundary',
		feature,
		time: 0,
		position: [0, 0],
		contactPoint: [0, 0],
		normal,
		normalVelocity: 0,
		response: 'impact'
	};
}
