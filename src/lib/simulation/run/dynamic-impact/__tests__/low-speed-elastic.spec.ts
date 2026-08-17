import { describe, expect, it } from 'vitest';
import {
	LOW_SPEED_ELASTIC_IMPACT,
	resolveAnchoredComponentElasticFallback,
	resolveSupportPreservingElasticResponse,
	type AnchoredElasticFallbackInput,
	type CoupledImpactContact,
	type LowSpeedElasticInput,
	type LowSpeedElasticResponse
} from '..';

describe('support-preserving low-speed elastic response', () => {
	it('preserves floor-normal support while allowing tangent impact motion', () => {
		const input = problem(
			[
				['incoming', 1, [0.04, 0]],
				['supported', 1, [0, 0]]
			],
			[
				bodyContact('impact', 'incoming', 'supported', [1, 0]),
				fixedContact('floor', 'supported', [0, 1])
			],
			['floor']
		);
		const response = solveSupport(input);

		expect(velocity(response, 'incoming')).toEqual([0, 0]);
		expect(velocity(response, 'supported')).toEqual([0.04, 0]);
		expect(contact(response, 'floor').postImpactNormalVelocity).toBe(0);
		expect(response.lockReactions).toEqual([]);
		certifyResponse(input, response);
	});

	it('keeps circular support-normal motion zero while retaining tangent motion', () => {
		const diagonal = Math.SQRT1_2;
		const input = problem(
			[
				['incoming', 1, [0.04 * diagonal, 0.04 * diagonal]],
				['supported', 1, [0, 0]]
			],
			[
				bodyContact('oblique-impact', 'incoming', 'supported', [diagonal, diagonal]),
				fixedContact('circle-support', 'supported', [1, 0])
			],
			['circle-support']
		);
		const response = solveSupport(input);
		const supported = velocity(response, 'supported');

		expect(supported[0]).toBe(0);
		expect(Math.abs(supported[1])).toBeGreaterThan(1e-6);
		expect(contact(response, 'circle-support').postImpactNormalVelocity).toBeCloseTo(0, 12);
		certifyResponse(input, response);
	});

	it('allows signed bilateral support reactions instead of reintroducing support release', () => {
		const input = problem(
			[
				['incoming', 1, [0, 0.04]],
				['supported', 1, [0, 0]]
			],
			[
				bodyContact('upward-impact', 'incoming', 'supported', [0, 1]),
				fixedContact('floor', 'supported', [0, 1])
			],
			['floor']
		);
		const response = solveSupport(input);

		expect(velocity(response, 'incoming')[1]).toBeCloseTo(-0.04, 12);
		expect(velocity(response, 'supported')).toEqual([0, 0]);
		expect(response.supportReactions.map(({ contactId }) => contactId)).toEqual(['floor']);
		expect(response.supportReactions[0]!.multiplier).toBeLessThan(0);
		expect(response.impactImpulses.every(({ impulse }) => impulse >= 0)).toBe(true);
		certifyResponse(input, response);
	});

	it('leaves only common nullspace motion under multiple support equalities', () => {
		const input = problem(
			[
				['incoming', 1, [0.04, 0]],
				['supported', 1, [0, 0]]
			],
			[
				bodyContact('impact', 'incoming', 'supported', [1, 0]),
				fixedContact('horizontal-support', 'supported', [1, 0]),
				fixedContact('vertical-support', 'supported', [0, 1])
			],
			['horizontal-support', 'vertical-support']
		);
		const response = solveSupport(input);

		expect(velocity(response, 'incoming')).toEqual([-0.04, 0]);
		expect(velocity(response, 'supported')).toEqual([0, 0]);
		certifyResponse(input, response);
	});

	it("propagates through an initially zero-normal Newton's-cradle contact in complete I", () => {
		const input = problem(
			[
				['left', 1, [0.04, 0]],
				['centre', 1, [0, 0]],
				['right', 1, [0, 0]]
			],
			[
				bodyContact('left-contact', 'left', 'centre', [1, 0]),
				bodyContact('right-contact', 'centre', 'right', [1, 0])
			],
			[]
		);
		const response = solveSupport(input);

		expect(velocity(response, 'left')).toEqual([0, 0]);
		expect(velocity(response, 'centre')).toEqual([0, 0]);
		expect(velocity(response, 'right')).toEqual([0.04, 0]);
		expect(contact(response, 'right-contact').preImpactNormalVelocity).toBe(0);
		expect(impulse(response, 'right-contact')).toBeGreaterThan(0);
		expect(response.certification.impactSpeed).toBeCloseTo(0.04, 12);
		certifyResponse(input, response);
	});

	it('rejects materially inconsistent authoritative support evidence instead of repairing it', () => {
		const input = problem(
			[
				['incoming', 1, [0.04, 0]],
				['supported', 1, [0, 1e-4]]
			],
			[
				bodyContact('impact', 'incoming', 'supported', [1, 0]),
				fixedContact('floor', 'supported', [0, 1])
			],
			['floor']
		);

		expect(resolveSupportPreservingElasticResponse(input)).toEqual({
			type: 'rejected',
			reason: expect.stringContaining('inconsistent with authoritative support')
		});
	});

	it('accepts only a near-identity cleanup of numerical support drift', () => {
		const input = problem(
			[
				['incoming', 1, [0.04, 0]],
				['supported', 1, [0, 1e-14]]
			],
			[
				bodyContact('impact', 'incoming', 'supported', [1, 0]),
				fixedContact('floor', 'supported', [0, 1])
			],
			['floor']
		);
		const response = solveSupport(input);

		expect(response.certification.incomingProjectionCorrectionNorm).toBeLessThan(1e-12);
		expect(contact(response, 'floor').postImpactNormalVelocity).toBe(0);
		certifyResponse(input, response);
	});

	it('rejects a non-support impact above the dedicated low-speed boundary', () => {
		const input = problem(
			[
				['incoming', 1, [LOW_SPEED_ELASTIC_IMPACT + 0.001, 0]],
				['target', 1, [0, 0]]
			],
			[bodyContact('impact', 'incoming', 'target', [1, 0])],
			[]
		);

		expect(resolveSupportPreservingElasticResponse(input)).toEqual({
			type: 'rejected',
			reason: expect.stringContaining('exceeds the low-speed elastic boundary')
		});
	});

	it('admits the inclusive boundary with mass-aware elastic response', () => {
		const input = problem(
			[
				['heavy', 2, [LOW_SPEED_ELASTIC_IMPACT, 0]],
				['light', 1, [0, 0]]
			],
			[bodyContact('impact', 'heavy', 'light', [1, 0])],
			[]
		);
		const response = solveSupport(input);

		expect(velocity(response, 'heavy')[0]).toBeCloseTo(LOW_SPEED_ELASTIC_IMPACT / 3, 12);
		expect(velocity(response, 'light')[0]).toBeCloseTo((4 * LOW_SPEED_ELASTIC_IMPACT) / 3, 12);
		expect(response.certification.impactSpeed).toBeCloseTo(LOW_SPEED_ELASTIC_IMPACT, 12);
		certifyResponse(input, response);
	});

	it('keeps the 0.05 impact boundary independent of the 0.01 represented-rest threshold', () => {
		const speedAboveRepresentedRest = 0.02;
		const input = problem(
			[
				['incoming', 1, [speedAboveRepresentedRest, 0]],
				['target', 1, [0, 0]]
			],
			[bodyContact('impact', 'incoming', 'target', [1, 0])],
			[]
		);
		const response = solveSupport(input);

		expect(LOW_SPEED_ELASTIC_IMPACT).toBe(0.05);
		expect(response.certification.impactSpeed).toBeCloseTo(speedAboveRepresentedRest, 12);
		expect(velocity(response, 'target')[0]).toBeCloseTo(speedAboveRepresentedRest, 12);
		certifyResponse(input, response);
	});

	it('is invariant to physical body, contact and support-ID ordering', () => {
		const input = problem(
			[
				['incoming', 1, [0.04, 0]],
				['supported', 1, [0, 0]],
				['right', 1, [0, 0]]
			],
			[
				bodyContact('incoming-contact', 'incoming', 'supported', [1, 0]),
				bodyContact('transmission-contact', 'supported', 'right', [1, 0]),
				fixedContact('vertical-support', 'supported', [0, 1])
			],
			['vertical-support']
		);
		const reversed: LowSpeedElasticInput = {
			...input,
			bodies: [...input.bodies].reverse(),
			contacts: [...input.contacts].reverse(),
			supportContactIds: [...input.supportContactIds].reverse()
		};
		const forward = solveSupport(input);
		const backward = solveSupport(reversed);

		for (const body of input.bodies) {
			expect(velocity(backward, body.id)[0]).toBeCloseTo(velocity(forward, body.id)[0], 12);
			expect(velocity(backward, body.id)[1]).toBeCloseTo(velocity(forward, body.id)[1], 12);
		}
		for (const contact of input.contacts.filter(
			({ id }) => !input.supportContactIds.includes(id)
		)) {
			expect(impulse(backward, contact.id)).toBeCloseTo(impulse(forward, contact.id), 12);
		}
		certifyResponse(input, forward);
		certifyResponse(reversed, backward);
	});

	it('fails closed when the shared terminating-reflection cap is insufficient', () => {
		const input = problem(
			[
				['left', 1, [0.04, 0]],
				['centre', 1, [0, 0]],
				['right', 1, [0, 0]]
			],
			[
				bodyContact('left-contact', 'left', 'centre', [1, 0]),
				bodyContact('right-contact', 'centre', 'right', [1, 0])
			],
			[]
		);

		expect(
			resolveSupportPreservingElasticResponse({
				...input,
				tolerances: { ...input.tolerances, maximumReflections: 1 }
			})
		).toEqual({
			type: 'rejected',
			reason: expect.stringContaining('defensive reflection cap reached')
		});
	});

	it('rejects non-support body-fixed impacts instead of activating from fixed geometry', () => {
		const input = problem(
			[
				['incoming', 1, [0.04, 0]],
				['target', 1, [0, 0]]
			],
			[
				bodyContact('body-impact', 'incoming', 'target', [1, 0]),
				fixedContact('ordinary-fixed-impact', 'target', [-1, 0])
			],
			[]
		);

		expect(resolveSupportPreservingElasticResponse(input)).toEqual({
			type: 'rejected',
			reason: expect.stringContaining('body-fixed impact remains authoritative')
		});
	});
});

