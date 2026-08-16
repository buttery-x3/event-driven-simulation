import { describe, expect, it } from 'vitest';
import type { CircularContactMotionSegment, Vec2 } from '../../../contracts';
import { circularContactTravelTime, evaluateCircularContactState } from '../../../motion';
import {
	resolveCoupledImpact,
	selectContactCapture,
	type ContactCaptureEndpoint,
	type CoupledImpactInput,
	type CoupledImpactResponse
} from '..';
import { dot } from '../linear-algebra';

const gravity: Vec2 = [0, -9.81];
// This is represented-physics policy, deliberately independent of numerical contact detection.
const representedCaptureResolution = 1e-6;
const numericalTolerance = 1e-12;

describe('FLAME-87 finite local contact-capture proof', () => {
	it('captures a negligible incline rebound without discarding tangential motion', () => {
		const angle = Math.PI / 6;
		const tangent: Vec2 = [Math.cos(angle), Math.sin(angle)];
		const normal: Vec2 = [-Math.sin(angle), Math.cos(angle)];
		const incoming = add(scale(tangent, 12), scale(normal, -1e-3));
		const proof = evaluateCapture(
			impact([['ball', 2, incoming]], [fixedContact('incline', 'ball', normal)], 0.8),
			{ captureResolution: representedCaptureResolution }
		);

		expect(proof.selectedEndpoint).toBe('inelastic');
		expect(proof.retainedContactIds).toEqual(['incline']);
		expect(proof.maximumNormalExcursion).toBeLessThan(representedCaptureResolution);
		expect(normalVelocity(proof.input, proof.selectedVelocity, 0)).toBeCloseTo(0, 12);
		expect(dot(bodyVelocity(proof.input, proof.selectedVelocity, 'ball'), tangent)).toBeCloseTo(
			12,
			12
		);
	});

	it('leaves a clearly energetic fixed-world impact on ordinary restitution', () => {
		const normal: Vec2 = [0, 1];
		const proof = evaluateCapture(
			impact([['ball', 1, [3, -2]]], [fixedContact('floor', 'ball', normal)], 0.8),
			{ captureResolution: representedCaptureResolution }
		);

		expect(proof.selectedEndpoint).toBe('ordinary');
		expect(proof.maximumNormalExcursion).toBeGreaterThan(representedCaptureResolution);
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
			),
			{ captureResolution: representedCaptureResolution }
		);

		expect(proof.selectedEndpoint).toBe('inelastic');
		expect(proof.retainedContactIds).toEqual(['floor', 'lower-middle', 'middle-upper']);
		expect(proof.supportReactions.every((reaction) => reaction > 0)).toBe(true);
		expect(proof.maximumNormalExcursion).toBeLessThan(representedCaptureResolution);
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
			),
			{ captureResolution: representedCaptureResolution }
		);

		expect(proof.selectedEndpoint).toBe('ordinary');
		expect(proof.retainedContactIds).toEqual([]);
		expect(proof.supportReactions).toEqual([0]);
		expect(proof.maximumNormalExcursion).toBe(Infinity);
		expect(normalVelocity(proof.input, proof.selectedVelocity, 0)).toBeGreaterThan(0);
	});

	it('includes changing circular geometry and releases centrifugally unsupported contact', () => {
		const contactRadius = 2;
		const normal: Vec2 = [0, 1];
		const supported = evaluateCapture(
			impact([['ball', 2, [3, -1e-3]]], [fixedContact('peg', 'ball', normal)], 0.8),
			{
				captureResolution: representedCaptureResolution,
				curvedContactRadii: new Map([['peg', contactRadius]])
			}
		);
		const unsupported = evaluateCapture(
			impact([['ball', 2, [5, -1e-3]]], [fixedContact('peg', 'ball', normal)], 0.8),
			{
				captureResolution: representedCaptureResolution,
				curvedContactRadii: new Map([['peg', contactRadius]])
			}
		);

		expect(supported.selectedEndpoint).toBe('inelastic');
		expect(supported.retainedContactIds).toEqual(['peg']);
		expect(bodyVelocity(supported.input, supported.selectedVelocity, 'ball')).toEqual([3, 0]);
		expect(supported.geometricNormalAccelerations).toEqual([4.5]);
		expect(unsupported.selectedEndpoint).toBe('ordinary');
		expect(unsupported.retainedContactIds).toEqual([]);
		expect(unsupported.releasedContactIds).toEqual(['peg']);
		expect(unsupported.geometricNormalAccelerations).toEqual([12.5]);
		expect(unsupported.maximumNormalExcursion).toBe(Infinity);

		const segment = circularSegment(contactRadius, 3, Math.PI / 2 - 0.1);
		const start = evaluateCircularContactState(segment, segment.startTime);
		const end = evaluateCircularContactState(segment, segment.endTime);
		const endSupport = -(
			dot(gravity, end.normal) +
			dot(end.velocity, end.velocity) / contactRadius
		);
		expect(end.normal).not.toEqual(start.normal);
		expect(Math.hypot(...end.velocity)).toBeGreaterThan(3);
		expect(endSupport).toBeGreaterThan(0);
	});

	it('releases an incidental zero-load contact and captures the re-solved supported subset', () => {
		const proof = evaluateCapture(
			impact(
				[['ball', 1, [0, -1e-3]]],
				[fixedContact('floor', 'ball', [0, 1]), fixedContact('incidental-wall', 'ball', [1, 0])],
				0.8
			),
			{ captureResolution: representedCaptureResolution }
		);

		expect(proof.selectedEndpoint).toBe('inelastic');
		expect(proof.retainedContactIds).toEqual(['floor']);
		expect(proof.releasedContactIds).toEqual(['incidental-wall']);
		expect(proof.supportReactions[0]).toBeCloseTo(9.81, 12);
		expect(proof.supportReactions[1]).toBe(0);
		expect(bodyVelocity(proof.input, proof.selectedVelocity, 'ball')).toEqual([0, 0]);
	});

	it('preserves a meaningful complete corner impact before later floor capture', () => {
		const bodies = [['ball', 1, [-2, -1e-3]]] as const;
		const wall = fixedContact('wall', 'ball', [1, 0]);
		const floor = fixedContact('floor', 'ball', [0, 1]);
		const forward = evaluateCapture(impact(bodies, [wall, floor], 0.8), {
			captureResolution: representedCaptureResolution
		});
		const reversed = evaluateCapture(impact(bodies, [floor, wall], 0.8), {
			captureResolution: representedCaptureResolution
		});
		const floorAlone = evaluateCapture(impact(bodies, [floor], 0.8), {
			captureResolution: representedCaptureResolution
		});

		expect(floorAlone.selectedEndpoint).toBe('inelastic');
		expect(forward.selectedEndpoint).toBe('ordinary');
		expect(forward.meaningfulImpulsiveContactIds).toEqual(['wall']);
		expect(reversed.meaningfulImpulsiveContactIds).toEqual(['wall']);
		expect(contactResult(forward.ordinary, 'wall').postImpactNormalVelocity).toBeCloseTo(1.6, 12);
		expect(contactResult(forward.ordinary, 'floor').postImpactNormalVelocity).toBeCloseTo(8e-4, 12);
		expect(forward.ordinary.finalVelocity).toEqual(reversed.ordinary.finalVelocity);
		expect(forward.selectedVelocity).toEqual(forward.ordinary.finalVelocity);
		expect(forward.selectedVelocity).toEqual(reversed.selectedVelocity);

		const postImpactVelocity = bodyVelocity(forward.input, forward.selectedVelocity, 'ball');
		const recollisionTime = (2 * postImpactVelocity[1]) / -gravity[1];
		const laterFloorImpact = evaluateCapture(
			impact([['ball', 1, [postImpactVelocity[0], -postImpactVelocity[1]]]], [floor], 0.8),
			{ captureResolution: representedCaptureResolution }
		);
		expect(recollisionTime).toBeGreaterThan(0);
		expect(laterFloorImpact.selectedEndpoint).toBe('inelastic');
		expect(laterFloorImpact.retainedContactIds).toEqual(['floor']);
		expect(laterFloorImpact.maximumNormalExcursion).toBeLessThan(representedCaptureResolution);
		expect(bodyVelocity(laterFloorImpact.input, laterFloorImpact.selectedVelocity, 'ball')).toEqual(
			[1.6, 0]
		);
	});

	it('makes capture depend on a distinct declared represented-physics resolution', () => {
		const lowEnergy = impact(
			[['ball', 1, [0, -1e-3]]],
			[fixedContact('floor', 'ball', [0, 1])],
			0.8
		);
		const energetic = impact([['ball', 1, [0, -2]]], [fixedContact('floor', 'ball', [0, 1])], 0.8);
		const coarseResolution = 1e-7;
		const fineResolution = 1e-8;
		const coarseLow = evaluateCapture(lowEnergy, { captureResolution: coarseResolution });
		const fineLow = evaluateCapture(lowEnergy, { captureResolution: fineResolution });
		const coarseEnergetic = evaluateCapture(energetic, {
			captureResolution: coarseResolution
		});
		const fineEnergetic = evaluateCapture(energetic, { captureResolution: fineResolution });

		expect(coarseLow.maximumNormalExcursion).toBeGreaterThan(fineResolution);
		expect(coarseLow.maximumNormalExcursion).toBeLessThan(coarseResolution);
		expect(fineLow.maximumNormalExcursion).toBe(coarseLow.maximumNormalExcursion);
		expect(coarseLow.selectedEndpoint).toBe('inelastic');
		expect(fineLow.selectedEndpoint).toBe('ordinary');
		expect(coarseEnergetic.selectedEndpoint).toBe('ordinary');
		expect(fineEnergetic.selectedEndpoint).toBe('ordinary');
	});
});

