import { describe, expect, it } from 'vitest';
import {
	resolveAnchoredComponentElasticFallback,
	resolveCoupledImpact,
	resolveSupportPreservingElasticResponse,
	type AnchoredElasticFallbackInput,
	type CoupledImpactContact,
	type CoupledImpactResponse,
	type CoupledImpactResult,
	type LowSpeedElasticInput,
	type LowSpeedElasticResponse
} from '..';

describe('FLAME-96 adapter investigation against FLAME-53', () => {
	it('matches the reference for floor-supported horizontal body-body impact', () => {
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

		compareSupportAdapterWithReference(input);
		expect(adapterVelocity(solvePairedSupportAdapter(input), 'supported')).toEqual([0.04, 0]);
	});

	it('matches the reference while a circular support normal stays closed and tangent motion survives', () => {
		const diagonal = Math.SQRT1_2;
		const input = problem(
			[
				['incoming', 1, [0.04 * diagonal, 0.04 * diagonal]],
				['supported', 1, [0, 0]]
			],
			[
				bodyContact('oblique-impact', 'incoming', 'supported', [diagonal, diagonal]),
				fixedContact('circular-support', 'supported', [1, 0])
			],
			['circular-support']
		);
		const adapter = solvePairedSupportAdapter(input);

		compareSupportAdapterWithReference(input, adapter);
		const supported = adapterVelocity(adapter, 'supported');
		expect(supported[0]).toBe(0);
		expect(Math.abs(supported[1])).toBeGreaterThan(1e-6);
		expect(adapter.response.diagnostic.linealityDimension).toBe(1);
	});

	it('matches the reference for a dynamic support equality while relative tangent motion survives', () => {
		const diagonal = Math.SQRT1_2;
		const input = problem(
			[
				['incoming', 1, [0.04 * diagonal, 0.04 * diagonal]],
				['supporting', 1, [0, 0]],
				['supported', 1, [0, 0]]
			],
			[
				bodyContact('oblique-impact', 'incoming', 'supported', [diagonal, diagonal]),
				bodyContact('dynamic-support', 'supporting', 'supported', [1, 0]),
				fixedContact('supporting-floor', 'supporting', [0, 1])
			],
			['dynamic-support', 'supporting-floor']
		);
		const adapter = solvePairedSupportAdapter(input);

		compareSupportAdapterWithReference(input, adapter);
		const supporting = adapterVelocity(adapter, 'supporting');
		const supported = adapterVelocity(adapter, 'supported');
		expect(supported[0] - supporting[0]).toBeCloseTo(0, 12);
		expect(Math.abs(supported[1] - supporting[1])).toBeGreaterThan(1e-6);
	});

	it('matches the reference when multiple established supports remove only constrained directions', () => {
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
		const adapter = solvePairedSupportAdapter(input);

		compareSupportAdapterWithReference(input, adapter);
		expect(adapterVelocity(adapter, 'incoming')).toEqual([-0.04, 0]);
		expect(adapterVelocity(adapter, 'supported')).toEqual([0, 0]);
		expect(adapter.response.diagnostic.linealityDimension).toBe(2);
	});

	it('requires collapsing paired unilateral impulses into a signed support reaction', () => {
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
		const adapter = solvePairedSupportAdapter(input);
		const signedReaction =
			adapterContact(adapter, 'support-plus:floor').impulse -
			adapterContact(adapter, 'support-minus:floor').impulse;

		compareSupportAdapterWithReference(input, adapter);
		expect(signedReaction).toBeLessThan(0);
		expect(adapter.response.contacts.every(({ impulse }) => impulse >= 0)).toBe(true);
	});

	it("matches the reference and transmits through an initially-zero unsupported Newton's-cradle contact", () => {
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
		const adapter = solvePairedSupportAdapter(input);

		compareSupportAdapterWithReference(input, adapter);
		expect(adapterVelocity(adapter, 'left')).toEqual([0, 0]);
		expect(adapterVelocity(adapter, 'centre')).toEqual([0, 0]);
		expect(adapterVelocity(adapter, 'right')).toEqual([0.04, 0]);
		expect(adapterContact(adapter, 'right-contact').preImpactNormalVelocity).toBe(0);
		expect(adapterContact(adapter, 'right-contact').impulse).toBeGreaterThan(0);
	});

	it('matches the anchored reference after dormant DOFs become a private fixed-side gradient', () => {
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
		const input: AnchoredElasticFallbackInput = {
			...base,
			anchoredComponents: [{ componentId: 'resting-component', bodyIds: ['lower', 'upper'] }]
		};
		const reference = solveAnchoredReference(input);
		const adapter = solveReducedDofAnchoredAdapter(input);

		for (const body of input.bodies) {
			expectVelocityClose(adapterVelocity(adapter, body.id), responseVelocity(reference, body.id));
		}
		expect(adapterVelocity(adapter, 'incoming')).toEqual([-0.04, 0]);
		expect(adapterVelocity(adapter, 'lower')).toEqual([0, 0]);
		expect(adapterVelocity(adapter, 'upper')).toEqual([0, 0]);
		expect(adapterContact(adapter, 'fixed-side:impact').impulse).toBeGreaterThan(0);
		certifyMappedAnchoredResponse(input, adapter);
	});
});

