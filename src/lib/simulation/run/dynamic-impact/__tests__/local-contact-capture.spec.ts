import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../contracts';
import { resolveCoupledImpact, type CoupledImpactInput, type CoupledImpactResponse } from '..';
import { dot, gramMatrix } from '../linear-algebra';
import { solveNonnegativeQuadratic } from '../nonnegative-qp';

const gravity: Vec2 = [0, -9.81];
const contactDistance = 1e-6;
const numericalTolerance = 1e-12;

describe('FLAME-87 finite local contact-capture proof', () => {
	it('captures a negligible incline rebound without discarding tangential motion', () => {
		const angle = Math.PI / 6;
		const tangent: Vec2 = [Math.cos(angle), Math.sin(angle)];
		const normal: Vec2 = [-Math.sin(angle), Math.cos(angle)];
		const incoming = add(scale(tangent, 12), scale(normal, -1e-3));
		const proof = evaluateCapture(
			impact([['ball', 2, incoming]], [fixedContact('incline', 'ball', normal)], 0.8)
		);

		expect(proof.selectedEndpoint).toBe('inelastic');
		expect(proof.retainedContactIds).toEqual(['incline']);
		expect(proof.maximumNormalExcursion).toBeLessThan(contactDistance);
		expect(normalVelocity(proof.input, proof.selectedVelocity, 0)).toBeCloseTo(0, 12);
		expect(dot(bodyVelocity(proof.input, proof.selectedVelocity, 'ball'), tangent)).toBeCloseTo(
			12,
			12
		);
	});

	it('leaves a clearly energetic fixed-world impact on ordinary restitution', () => {
		const normal: Vec2 = [0, 1];
		const proof = evaluateCapture(
			impact([['ball', 1, [3, -2]]], [fixedContact('floor', 'ball', normal)], 0.8)
		);

		expect(proof.selectedEndpoint).toBe('ordinary');
		expect(proof.maximumNormalExcursion).toBeGreaterThan(contactDistance);
		expect(bodyVelocity(proof.input, proof.selectedVelocity, 'ball')).toEqual([3, 1.6]);
	});

	it('captures a low-energy supported three-body exact-time component', () => {
		const proof = evaluateCapture(
			impact(
				[
					['lower', 1, [0, -1e-3]],
					['middle', 1, [0, -1e-3]],
					['upper', 1, [0, -1e-3]]
				],
				[
					fixedContact('floor', 'lower', [0, 1]),
					bodyContact('lower-middle', 'lower', 'middle', [0, 1]),
					bodyContact('middle-upper', 'middle', 'upper', [0, 1])
				],
				0.8
			)
		);

		expect(proof.selectedEndpoint).toBe('inelastic');
		expect(proof.retainedContactIds).toEqual(['floor', 'lower-middle', 'middle-upper']);
		expect(proof.supportReactions.every((reaction) => reaction > 0)).toBe(true);
		expect(proof.maximumNormalExcursion).toBeLessThan(contactDistance);
		for (let index = 0; index < proof.input.contacts.length; index += 1) {
			expect(normalVelocity(proof.input, proof.selectedVelocity, index)).toBeCloseTo(0, 12);
		}
	});

	it('releases a low-energy component that has no unilateral support load', () => {
		const proof = evaluateCapture(
			impact(
				[
					['lower', 1, [0, 0]],
					['upper', 1, [0, -1e-3]]
				],
				[bodyContact('unsupported-pair', 'lower', 'upper', [0, 1])],
				0.8
			)
		);

		expect(proof.selectedEndpoint).toBe('ordinary');
		expect(proof.retainedContactIds).toEqual([]);
		expect(proof.supportReactions).toEqual([0]);
		expect(proof.maximumNormalExcursion).toBe(Infinity);
		expect(normalVelocity(proof.input, proof.selectedVelocity, 0)).toBeGreaterThan(0);
	});
});

type BodyFixture = readonly [id: string, mass: number, velocity: Vec2];

interface CaptureProof {
	readonly input: CoupledImpactInput;
	readonly ordinary: CoupledImpactResponse;
	readonly selectedEndpoint: 'ordinary' | 'inelastic';
	readonly selectedVelocity: readonly number[];
	readonly retainedContactIds: readonly string[];
	readonly supportReactions: readonly number[];
	readonly maximumNormalExcursion: number;
}