type BodyFixture = readonly [id: string, mass: number, velocity: Vec2];

interface CaptureProof {
	readonly input: CoupledImpactInput;
	readonly ordinary: CoupledImpactResponse;
	readonly selectedEndpoint: 'ordinary' | 'inelastic';
	readonly selectedVelocity: readonly number[];
	readonly retainedContactIds: readonly string[];
	readonly releasedContactIds: readonly string[];
	readonly meaningfulImpulsiveContactIds: readonly string[];
	readonly supportReactions: readonly number[];
	readonly geometricNormalAccelerations: readonly number[];
	readonly normalExcursions: readonly number[];
	readonly maximumNormalExcursion: number;
}

interface CaptureOptions {
	readonly captureResolution: number;
	readonly curvedContactRadii?: ReadonlyMap<string, number>;
}

function evaluateCapture(input: CoupledImpactInput, options: CaptureOptions): CaptureProof {
	const ordinary = solveImpact(input);
	const inelastic = solveImpact({ ...input, restitution: 0 });
	const result = selectContactCapture({
		bodies: input.bodies.map((body) => ({
			id: body.id,
			mass: body.mass,
			incomingVelocity: body.velocity,
			freeAcceleration: gravity
		})),
		contacts: input.contacts.map((contact) =>
			contact.type === 'body-body'
				? {
						...contact,
						curvatureRadius: options.curvedContactRadii?.get(contact.id) ?? 1
					}
				: {
						...contact,
						curvatureRadius: options.curvedContactRadii?.get(contact.id) ?? null
					}
		),
		ordinary: endpoint(ordinary),
		inelastic: endpoint(inelastic),
		contactCaptureDistance: options.captureResolution,
		numericalTolerance,
		solveInelastic: (contactIds) => {
			const retained = input.contacts.filter((contact) => contactIds.includes(contact.id));
			return retained.length > 0
				? endpoint(solveImpact({ ...input, contacts: retained, restitution: 0 }))
				: null;
		}
	});
	const diagnostic = result.diagnostic;
	const normalExcursions = diagnostic.contacts.map(
		({ reboundExcursion }) => reboundExcursion ?? Infinity
	);
	const impulsiveExcursions = diagnostic.contacts
		.filter(({ impulsivelyActive }) => impulsivelyActive)
		.map(({ reboundExcursion }) => reboundExcursion ?? Infinity);

	return {
		input,
		ordinary,
		selectedEndpoint: diagnostic.selectedEndpoint === 'captured' ? 'inelastic' : 'ordinary',
		selectedVelocity: input.bodies.flatMap(({ id }) => {
			const velocity = result.endpoint.bodyVelocities.find(({ bodyId }) => bodyId === id)!.velocity;
			return velocity;
		}),
		retainedContactIds: diagnostic.retainedContactIds,
		releasedContactIds: diagnostic.releasedContactIds,
		meaningfulImpulsiveContactIds: diagnostic.meaningfulReboundContactIds,
		supportReactions: diagnostic.contacts.map(({ supportReaction }) => supportReaction),
		geometricNormalAccelerations: diagnostic.contacts.map(
			({ geometricNormalAcceleration }) => geometricNormalAcceleration
		),
		normalExcursions,
		maximumNormalExcursion: impulsiveExcursions.length > 0 ? Math.max(...impulsiveExcursions) : 0
	};
}