describe('FLAME-96 adapter activation and compatibility boundaries', () => {
	it('does not activate for an ordinary incoming body-fixed impact', () => {
		const input = problem(
			[['body', 1, [0, -0.04]]],
			[fixedContact('ordinary-fixed-impact', 'body', [0, 1])],
			[]
		);

		expect(classifyAdapterInput(input)).toEqual({
			type: 'not-eligible',
			reason: 'No genuinely incoming dynamic body-body impact is present.'
		});
	});

	it('does not activate from established support context without an incoming body-body impact', () => {
		const input = problem(
			[
				['first', 1, [0, 0]],
				['second', 1, [0, 0]]
			],
			[
				bodyContact('zero-body-contact', 'first', 'second', [1, 0]),
				fixedContact('floor', 'second', [0, 1])
			],
			['floor']
		);

		expect(classifyAdapterInput(input).type).toBe('not-eligible');
	});

	it('leaves a simultaneous ordinary fixed impact to the existing fixed-impact authority', () => {
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

		expect(classifyAdapterInput(input)).toEqual({
			type: 'not-eligible',
			reason: 'A non-support body-fixed impact remains authoritative outside FLAME-96.'
		});
	});

	it('exposes the paired-support contact-cap regression on an otherwise bounded resting stack', () => {
		const bodies: BodyFixture[] = [['incoming', 1, [0.04, 0]]];
		for (let index = 0; index < 8; index += 1) bodies.push([`stack-${index}`, 1, [0, 0]]);
		const supports: CoupledImpactContact[] = [fixedContact('floor', 'stack-0', [0, 1])];
		for (let index = 0; index < 7; index += 1) {
			supports.push(
				bodyContact(`stack-support-${index}`, `stack-${index}`, `stack-${index + 1}`, [0, 1])
			);
		}
		const input = problem(
			bodies,
			[bodyContact('impact', 'incoming', 'stack-7', [1, 0]), ...supports],
			supports.map(({ id }) => id)
		);

		expect(input.contacts).toHaveLength(9);
		expect(solveSupportReference(input).type).toBe('response');
		const paired = pairedSupportResult(input);
		expect(paired.augmentedContacts).toHaveLength(17);
		expect(paired.result).toEqual({
			type: 'rejected',
			reason: 'The coupled impact exceeds the supported contact resource boundary.'
		});
	});
});

type BodyFixture = [id: string, mass: number, velocity: readonly [number, number]];

type EligibleAdapterInput = {
	readonly type: 'eligible';
	readonly impactContacts: readonly CoupledImpactContact[];
	readonly supportContacts: readonly CoupledImpactContact[];
};

type AdapterClassification =
	EligibleAdapterInput | { readonly type: 'not-eligible'; readonly reason: string };

