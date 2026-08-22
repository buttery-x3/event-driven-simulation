import { describe, expect, it } from 'vitest';
import type { FixedWorldContactCandidate } from '../../../collision';
import type { Vec2 } from '../../../contracts';
import {
	REPRESENTED_MOTION_SPEED,
	admissibleConstrainedVelocities,
	certifySupportEquilibrium,
	classifyPostResponseContacts,
	isSubResolutionNormalMotion,
	isSubResolutionPostNormalMotion,
	selectPostContactMode,
	type ExactContact,
	type ExactContactBodyState,
	type ExactTimeContactState
} from '..';

describe('post-contact resolution', () => {
	it('releases a zero post-response velocity contact when retentionEligible is false', () => {
		const state = exactState([fixedContact('peg', [0, 1])]);
		const resolved = classifyPostResponseContacts(
			state,
			[
				{
					contactId: 'peg',
					preResponseNormalVelocity: -5.66,
					postResponseNormalVelocity: 0,
					impulse: 1,
					retentionEligible: false
				}
			],
			1e-9
		)!;

		expect(resolved.contacts[0]).toMatchObject({
			participation: 'impact',
			disposition: 'released'
		});
	});

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

	it.each([
		{ speed: 0.009, expected: 'resting-anchored' },
		{ speed: 0.011, expected: 'free-flight' }
	])('admits represented rest by velocity magnitude at $speed m/s', ({ speed, expected }) => {
		const state = exactState([fixedContact('floor', [0, 1])]);
		const contacts = classifyPostResponseContacts(
			state,
			[
				{
					contactId: 'floor',
					preResponseNormalVelocity: -speed,
					postResponseNormalVelocity: speed,
					impulse: 0
				}
			],
			1e-9
		)!;

		const mode = selectPostContactMode({
			contacts,
			resting: {
				bodyIds: ['ball'],
				motion: { velocities: [[0, speed]], tolerance: 1e-9 },
				support: () => certifySupportEquilibrium(state.bodies, state.contacts, [0, -10], 1e-9)
			}
		});

		expect(REPRESENTED_MOTION_SPEED).toBe(0.01);
		expect(isSubResolutionNormalMotion(-0.005, 0.005)).toBe(true);
		expect(isSubResolutionNormalMotion(-0.02, 0.02)).toBe(false);
		expect(isSubResolutionPostNormalMotion(0.005)).toBe(true);
		expect(isSubResolutionPostNormalMotion(0.011)).toBe(false);
		expect(isSubResolutionNormalMotion(-0.5, 0.005)).toBe(false);
		expect(mode.type).toBe(expected);
		if (mode.type === 'resting-anchored') expect(mode.support.contacts).toEqual(state.contacts);
	});

	it('projects blocked normal motion out of admissible residual velocity', () => {
		const bodies = [body('ball', [0, 0])];
		const floor = [fixedContact('floor', [0, 1])];
		const corner = [...floor, fixedContact('wall', [1, 0])];
		const locked = new Set<string>();

		expect(admissibleConstrainedVelocities(bodies, floor, [[0.4, -0.8]], locked, 1e-9)[0]).toEqual([
			expect.closeTo(0.4),
			expect.closeTo(0)
		]);
		expect(admissibleConstrainedVelocities(bodies, floor, [[0.4, 0]], locked, 1e-9)[0]).toEqual([
			0.4, 0
		]);
		expect(
			admissibleConstrainedVelocities(bodies, corner, [[-0.5, -0.5]], locked, 1e-9)[0]
		).toEqual([expect.closeTo(0), expect.closeTo(0)]);
	});

	it('keeps tangential motion around a locked support admissible', () => {
		const bodies = [body('support', [0, 1]), body('slider', [2, 1])];
		const contacts = [
			fixedContact('floor', [0, 1], 'segment-face-positive', 'support'),
			bodyContact('support', 'slider', [1, 0])
		];
		const residual = admissibleConstrainedVelocities(
			bodies,
			contacts,
			[
				[0.2, 0],
				[0, 0.8]
			],
			new Set(['support']),
			1e-9
		);

		expect(residual[0]).toEqual([0, 0]);
		expect(residual[1]).toEqual([expect.closeTo(0), expect.closeTo(0.8)]);
	});

	it('selects represented rest for a supportable corner with large blocked raw speed', () => {
		const contacts = [fixedContact('floor', [0, 1]), fixedContact('wall', [1, 0])];
		const state = exactState(contacts);
		const resolved = retainedState(state);
		const mode = selectPostContactMode({
			contacts: resolved,
			resting: {
				bodyIds: ['ball'],
				motion: { velocities: [[-0.5, -0.5]], tolerance: 1e-9 },
				support: () => certifySupportEquilibrium(state.bodies, state.contacts, [0, -10], 1e-9)
			},
			preferredFixedContactId: 'floor'
		});

		expect(Math.hypot(0.5, 0.5)).toBeGreaterThan(REPRESENTED_MOTION_SPEED);
		expect(mode.type).toBe('resting-anchored');
	});

	it('preserves a floor slider whose tangential residual exceeds represented rest', () => {
		const state = exactState([fixedContact('floor', [0, 1])]);
		const resolved = retainedState(state);

		expect(
			selectPostContactMode({
				contacts: resolved,
				resting: {
					bodyIds: ['ball'],
					motion: { velocities: [[0.5, -0.4]], tolerance: 1e-9 },
					support: () => certifySupportEquilibrium(state.bodies, state.contacts, [0, -10], 1e-9)
				},
				preferredFixedContactId: 'floor'
			})
		).toEqual({ type: 'fixed-sustained-contact', contactId: 'floor' });
	});

	it('preserves dynamic sustained support when tangential motion around an anchor remains', () => {
		const support = body('support', [0, 1]);
		const slider = body('slider', [2, 1]);
		const contacts = [
			fixedContact('floor', [0, 1], 'segment-face-positive', 'support'),
			bodyContact('support', 'slider', [1, 0])
		];
		const state: ExactTimeContactState = {
			id: 'state',
			time: 0,
			bodies: [support, slider],
			contacts
		};
		const resolved = retainedState(state);

		expect(
			selectPostContactMode({
				contacts: resolved,
				resting: {
					bodyIds: ['support', 'slider'],
					lockedBodyIds: ['support'],
					motion: {
						velocities: [
							[0, 0],
							[0, 0.8]
						],
						tolerance: 1e-9
					},
					support: () => certifySupportEquilibrium(state.bodies, state.contacts, [0, -10], 1e-9)
				},
				dynamicSupport: {
					contactId: 'support:slider',
					movingBodyId: 'slider',
					supportBodyId: 'support'
				}
			})
		).toEqual({
			type: 'dynamic-sustained-support',
			contactId: 'support:slider',
			movingBodyId: 'slider',
			supportBodyId: 'support'
		});
	});

	it('does not freeze a blocked residual when zero-motion support certification fails', () => {
		const state = exactState([fixedContact('ceiling', [0, -1], 'segment-face-negative')]);
		const resolved = retainedState(state);

		expect(
			selectPostContactMode({
				contacts: resolved,
				resting: {
					bodyIds: ['ball'],
					motion: { velocities: [[0, 0.5]], tolerance: 1e-9 },
					support: () => certifySupportEquilibrium(state.bodies, state.contacts, [0, -10], 1e-9)
				},
				preferredFixedContactId: 'ceiling'
			})
		).toEqual({ type: 'fixed-sustained-contact', contactId: 'ceiling' });
	});

	it('preserves the ordinary moving mode when low-motion support certification fails', () => {
		const state = exactState([fixedContact('ceiling', [0, -1], 'segment-face-negative')]);
		const contacts = classifyPostResponseContacts(
			state,
			[
				{
					contactId: 'ceiling',
					preResponseNormalVelocity: 0,
					postResponseNormalVelocity: 0,
					impulse: 0,
					retentionEligible: true
				}
			],
			1e-9
		)!;

		expect(
			selectPostContactMode({
				contacts,
				resting: {
					bodyIds: ['ball'],
					motion: { velocities: [[0.009, 0]], tolerance: 1e-9 },
					support: () => certifySupportEquilibrium(state.bodies, state.contacts, [0, -10], 1e-9)
				},
				preferredFixedContactId: 'ceiling'
			})
		).toEqual({ type: 'fixed-sustained-contact', contactId: 'ceiling' });
	});
});

