import { describe, expect, it } from 'vitest';
import type { FixedWorldContactCandidate } from '../../../collision';
import type { Vec2 } from '../../../contracts';
import {
	certifySupportEquilibrium,
	classifyPostResponseContacts,
	selectPostContactMode,
	type ExactContact,
	type ExactTimeContactState
} from '..';

describe('post-contact resolution', () => {
	it('classifies contact roles relative to one completed response', () => {
		const state = exactState([fixedContact('floor', [0, 1]), fixedContact('wall', [1, 0])]);
		const resolved = classifyPostResponseContacts(
			state,
			[
				{
					contactId: 'floor',
					preResponseNormalVelocity: -2,
					postResponseNormalVelocity: 0,
					impulse: 2,
					retentionEligible: true,
					supportReaction: 10
				},
				{
					contactId: 'wall',
					preResponseNormalVelocity: 0,
					postResponseNormalVelocity: 1,
					impulse: 0
				}
			],
			1e-9
		)!;

		expect(resolved.contacts).toMatchObject([
			{ participation: 'impact', disposition: 'retained', supportReaction: 10 },
			{ participation: 'constraint', disposition: 'released', supportReaction: null }
		]);
	});

	it('keeps a supported constraint distinct from an incoming impact when it carries impulse', () => {
		const state = exactState([fixedContact('floor', [0, 1])]);
		const resolved = classifyPostResponseContacts(
			state,
			[
				{
					contactId: 'floor',
					preResponseNormalVelocity: 0,
					postResponseNormalVelocity: 0,
					impulse: 2
				}
			],
			1e-9
		)!;

		expect(resolved.contacts[0]).toMatchObject({
			participation: 'constraint',
			impulse: 2
		});
	});

	it('certifies mixed circle-line support with non-negative reactions', () => {
		const contacts = [
			fixedContact('circle', [-0.6, 0.8], 'circle'),
			fixedContact('line', [0.6, 0.8], 'segment-face-positive')
		];
		const state = exactState(contacts);
		const support = certifySupportEquilibrium(state.bodies, contacts, [0, -10], 1e-9)!;

		expect(support.reactions).toHaveLength(2);
		expect(support.reactions.every((reaction) => reaction > 0)).toBe(true);
	});

	it('selects the represented mode without constructing its lifecycle', () => {
		const state = exactState([fixedContact('floor', [0, 1])]);
		const contacts = classifyPostResponseContacts(
			state,
			[
				{
					contactId: 'floor',
					preResponseNormalVelocity: -1,
					postResponseNormalVelocity: 0,
					impulse: 1
				}
			],
			1e-9
		)!;

		expect(selectPostContactMode({ contacts, preferredFixedContactId: 'floor' })).toEqual({
			type: 'fixed-sustained-contact',
			contactId: 'floor'
		});
	});
});

function exactState(contacts: readonly ExactContact[]): ExactTimeContactState {
	return {
		id: 'state',
		time: 0,
		bodies: [
			{
				id: 'ball',
				mass: 1,
				radius: 1,
				position: [0, 0],
				velocity: [0, 0]
			}
		],
		contacts
	};
}

function fixedContact(
	id: string,
	normal: Vec2,
	feature: FixedWorldContactCandidate['feature'] = 'circle'
): ExactContact {
	const candidate: FixedWorldContactCandidate = {
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
	return {
		type: 'body-fixed',
		id,
		bodyId: 'ball',
		colliderId: id,
		normal,
		contactPoint: [0, 0],
		candidate
	};
}