type AdapterResponse = {
	readonly response: CoupledImpactResponse;
	readonly bodyVelocities: ReadonlyMap<string, readonly [number, number]>;
};

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

function classifyAdapterInput(input: LowSpeedElasticInput): AdapterClassification {
	const supportIds = new Set(input.supportContactIds);
	const impactContacts = input.contacts.filter(({ id }) => !supportIds.has(id));
	const velocities = new Map(input.bodies.map(({ id, velocity }) => [id, velocity]));
	const hasIncomingBodyBody = impactContacts.some(
		(contact) =>
			contact.type === 'body-body' &&
			normalVelocity(contact, velocities) < -input.tolerances.absoluteNormalVelocityFloor
	);
	if (!hasIncomingBodyBody) {
		return {
			type: 'not-eligible',
			reason: 'No genuinely incoming dynamic body-body impact is present.'
		};
	}
	if (impactContacts.some(({ type }) => type === 'body-fixed')) {
		return {
			type: 'not-eligible',
			reason: 'A non-support body-fixed impact remains authoritative outside FLAME-96.'
		};
	}
	return {
		type: 'eligible',
		impactContacts,
		supportContacts: input.contacts.filter(({ id }) => supportIds.has(id))
	};
}

function normalVelocity(
	contact: CoupledImpactContact,
	velocities: ReadonlyMap<string, readonly [number, number]>
): number {
	if (contact.type === 'body-fixed') {
		const velocity = velocities.get(contact.bodyId)!;
		return contact.normal[0] * velocity[0] + contact.normal[1] * velocity[1];
	}
	const first = velocities.get(contact.firstBodyId)!;
	const second = velocities.get(contact.secondBodyId)!;
	return (
		contact.normalFromFirstToSecond[0] * (second[0] - first[0]) +
		contact.normalFromFirstToSecond[1] * (second[1] - first[1])
	);
}

function pairedSupportResult(input: LowSpeedElasticInput): {
	readonly result: CoupledImpactResult;
	readonly augmentedContacts: readonly CoupledImpactContact[];
} {
	const classification = classifyAdapterInput(input);
	if (classification.type !== 'eligible') throw new Error(classification.reason);
	const augmentedContacts = [
		...classification.impactContacts,
		...classification.supportContacts.flatMap(opposingSupportContacts)
	];
	return {
		augmentedContacts,
		result: resolveCoupledImpact({
			bodies: input.bodies,
			contacts: augmentedContacts,
			restitution: 1,
			tolerances: input.tolerances
		})
	};
}

function opposingSupportContacts(contact: CoupledImpactContact): CoupledImpactContact[] {
	if (contact.type === 'body-fixed') {
		return [
			{ ...contact, id: `support-plus:${contact.id}` },
			{
				...contact,
				id: `support-minus:${contact.id}`,
				normal: [-contact.normal[0], -contact.normal[1]]
			}
		];
	}
	return [
		{ ...contact, id: `support-plus:${contact.id}` },
		{
			...contact,
			id: `support-minus:${contact.id}`,
			normalFromFirstToSecond: [
				-contact.normalFromFirstToSecond[0],
				-contact.normalFromFirstToSecond[1]
			]
		}
	];
}

function solvePairedSupportAdapter(input: LowSpeedElasticInput): AdapterResponse {
	const { result } = pairedSupportResult(input);
	if (result.type !== 'response') throw new Error(result.reason);
	return adaptResponse(result.response);
}

function solveReducedDofAnchoredAdapter(input: AnchoredElasticFallbackInput): AdapterResponse {
	const classification = classifyAdapterInput(input);
	if (classification.type !== 'eligible') throw new Error(classification.reason);
	const anchoredIds = new Set(input.anchoredComponents.flatMap(({ bodyIds }) => bodyIds));
	const activeBodies = input.bodies.filter(({ id }) => !anchoredIds.has(id));
	const contacts = classification.impactContacts.flatMap((contact) =>
		removeAnchoredDofs(contact, anchoredIds)
	);
	const result = resolveCoupledImpact({
		bodies: activeBodies,
		contacts,
		restitution: 1,
		tolerances: input.tolerances
	});
	if (result.type !== 'response') throw new Error(result.reason);
	const activeVelocities = new Map(
		result.response.bodyVelocities.map(({ bodyId, velocity }) => [bodyId, velocity] as const)
	);
	return {
		response: result.response,
		bodyVelocities: new Map(
			input.bodies.map(({ id }) => [id, activeVelocities.get(id) ?? ([0, 0] as const)])
		)
	};
}

