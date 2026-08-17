import type { CoupledImpactContact } from '../types';
import type { AnchoredElasticFallbackInput, LowSpeedElasticInput } from './types';

export interface EqualityConstraint {
	readonly gradient: readonly number[];
	readonly massNormalisedGradient: readonly number[];
	readonly source:
		| { readonly type: 'support-contact'; readonly contactId: string }
		| {
				readonly type: 'anchored-coordinate';
				readonly componentId: string;
				readonly bodyId: string;
				readonly axis: 'x' | 'y';
		  };
}

export interface PreparedLowSpeedProblem {
	readonly input: LowSpeedElasticInput;
	readonly masses: readonly number[];
	readonly squareRootMasses: readonly number[];
	readonly velocity: readonly number[];
	readonly massNormalisedVelocity: readonly number[];
	readonly contactGradients: readonly (readonly number[])[];
	readonly massNormalisedContactGradients: readonly (readonly number[])[];
	readonly supportIndices: readonly number[];
	readonly impactIndices: readonly number[];
	readonly equalities: readonly EqualityConstraint[];
}

export function prepareLowSpeedProblem(
	input: LowSpeedElasticInput,
	locks: readonly EqualityConstraint[]
): PreparedLowSpeedProblem | string {
	const invalid = validateInput(input);
	if (invalid) return invalid;
	const bodyIndex = new Map(input.bodies.map((body, index) => [body.id, index]));
	const masses = input.bodies.flatMap(({ mass }) => [mass, mass]);
	const squareRootMasses = masses.map(Math.sqrt);
	const velocity = input.bodies.flatMap(({ velocity: bodyVelocity }) => bodyVelocity);
	const massNormalisedVelocity = velocity.map((value, index) => value * squareRootMasses[index]!);
	const contactGradients = input.contacts.map((contact) =>
		contactGradient(contact, bodyIndex, masses.length)
	);
	const massNormalisedContactGradients = contactGradients.map((gradient) =>
		gradient.map((value, index) => value / squareRootMasses[index]!)
	);
	const supportIds = new Set(input.supportContactIds);
	const supportIndices = input.contacts.flatMap((contact, index) =>
		supportIds.has(contact.id) ? [index] : []
	);
	const impactIndices = input.contacts.flatMap((contact, index) =>
		supportIds.has(contact.id) ? [] : [index]
	);
	const supportEqualities: EqualityConstraint[] = supportIndices.map((index) => ({
		gradient: contactGradients[index]!,
		massNormalisedGradient: massNormalisedContactGradients[index]!,
		source: { type: 'support-contact', contactId: input.contacts[index]!.id }
	}));
	return {
		input,
		masses,
		squareRootMasses,
		velocity,
		massNormalisedVelocity,
		contactGradients,
		massNormalisedContactGradients,
		supportIndices,
		impactIndices,
		equalities: [...supportEqualities, ...locks]
	};
}

export function anchoredCoordinateLocks(
	input: AnchoredElasticFallbackInput
): readonly EqualityConstraint[] | string {
	const invalid = validateAnchoredComponents(input);
	if (invalid) return invalid;
	const bodyIndex = new Map(input.bodies.map((body, index) => [body.id, index]));
	return input.anchoredComponents.flatMap((component) =>
		component.bodyIds.flatMap((bodyId) =>
			(['x', 'y'] as const).map((axis) => {
				const coordinate = bodyIndex.get(bodyId)! * 2 + (axis === 'x' ? 0 : 1);
				const gradient = Array.from({ length: input.bodies.length * 2 }, () => 0);
				gradient[coordinate] = 1;
				return {
					gradient,
					massNormalisedGradient: gradient.map(
						(value, index) => value / Math.sqrt(input.bodies[Math.floor(index / 2)]!.mass)
					),
					source: {
						type: 'anchored-coordinate' as const,
						componentId: component.componentId,
						bodyId,
						axis
					}
				};
			})
		)
	);
}

export function effectiveLowSpeedTolerance(input: LowSpeedElasticInput): number {
	return Math.max(input.tolerances.numerical, Number.EPSILON * 256);
}