function endpoint(response: CoupledImpactResponse): ContactCaptureEndpoint {
	return { bodyVelocities: response.bodyVelocities, contacts: response.contacts };
}

function solveImpact(input: CoupledImpactInput): CoupledImpactResponse {
	const result = resolveCoupledImpact(input);
	expect(result.type, result.type === 'rejected' ? result.reason : undefined).toBe('response');
	if (result.type !== 'response') throw new Error(result.reason);
	return result.response;
}

function contactResult(response: CoupledImpactResponse, contactId: string) {
	const contact = response.contacts.find(({ contactId: id }) => id === contactId);
	if (!contact) throw new Error(`Missing impact result for ${contactId}.`);
	return contact;
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

function circularSegment(
	contactRadius: number,
	startTangentialSpeed: number,
	endAngle: number
): CircularContactMotionSegment {
	const seed = {
		centre: [0, 0] as Vec2,
		contactRadius,
		startAngle: Math.PI / 2,
		direction: -1 as const,
		startTangentialSpeed,
		gravity
	};
	const endTime = circularContactTravelTime(seed, endAngle);
	return {
		type: 'circular-contact',
		bodyId: 'ball',
		startTime: 0,
		endTime,
		startPosition: [0, contactRadius],
		startVelocity: [startTangentialSpeed, 0],
		supportingColliderId: 'peg',
		...seed,
		endAngle
	};
}

function scale(vector: Vec2, factor: number): Vec2 {
	return [vector[0] * factor, vector[1] * factor];
}

function add(left: Vec2, right: Vec2): Vec2 {
	return [left[0] + right[0], left[1] + right[1]];
}