function removeAnchoredDofs(
	contact: CoupledImpactContact,
	anchoredIds: ReadonlySet<string>
): CoupledImpactContact[] {
	if (contact.type === 'body-fixed') return [];
	const firstAnchored = anchoredIds.has(contact.firstBodyId);
	const secondAnchored = anchoredIds.has(contact.secondBodyId);
	if (firstAnchored && secondAnchored) return [];
	if (!firstAnchored && !secondAnchored) return [contact];
	const activeBodyId = firstAnchored ? contact.secondBodyId : contact.firstBodyId;
	const direction = firstAnchored ? 1 : -1;
	return [
		fixedContact(`fixed-side:${contact.id}`, activeBodyId, [
			direction * contact.normalFromFirstToSecond[0],
			direction * contact.normalFromFirstToSecond[1]
		])
	];
}

function adaptResponse(response: CoupledImpactResponse): AdapterResponse {
	return {
		response,
		bodyVelocities: new Map(
			response.bodyVelocities.map(({ bodyId, velocity }) => [bodyId, velocity] as const)
		)
	};
}

function solveSupportReference(input: LowSpeedElasticInput) {
	return resolveSupportPreservingElasticResponse(input);
}

function solveAnchoredReference(input: AnchoredElasticFallbackInput): LowSpeedElasticResponse {
	const result = resolveAnchoredComponentElasticFallback(input);
	if (result.type !== 'response') throw new Error(result.reason);
	return result.response;
}

function compareSupportAdapterWithReference(
	input: LowSpeedElasticInput,
	adapter = solvePairedSupportAdapter(input)
): void {
	const reference = solveSupportReference(input);
	if (reference.type !== 'response') throw new Error(reference.reason);
	for (const body of input.bodies) {
		expectVelocityClose(
			adapterVelocity(adapter, body.id),
			responseVelocity(reference.response, body.id)
		);
	}
	const supportIds = new Set(input.supportContactIds);
	for (const item of reference.response.contacts.filter(({ contactId }) =>
		supportIds.has(contactId)
	)) {
		const plus = adapterContact(adapter, `support-plus:${item.contactId}`);
		const minus = adapterContact(adapter, `support-minus:${item.contactId}`);
		expect(plus.postImpactNormalVelocity).toBeCloseTo(0, 12);
		expect(minus.postImpactNormalVelocity).toBeCloseTo(0, 12);
	}
	certifyMappedSupportResponse(input, adapter);
}

function adapterVelocity(adapter: AdapterResponse, bodyId: string): readonly [number, number] {
	return adapter.bodyVelocities.get(bodyId)!;
}

function responseVelocity(
	response: LowSpeedElasticResponse,
	bodyId: string
): readonly [number, number] {
	return response.bodyVelocities.find((body) => body.bodyId === bodyId)!.velocity;
}

function adapterContact(adapter: AdapterResponse, contactId: string) {
	return adapter.response.contacts.find((contact) => contact.contactId === contactId)!;
}

function certifyMappedSupportResponse(input: LowSpeedElasticInput, adapter: AdapterResponse): void {
	const bodyIndex = new Map(input.bodies.map(({ id }, index) => [id, index]));
	const momentum = Array.from({ length: input.bodies.length * 2 }, () => 0);
	const supportIds = new Set(input.supportContactIds);
	for (const contact of input.contacts) {
		const multiplier = supportIds.has(contact.id)
			? adapterContact(adapter, `support-plus:${contact.id}`).impulse -
				adapterContact(adapter, `support-minus:${contact.id}`).impulse
			: adapterContact(adapter, contact.id).impulse;
		addScaled(momentum, physicalGradient(contact, bodyIndex, input.bodies.length * 2), multiplier);
		if (!supportIds.has(contact.id)) expect(multiplier).toBeGreaterThanOrEqual(0);
	}
	expectMomentumAndEnergyCertified(input, adapter, momentum);
}

