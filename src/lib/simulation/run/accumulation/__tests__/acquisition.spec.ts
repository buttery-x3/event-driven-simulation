import { describe, expect, it } from 'vitest';
import type { SimulationInput, Vec2 } from '../../../contracts';
import { certifyAccumulationLimit } from '../acquisition';
import type { AccumulationObservation, AccumulationObservedContact } from '../types';

describe('generic accumulation acquisition', () => {
	it('certifies a connected multi-body cluster with non-alternating contact-edge changes', () => {
		const result = certifyAccumulationLimit(input(), observations());

		expect(result.type).toBe('certified');
		if (result.type !== 'certified') return;
		expect(result.limit.participantBodyIds).toEqual(['a', 'b', 'c']);
		expect(result.limit.sourceEventIds).toHaveLength(6);
		expect(result.limit.activeLimitContacts.map(contactKey).sort()).toEqual([
			'body:a:b',
			'body:b:c',
			'fixed:a:floor',
			'fixed:b:floor',
			'fixed:c:floor'
		]);
		expect(result.limit.connectedComponents).toHaveLength(1);
		expect(result.limit.remainingTimeUpperBound).toBeGreaterThan(0);
		expect(result.limit.candidateLimitTime).toBeGreaterThan(result.limit.currentCertifiedTime);
	});

	it('rejects a temporal candidate whose reconstructed limiting geometry penetrates', () => {
		const penetrating = observations().map((observation) => ({
			...observation,
			bodyStates: observation.bodyStates.map((body) =>
				body.bodyId === 'b' ? { ...body, position: [-0.2, 0.5] as Vec2 } : body
			)
		}));
		const result = certifyAccumulationLimit(input(), penetrating);

		expect(result.type).toBe('rejected');
		if (result.type !== 'rejected') return;
		expect(result.diagnostic.reason).toMatch(/penetrat|position-tail enclosure/);
	});

	it('re-queries away historical edges and decomposes disconnected limiting components', () => {
		const separated = observations().map((observation) => ({
			...observation,
			bodyStates: [state('a', [-2, 0.5]), state('b', [0, 0.5]), state('c', [2, 0.5])]
		}));
		const result = certifyAccumulationLimit(input(), separated);

		expect(result.type).toBe('certified');
		if (result.type !== 'certified') return;
		expect(result.limit.activeLimitContacts.every(({ type }) => type === 'body-fixed')).toBe(true);
		expect(result.limit.connectedComponents).toHaveLength(3);
		expect(
			result.limit.geometricResiduals.some(
				({ contactId, activeAtLimit }) => contactId.includes('body-contact') && !activeAtLimit
			)
		).toBe(true);
	});
});

function observations(): readonly AccumulationObservation[] {
	const times = [0, 0.5, 0.75, 0.875, 0.9375, 0.96875];
	const edges: readonly (readonly AccumulationObservedContact[])[] = [
		[fixed('a')],
		[pair('a', 'b')],
		[fixed('b')],
		[pair('b', 'c')],
		[fixed('c')],
		[fixed('a'), fixed('b'), fixed('c')]
	];
	const participants = [['a'], ['a', 'b'], ['b'], ['b', 'c'], ['c'], ['a', 'b', 'c']];
	return times.map((time, index) => ({
		id: `physical-component-contact:test-${index}`,
		time,
		participantBodyIds: participants[index]!,
		candidateFixedColliderIds: edges[index]!.flatMap((edge) =>
			edge.type === 'body-fixed' ? [edge.colliderId] : []
		),
		bodyStates: [state('a', [-1, 0.5]), state('b', [0, 0.5]), state('c', [1, 0.5])],
		contacts: edges[index]!,
		maximumRelativeNormalSpeed: 2 ** -index,
		kind: 'physical-contact' as const
	}));
}

function input(): SimulationInput {
	return {
		scene: {
			id: 'multi-body-accumulation-test',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 10, height: 5 },
			staticColliders: [
				{
					id: 'floor',
					motionAuthority: 'static',
					physicalShape: { type: 'line-segment', start: [-5, 0], end: [5, 0] }
				}
			],
			terminationRegions: []
		},
		initialDynamicBodies: ['a', 'b', 'c'].map((id, index) => ({
			id,
			motionAuthority: 'dynamic' as const,
			physicalShape: { type: 'circle' as const, radius: 0.5 },
			mass: 1,
			position: [index - 1, 0.5] as Vec2,
			velocity: [0, 0] as Vec2,
			releaseTime: 0
		})),
		settings: {
			gravity: [0, -9.81],
			restitution: 0.5,
			maximumEvents: 100,
			maximumSimulationTime: 5,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function state(bodyId: string, position: Vec2) {
	return { bodyId, mass: 1, radius: 0.5, position, velocity: [0, 0] as Vec2 };
}

function fixed(bodyId: string): AccumulationObservedContact {
	return {
		type: 'body-fixed',
		bodyId,
		colliderId: 'floor',
		feature: 'segment-face-positive',
		normal: [0, 1]
	};
}

function pair(firstBodyId: string, secondBodyId: string): AccumulationObservedContact {
	return {
		type: 'body-body',
		firstBodyId,
		secondBodyId,
		normalFromFirstToSecond: [1, 0]
	};
}

function contactKey(contact: {
	readonly type: string;
	readonly bodyId?: string;
	readonly colliderId?: string;
	readonly firstBodyId?: string;
	readonly secondBodyId?: string;
}): string {
	return contact.type === 'body-fixed'
		? `fixed:${contact.bodyId}:${contact.colliderId}`
		: `body:${contact.firstBodyId}:${contact.secondBodyId}`;
}