describe('anchored resting-component elastic fallback', () => {
	it('is a distinct operation that locks every body of the declared resting component', () => {
		const base = problem(
			[
				['incoming', 1, [0.04, 0]],
				['lower', 1, [0, 0]],
				['upper', 1, [0, 0]]
			],
			[
				bodyContact('impact', 'incoming', 'lower', [1, 0]),
				bodyContact('component-contact', 'lower', 'upper', [0, 1]),
				fixedContact('floor', 'lower', [0, 1])
			],
			['component-contact', 'floor']
		);
		const supportPreserving = solveSupport(base);
		const fallbackInput: AnchoredElasticFallbackInput = {
			...base,
			anchoredComponents: [{ componentId: 'resting-component', bodyIds: ['lower', 'upper'] }]
		};
		const anchored = solveAnchored(fallbackInput);

		expect(velocity(supportPreserving, 'lower')[0]).toBeGreaterThan(0);
		expect(velocity(anchored, 'incoming')).toEqual([-0.04, 0]);
		expect(velocity(anchored, 'lower')).toEqual([0, 0]);
		expect(velocity(anchored, 'upper')).toEqual([0, 0]);
		expect(new Set(anchored.lockReactions.map(({ bodyId }) => bodyId))).toEqual(
			new Set(['lower', 'upper'])
		);
		expect(
			anchored.lockReactions.some(
				({ bodyId, axis, multiplier }) =>
					bodyId === 'lower' && axis === 'x' && Math.abs(multiplier) > 1e-6
			)
		).toBe(true);
		certifyResponse(fallbackInput, anchored);
	});

	it('rejects an anchored component whose pre-impact velocity is not already locked', () => {
		const input: AnchoredElasticFallbackInput = {
			...problem(
				[
					['incoming', 1, [0.04, 0]],
					['anchored', 1, [1e-4, 0]]
				],
				[
					bodyContact('impact', 'incoming', 'anchored', [1, 0]),
					fixedContact('floor', 'anchored', [0, 1])
				],
				['floor']
			),
			anchoredComponents: [{ componentId: 'resting', bodyIds: ['anchored'] }]
		};

		expect(resolveAnchoredComponentElasticFallback(input)).toEqual({
			type: 'rejected',
			reason: expect.stringContaining('inconsistent with authoritative support')
		});
	});
});