function validateInput(input: LowSpeedElasticInput): string | null {
	if (input.bodies.length === 0 || input.contacts.length === 0) {
		return 'A low-speed elastic response requires bodies and active contacts.';
	}
	if (input.contacts.length > 16)
		return 'The active contact set exceeds the bounded resource limit.';
	const bodyIds = new Set(input.bodies.map(({ id }) => id));
	if (bodyIds.size !== input.bodies.length) return 'Body IDs must be unique.';
	if (
		input.bodies.some(
			(body) =>
				!(body.mass > 0) || !Number.isFinite(body.mass) || !body.velocity.every(Number.isFinite)
		)
	) {
		return 'Every body requires positive finite mass and finite velocity.';
	}
	const contactIds = new Set(input.contacts.map(({ id }) => id));
	if (contactIds.size !== input.contacts.length) return 'Contact IDs must be unique.';
	const supportIds = new Set(input.supportContactIds);
	if (supportIds.size !== input.supportContactIds.length)
		return 'Support contact IDs must be unique.';
	if (input.supportContactIds.some((id) => !contactIds.has(id))) {
		return 'Every support contact must belong to the active exact-time contact set.';
	}
	if (supportIds.size === input.contacts.length)
		return 'At least one non-support impact contact is required.';
	if (input.contacts.some(({ id, type }) => !supportIds.has(id) && type === 'body-fixed')) {
		return 'A non-support body-fixed impact remains authoritative outside the low-speed elastic policy.';
	}
	const normalTolerance = effectiveLowSpeedTolerance(input) * 16;
	for (const contact of input.contacts) {
		const participants =
			contact.type === 'body-body' ? [contact.firstBodyId, contact.secondBodyId] : [contact.bodyId];
		if (participants.some((id) => !bodyIds.has(id)))
			return `Contact ${contact.id} references an unknown body.`;
		const normal = contact.type === 'body-body' ? contact.normalFromFirstToSecond : contact.normal;
		if (!normal.every(Number.isFinite) || Math.abs(Math.hypot(...normal) - 1) > normalTolerance) {
			return `Contact ${contact.id} has a non-unit normal.`;
		}
	}
	const tolerances = input.tolerances;
	if (
		![
			tolerances.numerical,
			tolerances.absoluteNormalVelocityFloor,
			tolerances.relativeViolationEpsilon,
			tolerances.maximumReflections
		].every(Number.isFinite) ||
		tolerances.numerical < 0 ||
		tolerances.absoluteNormalVelocityFloor < 0 ||
		tolerances.relativeViolationEpsilon < 0 ||
		tolerances.maximumReflections <= 0
	) {
		return 'Low-speed elastic tolerances are invalid.';
	}
	return null;
}

function validateAnchoredComponents(input: AnchoredElasticFallbackInput): string | null {
	if (input.anchoredComponents.length === 0) {
		return 'Anchored elastic fallback requires at least one complete resting component.';
	}
	const componentIds = new Set(input.anchoredComponents.map(({ componentId }) => componentId));
	if (componentIds.size !== input.anchoredComponents.length) {
		return 'Anchored resting component IDs must be unique.';
	}
	const knownBodies = new Set(input.bodies.map(({ id }) => id));
	const lockedBodies = new Set<string>();
	for (const component of input.anchoredComponents) {
		if (component.bodyIds.length === 0) return 'An anchored resting component cannot be empty.';
		if (new Set(component.bodyIds).size !== component.bodyIds.length) {
			return `Anchored resting component ${component.componentId} repeats a body ID.`;
		}
		for (const bodyId of component.bodyIds) {
			if (!knownBodies.has(bodyId))
				return `Anchored resting component ${component.componentId} references an unknown body.`;
			if (lockedBodies.has(bodyId))
				return `Body ${bodyId} belongs to more than one anchored resting component.`;
			lockedBodies.add(bodyId);
		}
	}
	return null;
}

function contactGradient(
	contact: CoupledImpactContact,
	bodyIndex: ReadonlyMap<string, number>,
	size: number
): number[] {
	const result = Array.from({ length: size }, () => 0);
	if (contact.type === 'body-fixed') {
		const offset = bodyIndex.get(contact.bodyId)! * 2;
		result[offset] = contact.normal[0];
		result[offset + 1] = contact.normal[1];
		return result;
	}
	const first = bodyIndex.get(contact.firstBodyId)! * 2;
	const second = bodyIndex.get(contact.secondBodyId)! * 2;
	result[first] = -contact.normalFromFirstToSecond[0];
	result[first + 1] = -contact.normalFromFirstToSecond[1];
	result[second] = contact.normalFromFirstToSecond[0];
	result[second + 1] = contact.normalFromFirstToSecond[1];
	return result;
}