function certifyMappedAnchoredResponse(
	input: AnchoredElasticFallbackInput,
	adapter: AdapterResponse
): void {
	const bodyIndex = new Map(input.bodies.map(({ id }, index) => [id, index]));
	const momentum = Array.from({ length: input.bodies.length * 2 }, () => 0);
	const impact = input.contacts.find(({ id }) => id === 'impact')!;
	const impulse = adapterContact(adapter, 'fixed-side:impact').impulse;
	addScaled(momentum, physicalGradient(impact, bodyIndex, input.bodies.length * 2), impulse);
	const target = momentumChange(input, adapter);
	const anchoredIds = new Set(input.anchoredComponents.flatMap(({ bodyIds }) => bodyIds));
	for (const body of input.bodies) {
		const offset = bodyIndex.get(body.id)! * 2;
		if (anchoredIds.has(body.id)) {
			// The residual is the explicit signed coordinate-lock reaction required by the mapping.
			momentum[offset] += target[offset]! - momentum[offset]!;
			momentum[offset + 1] += target[offset + 1]! - momentum[offset + 1]!;
		}
	}
	expect(impulse).toBeGreaterThanOrEqual(0);
	expectMomentumAndEnergyCertified(input, adapter, momentum);
}

function expectMomentumAndEnergyCertified(
	input: LowSpeedElasticInput,
	adapter: AdapterResponse,
	reconstructedMomentum: readonly number[]
): void {
	const target = momentumChange(input, adapter);
	expect(
		Math.hypot(...target.map((value, index) => value - reconstructedMomentum[index]!))
	).toBeLessThan(1e-9);
	const before = input.bodies.reduce(
		(sum, body) => sum + 0.5 * body.mass * (body.velocity[0] ** 2 + body.velocity[1] ** 2),
		0
	);
	const after = input.bodies.reduce((sum, body) => {
		const velocity = adapterVelocity(adapter, body.id);
		return sum + 0.5 * body.mass * (velocity[0] ** 2 + velocity[1] ** 2);
	}, 0);
	expect(after).toBeCloseTo(before, 12);
}

function momentumChange(input: LowSpeedElasticInput, adapter: AdapterResponse): number[] {
	return input.bodies.flatMap((body) => {
		const finalVelocity = adapterVelocity(adapter, body.id);
		return [
			body.mass * (finalVelocity[0] - body.velocity[0]),
			body.mass * (finalVelocity[1] - body.velocity[1])
		];
	});
}

function physicalGradient(
	contact: CoupledImpactContact,
	bodyIndex: ReadonlyMap<string, number>,
	size: number
): number[] {
	const gradient = Array.from({ length: size }, () => 0);
	if (contact.type === 'body-fixed') {
		const offset = bodyIndex.get(contact.bodyId)! * 2;
		gradient[offset] = contact.normal[0];
		gradient[offset + 1] = contact.normal[1];
		return gradient;
	}
	const first = bodyIndex.get(contact.firstBodyId)! * 2;
	const second = bodyIndex.get(contact.secondBodyId)! * 2;
	gradient[first] = -contact.normalFromFirstToSecond[0];
	gradient[first + 1] = -contact.normalFromFirstToSecond[1];
	gradient[second] = contact.normalFromFirstToSecond[0];
	gradient[second + 1] = contact.normalFromFirstToSecond[1];
	return gradient;
}

function addScaled(target: number[], value: readonly number[], scale: number): void {
	for (let index = 0; index < target.length; index += 1) {
		target[index]! += value[index]! * scale;
	}
}

function expectVelocityClose(
	actual: readonly [number, number],
	expected: readonly [number, number]
): void {
	expect(actual[0]).toBeCloseTo(expected[0], 12);
	expect(actual[1]).toBeCloseTo(expected[1], 12);
}