function exactState(contacts: readonly ExactContact[]): ExactTimeContactState {
	return {
		id: 'state',
		time: 0,
		bodies: [body('ball', [0, 0])],
		contacts
	};
}

function retainedState(state: ExactTimeContactState) {
	return classifyPostResponseContacts(
		state,
		state.contacts.map((contact) => ({
			contactId: contact.id,
			preResponseNormalVelocity: 0,
			postResponseNormalVelocity: 0,
			impulse: 0,
			retentionEligible: true
		})),
		1e-9
	)!;
}

function body(id: string, position: Vec2): ExactContactBodyState {
	return { id, mass: 1, radius: 1, position, velocity: [0, 0] };
}

function bodyContact(firstBodyId: string, secondBodyId: string, normal: Vec2): ExactContact {
	return {
		type: 'body-body',
		id: `${firstBodyId}:${secondBodyId}`,
		firstBodyId,
		secondBodyId,
		normalFromFirstToSecond: normal,
		contactPoint: [1, 1]
	};
}

function fixedContact(
	id: string,
	normal: Vec2,
	feature: FixedWorldContactCandidate['feature'] = 'circle',
	bodyId = 'ball'
): ExactContact {
	const candidate: FixedWorldContactCandidate = {
		type: 'contact-candidate',
		bodyId,
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
		bodyId,
		colliderId: id,
		normal,
		contactPoint: [0, 0],
		candidate
	};
}