function evaluateCapture(input: CoupledImpactInput): CaptureProof {
	const result = resolveCoupledImpact(input);
	expect(result.type, result.type === 'rejected' ? result.reason : undefined).toBe('response');
	if (result.type !== 'response') throw new Error(result.reason);

	const gradients = contactGradients(input);
	const inverseMasses = input.bodies.flatMap(({ mass }) => [1 / mass, 1 / mass]);
	const delassus = gramMatrix(gradients, inverseMasses);
	const freeAcceleration = input.bodies.flatMap(() => gravity);
	const freeNormalAcceleration = gradients.map((gradient) => dot(gradient, freeAcceleration));
	const supported = constrainedAcceleration(
		input,
		gradients,
		delassus,
		freeNormalAcceleration,
		input.contacts.map((_, index) => index)
	);
	const forceScale = Math.max(1, ...supported.reactions.map(Math.abs));
	const materialReaction = numericalTolerance * forceScale * 64;
	const retainedIndices = supported.reactions
		.map((reaction, index) => ({ index, reaction }))
		.filter(({ reaction }) => reaction > materialReaction)
		.map(({ index }) => index);
	const excursions = input.contacts.map((_, index) => {
		if (!retainedIndices.includes(index)) return Infinity;
		const outgoingSpeed = Math.max(0, normalVelocity(input, result.response.finalVelocity, index));
		if (outgoingSpeed <= numericalTolerance) return 0;
		const released = constrainedAcceleration(
			input,
			gradients,
			delassus,
			freeNormalAcceleration,
			input.contacts.map((__, candidate) => candidate).filter((candidate) => candidate !== index)
		);
		const pressingAcceleration = -released.normalAccelerations[index]!;
		return pressingAcceleration > numericalTolerance
			? (outgoingSpeed * outgoingSpeed) / (2 * pressingAcceleration)
			: Infinity;
	});
	const maximumNormalExcursion = Math.max(...excursions);
	const inelasticIsCompatible = retainedIndices.every(
		(index) =>
			Math.abs(normalVelocity(input, result.response.inelasticVelocity, index)) <=
			numericalTolerance * 64
	);
	const capture =
		retainedIndices.length === input.contacts.length &&
		inelasticIsCompatible &&
		maximumNormalExcursion <= contactDistance;

	return {
		input,
		ordinary: result.response,
		selectedEndpoint: capture ? 'inelastic' : 'ordinary',
		selectedVelocity: capture ? result.response.inelasticVelocity : result.response.finalVelocity,
		retainedContactIds: capture ? retainedIndices.map((index) => input.contacts[index]!.id) : [],
		supportReactions: supported.reactions,
		maximumNormalExcursion
	};
}

function constrainedAcceleration(
	input: CoupledImpactInput,
	gradients: readonly (readonly number[])[],
	delassus: readonly (readonly number[])[],
	freeNormalAcceleration: readonly number[],
	activeIndices: readonly number[]
): { readonly reactions: readonly number[]; readonly normalAccelerations: readonly number[] } {
	const solution = solveNonnegativeQuadratic(
		activeIndices.map((row) => activeIndices.map((column) => delassus[row]![column]!)),
		activeIndices.map((index) => freeNormalAcceleration[index]!),
		numericalTolerance
	);
	if (!solution) throw new Error('The local unilateral acceleration problem was not certified.');
	const reactions = input.contacts.map(() => 0);
	for (let index = 0; index < activeIndices.length; index += 1) {
		reactions[activeIndices[index]!] = solution.values[index]!;
	}
	const inverseMasses = input.bodies.flatMap(({ mass }) => [1 / mass, 1 / mass]);
	const acceleration = input.bodies.flatMap(() => gravity);
	for (let contact = 0; contact < gradients.length; contact += 1) {
		for (let coordinate = 0; coordinate < acceleration.length; coordinate += 1) {
			acceleration[coordinate] +=
				gradients[contact]![coordinate]! * reactions[contact]! * inverseMasses[coordinate]!;
		}
	}
	return {
		reactions,
		normalAccelerations: gradients.map((gradient) => dot(gradient, acceleration))
	};
}

function contactGradients(input: CoupledImpactInput): number[][] {
	const bodyIndex = new Map(input.bodies.map((body, index) => [body.id, index]));
	return input.contacts.map((contact) => {
		const gradient = input.bodies.flatMap(() => [0, 0]);
		if (contact.type === 'body-fixed') {
			const offset = bodyIndex.get(contact.bodyId)! * 2;
			gradient[offset] = contact.normal[0];
			gradient[offset + 1] = contact.normal[1];
		} else {
			const first = bodyIndex.get(contact.firstBodyId)! * 2;
			const second = bodyIndex.get(contact.secondBodyId)! * 2;
			gradient[first] = -contact.normalFromFirstToSecond[0];
			gradient[first + 1] = -contact.normalFromFirstToSecond[1];
			gradient[second] = contact.normalFromFirstToSecond[0];
			gradient[second + 1] = contact.normalFromFirstToSecond[1];
		}
		return gradient;
	});
}

function normalVelocity(
	input: CoupledImpactInput,
	velocity: readonly number[],
	contactIndex: number
): number {
	return dot(contactGradients(input)[contactIndex]!, velocity);
}

function bodyVelocity(
	input: CoupledImpactInput,
	velocity: readonly number[],
	bodyId: string
): Vec2 {
	const index = input.bodies.findIndex(({ id }) => id === bodyId);
	return [velocity[index * 2]!, velocity[index * 2 + 1]!];
}

function impact(
	bodies: readonly BodyFixture[],
	contacts: CoupledImpactInput['contacts'],
	restitution: number
): CoupledImpactInput {
	return {
		bodies: bodies.map(([id, mass, velocity]) => ({ id, mass, velocity })),
		contacts,
		restitution,
		tolerances: {
			numerical: numericalTolerance,
			absoluteNormalVelocityFloor: 1e-14,
			relativeViolationEpsilon: numericalTolerance,
			maximumReflections: 128
		}
	};
}

function bodyContact(
	id: string,
	firstBodyId: string,
	secondBodyId: string,
	normalFromFirstToSecond: Vec2
): CoupledImpactInput['contacts'][number] {
	return { id, type: 'body-body', firstBodyId, secondBodyId, normalFromFirstToSecond };
}

function fixedContact(
	id: string,
	bodyId: string,
	normal: Vec2
): CoupledImpactInput['contacts'][number] {
	return { id, type: 'body-fixed', bodyId, colliderId: id, normal };
}

function scale(vector: Vec2, factor: number): Vec2 {
	return [vector[0] * factor, vector[1] * factor];
}

function add(left: Vec2, right: Vec2): Vec2 {
	return [left[0] + right[0], left[1] + right[1]];
}
