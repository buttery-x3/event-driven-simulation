import { describe, expect, it } from 'vitest';
import { resolveCoupledImpact, type CoupledImpactInput } from '..';

describe('coupled Generalised Reflections impact response', () => {
	it('reduces to the isolated two-body energetic restitution formula', () => {
		const response = solve(
			input(
				[
					['left', 1, [2, 0]],
					['right', 1, [0, 0]]
				],
				[bodyContact('pair', 'left', 'right', [1, 0])],
				0.5
			)
		);
		expect(velocities(response)).toEqual({ left: [0.5, 0], right: [1.5, 0] });
		expect(response.inelasticVelocity).toEqual([1, 0, 1, 0]);
		expect(response.elasticVelocity).toEqual([0, 0, 2, 0]);
	});

	it('preserves symmetric three-body impact symmetry', () => {
		const response = solve(
			input(
				[
					['left', 1, [3, 0]],
					['centre', 1, [0, 0]],
					['right', 1, [-3, 0]]
				],
				[
					bodyContact('left-contact', 'left', 'centre', [1, 0]),
					bodyContact('right-contact', 'centre', 'right', [1, 0])
				],
				0.25
			)
		);
		const result = velocities(response);
		expect(result.left[0]).toBeCloseTo(-0.75, 12);
		expect(result.centre[0]).toBeCloseTo(0, 12);
		expect(result.right[0]).toBeCloseTo(0.75, 12);
		expect(response.diagnostic.reflections).toHaveLength(1);
	});

	it("propagates a Newton's cradle shock without pinning the break-away contact", () => {
		const response = solve(
			input(
				[
					['left', 1, [3, 0]],
					['centre', 1, [0, 0]],
					['right', 1, [0, 0]]
				],
				[
					bodyContact('left-contact', 'left', 'centre', [1, 0]),
					bodyContact('right-contact', 'centre', 'right', [1, 0])
				],
				0.5
			)
		);
		expect(velocities(response)).toEqual({ left: [0.5, 0], centre: [0.5, 0], right: [2, 0] });
		expect(response.inelasticVelocity).toEqual([1, 0, 1, 0, 1, 0]);
		expect(response.elasticVelocity).toEqual([0, 0, 0, 0, 3, 0]);
		expect(response.diagnostic.reflections.map(({ violatingContactIds }) => violatingContactIds)).toEqual([
			['left-contact'],
			['right-contact']
		]);
	});

	it('couples a falling body to a supported body and fixed floor', () => {
		const response = solve(
			input(
				[
					['upper', 1, [0, -2]],
					['lower', 1, [0, 0]]
				],
				[
					bodyContact('body', 'upper', 'lower', [0, -1]),
					fixedContact('floor', 'lower', [0, 1])
				],
				0.5
			)
		);
		expect(velocities(response)).toEqual({ upper: [0, 1], lower: [0, 0] });
		expect(response.inelasticVelocity).toEqual([0, 0, 0, 0]);
		expect(response.elasticVelocity).toEqual([0, 2, 0, 0]);
	});

	it('projects opposing contacts without destroying common tangent motion', () => {
		const response = solve(
			input(
				[['body', 2, [1e-6, -4]]],
				[
					fixedContact('left', 'body', [1, 0]),
					fixedContact('right', 'body', [-1, 0])
				],
				1
			)
		);
		expect(velocities(response).body[0]).toBe(0);
		expect(velocities(response).body[1]).toBe(-4);
		expect(response.diagnostic.linealityDimension).toBe(1);
		expect(response.diagnostic.removedContactIds).toEqual(['left', 'right']);
		expect(response.diagnostic.reflections).toHaveLength(0);
	});

	it('is invariant to body and contact ordering', () => {
		const bodies = [
			['a', 1, [2, 0]],
			['b', 1, [0, 0]],
			['c', 1, [0, 0]]
		] as const;
		const contacts = [
			bodyContact('ab', 'a', 'b', [1, 0]),
			bodyContact('bc', 'b', 'c', [1, 0])
		];
		const forward = velocities(solve(input(bodies, contacts, 1)));
		const reversed = velocities(solve(input([...bodies].reverse(), [...contacts].reverse(), 1)));
		expect(reversed).toEqual(forward);
	});

	it('uses scale-aware violation thresholds without machine-scale loops', () => {
		for (const speed of [1e-9, 1, 1e9]) {
			const response = solve(
				input(
					[
						['a', 1, [speed, 0]],
						['b', 1, [0, 0]]
					],
					[bodyContact('ab', 'a', 'b', [1, 0])],
					1
				)
			);
			expect(response.diagnostic.reflections.length).toBeLessThanOrEqual(1);
			expect(velocities(response).a[0] / speed).toBeCloseTo(0, 8);
			expect(velocities(response).b[0] / speed).toBeCloseTo(1, 8);
		}
	});

	it('fails closed when the defensive reflection cap prevents certification', () => {
		const configured = input(
			[
				['a', 1, [1, 0]],
				['b', 1, [0, 0]],
				['c', 1, [0, 0]]
			],
			[bodyContact('ab', 'a', 'b', [1, 0]), bodyContact('bc', 'b', 'c', [1, 0])],
			1
		);
		const result = resolveCoupledImpact({
			...configured,
			tolerances: { ...configured.tolerances, maximumReflections: 1 }
		});
		expect(result.type).toBe('rejected');
		if (result.type === 'rejected') {
			expect(result.reason).toContain('impact-termination-certification-failed');
			expect(result.diagnostic?.completion).toBe('impact-termination-certification-failed');
		}
	});
});

type BodyFixture = readonly [id: string, mass: number, velocity: readonly [number, number]];

function input(
	bodies: readonly BodyFixture[],
	contacts: CoupledImpactInput['contacts'],
	restitution: number
): CoupledImpactInput {
	return {
		bodies: bodies.map(([id, mass, velocity]) => ({ id, mass, velocity })),
		contacts,
		restitution,
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
): CoupledImpactInput['contacts'][number] {
	return { id, type: 'body-body', firstBodyId, secondBodyId, normalFromFirstToSecond };
}

function fixedContact(
	id: string,
	bodyId: string,
	normal: readonly [number, number]
): CoupledImpactInput['contacts'][number] {
	return { id, type: 'body-fixed', bodyId, colliderId: id, normal };
}

function solve(input: CoupledImpactInput) {
	const result = resolveCoupledImpact(input);
	expect(result.type, result.type === 'rejected' ? result.reason : undefined).toBe('response');
	if (result.type !== 'response') throw new Error(result.reason);
	return result.response;
}

function velocities(response: ReturnType<typeof solve>) {
	return Object.fromEntries(response.bodyVelocities.map(({ bodyId, velocity }) => [bodyId, velocity]));
}