type BodyFixture = readonly [id: string, mass: number, velocity: readonly [number, number]];

function problem(
	bodies: readonly BodyFixture[],
	contacts: readonly CoupledImpactContact[],
	supportContactIds: readonly string[]
): LowSpeedElasticInput {
	return {
		bodies: bodies.map(([id, mass, velocity]) => ({ id, mass, velocity })),
		contacts,
		supportContactIds,
		tolerances: {
			numerical: 1e-12,
			absoluteNormalVelocityFloor: 1e-14,
			relativeViolationEpsilon: 1e-12,
			maximumReflections: 128
		}
	};
}

function bodyContact(
	id: string,
	firstBodyId: string,
	secondBodyId: string,
	normalFromFirstToSecond: readonly [number, number]
): CoupledImpactContact {
	return { id, type: 'body-body', firstBodyId, secondBodyId, normalFromFirstToSecond };
}

function fixedContact(
	id: string,
	bodyId: string,
	normal: readonly [number, number]
): CoupledImpactContact {
	return { id, type: 'body-fixed', bodyId, colliderId: id, normal };
}

function solveSupport(input: LowSpeedElasticInput): LowSpeedElasticResponse {
	const result = resolveSupportPreservingElasticResponse(input);
	expect(result.type, result.type === 'rejected' ? result.reason : undefined).toBe('response');
	if (result.type !== 'response') throw new Error(result.reason);
	return result.response;
}

function solveAnchored(input: AnchoredElasticFallbackInput): LowSpeedElasticResponse {
	const result = resolveAnchoredComponentElasticFallback(input);
	expect(result.type, result.type === 'rejected' ? result.reason : undefined).toBe('response');
	if (result.type !== 'response') throw new Error(result.reason);
	return result.response;
}

function velocity(response: LowSpeedElasticResponse, bodyId: string) {
	return response.bodyVelocities.find((body) => body.bodyId === bodyId)!.velocity;
}

function contact(response: LowSpeedElasticResponse, contactId: string) {
	return response.contacts.find((item) => item.contactId === contactId)!;
}

function impulse(response: LowSpeedElasticResponse, contactId: string): number {
	return response.impactImpulses.find((item) => item.contactId === contactId)!.impulse;
}

function certifyResponse(input: LowSpeedElasticInput, response: LowSpeedElasticResponse): void {
	const bodyIndex = new Map(input.bodies.map((body, index) => [body.id, index]));
	const size = input.bodies.length * 2;
	const reconstructed = Array.from({ length: size }, () => 0);
	for (const { contactId, impulse } of response.impactImpulses) {
		addScaled(reconstructed, gradient(input, contactId, bodyIndex), impulse);
	}
	for (const { contactId, multiplier } of response.supportReactions) {
		addScaled(reconstructed, gradient(input, contactId, bodyIndex), multiplier);
	}
	for (const { bodyId, axis, multiplier } of response.lockReactions) {
		reconstructed[bodyIndex.get(bodyId)! * 2 + (axis === 'x' ? 0 : 1)]! += multiplier;
	}
	const target = response.finalVelocity.map((value, index) => {
		const body = input.bodies[Math.floor(index / 2)]!;
		return body.mass * (value - response.preImpactVelocity[index]!);
	});
	const residual = Math.hypot(...target.map((value, index) => value - reconstructed[index]!));

	expect(residual).toBeLessThan(1e-9);
	expect(response.certification.momentumResidualNorm).toBeLessThan(1e-9);
	expect(response.certification.energyError).toBeLessThan(1e-9);
	expect(response.certification.maximumPostSupportViolation).toBeLessThan(1e-9);
	expect(response.certification.maximumPostImpactViolation).toBeLessThan(1e-9);
	expect(response.impactImpulses.every(({ impulse }) => impulse >= 0)).toBe(true);
}

function gradient(
	input: LowSpeedElasticInput,
	contactId: string,
	bodyIndex: ReadonlyMap<string, number>
): number[] {
	const result = Array.from({ length: input.bodies.length * 2 }, () => 0);
	const item = input.contacts.find(({ id }) => id === contactId)!;
	if (item.type === 'body-fixed') {
		const offset = bodyIndex.get(item.bodyId)! * 2;
		result[offset] = item.normal[0];
		result[offset + 1] = item.normal[1];
		return result;
	}
	const first = bodyIndex.get(item.firstBodyId)! * 2;
	const second = bodyIndex.get(item.secondBodyId)! * 2;
	result[first] = -item.normalFromFirstToSecond[0];
	result[first + 1] = -item.normalFromFirstToSecond[1];
	result[second] = item.normalFromFirstToSecond[0];
	result[second + 1] = item.normalFromFirstToSecond[1];
	return result;
}

function addScaled(target: number[], value: readonly number[], scale: number): void {
	for (let index = 0; index < target.length; index += 1) {
		target[index]! += value[index]! * scale;
	}
}
