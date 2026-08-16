import { dot, gramMatrix } from '../linear-algebra';
import { solveNonnegativeQuadratic } from '../nonnegative-qp';
import type { ContactCaptureEndpoint, ContactCaptureInput, ContactCaptureResult } from './types';

interface AccelerationSolution {
	readonly reactions: readonly number[];
	readonly normalAccelerations: readonly number[];
}

export function selectContactCapture(input: ContactCaptureInput): ContactCaptureResult {
	const tolerance = Math.max(input.numericalTolerance, Number.EPSILON * 256);
	const bodyIndex = new Map(input.bodies.map((body, index) => [body.id, index]));
	const gradients = input.contacts.map((contact) =>
		contactGradient(contact, bodyIndex, input.bodies.length * 2)
	);
	const inverseMasses = input.bodies.flatMap(({ mass }) => [1 / mass, 1 / mass]);
	const delassus = gramMatrix(gradients, inverseMasses);
	const freeAcceleration = input.bodies.flatMap(({ freeAcceleration: [x, y] }) => [x, y]);
	const inelasticVelocity = endpointVelocity(input, input.inelastic);
	const geometric = geometricAccelerations(input, inelasticVelocity, bodyIndex);
	const freeNormal = gradients.map(
		(gradient, index) => dot(gradient, freeAcceleration) + geometric[index]!
	);
	const reduction = reduceActiveSet(
		input,
		delassus,
		freeNormal,
		input.contacts.map((_, index) => index),
		tolerance
	);
	const active = reduction.activeIndices;
	const acceleration = reduction.solution;
	const ordinaryById = new Map(
		input.ordinary.contacts.map((contact) => [contact.contactId, contact])
	);
	const excursion = input.contacts.map((contact, index) => {
		const ordinary = ordinaryById.get(contact.id);
		const impulsive = Boolean(
			ordinary &&
			ordinary.preImpactNormalVelocity < -tolerance * 64 &&
			ordinary.postImpactNormalVelocity > tolerance * 64
		);
		if (!impulsive || !active.includes(index)) {
			return { impulsive, pressing: null, distance: null };
		}
		const released = solveAcceleration(
			delassus,
			freeNormal,
			active.filter((candidate) => candidate !== index),
			tolerance
		);
		const pressing = released ? -released.normalAccelerations[index]! : 0;
		if (!(pressing > tolerance)) return { impulsive, pressing: null, distance: null };
		const speed = Math.max(0, ordinary!.postImpactNormalVelocity);
		return { impulsive, pressing, distance: (speed * speed) / (2 * pressing) };
	});
	const meaningful = excursion
		.map((item, index) => ({ item, index }))
		.filter(
			({ item }) =>
				item.impulsive &&
				(item.distance === null || item.distance > input.contactCaptureDistance + tolerance)
		)
		.map(({ index }) => index);

	let endpoint = input.ordinary;
	let selected: 'ordinary' | 'captured' = 'ordinary';
	let retained: readonly number[] = selectedContactIndices(input, input.ordinary, tolerance);
	let finalActive: readonly number[] = active;
	let finalAcceleration = acceleration;
	const removals = [...reduction.removalSequence];
	if (meaningful.length === 0 && active.length > 0) {
		const capture = stabilizeCapturedEndpoint(
			input,
			delassus,
			freeAcceleration,
			active,
			removals,
			tolerance
		);
		if (capture) {
			endpoint = capture.endpoint;
			selected = 'captured';
			retained = capture.activeIndices;
			finalActive = capture.activeIndices;
			finalAcceleration = capture.solution;
		}
	}
	const retainedIds = retained.map((index) => input.contacts[index]!.id);
	const retainedSet = new Set(retainedIds);
	return {
		endpoint,
		diagnostic: {
			captureDistance: input.contactCaptureDistance,
			selectedEndpoint: selected,
			meaningfulReboundVeto: meaningful.length > 0,
			meaningfulReboundContactIds: meaningful.map((index) => input.contacts[index]!.id),
			activeSetRemovalSequence: removals,
			retainedContactIds: retainedIds,
			releasedContactIds: input.contacts.map(({ id }) => id).filter((id) => !retainedSet.has(id)),
			contacts: input.contacts.map((contact, index) => ({
				contactId: contact.id,
				ordinaryPostImpactNormalVelocity:
					ordinaryById.get(contact.id)?.postImpactNormalVelocity ?? 0,
				geometricNormalAcceleration: geometric[index]!,
				pressingNormalAcceleration: excursion[index]!.pressing,
				reboundExcursion: excursion[index]!.distance,
				withinCaptureDistance:
					excursion[index]!.distance === null
						? null
						: excursion[index]!.distance! <= input.contactCaptureDistance + tolerance,
				impulsivelyActive: excursion[index]!.impulsive,
				supportReaction: finalAcceleration?.reactions[index] ?? 0,
				retained: finalActive.includes(index) && retainedSet.has(contact.id)
			}))
		}
	};
}

function stabilizeCapturedEndpoint(
	input: ContactCaptureInput,
	delassus: readonly (readonly number[])[],
	freeAcceleration: readonly number[],
	initialActive: readonly number[],
	removals: string[][],
	tolerance: number
): {
	readonly endpoint: ContactCaptureEndpoint;
	readonly activeIndices: readonly number[];
	readonly solution: AccelerationSolution;
} | null {
	let active = [...initialActive];
	while (active.length > 0) {
		const endpoint = input.solveInelastic(active.map((index) => input.contacts[index]!.id));
		if (!endpoint) return null;
		const velocity = endpointVelocity(input, endpoint);
		const geometric = geometricAccelerations(
			input,
			velocity,
			new Map(input.bodies.map((body, index) => [body.id, index]))
		);
		const gradients = input.contacts.map((contact) =>
			contactGradient(
				contact,
				new Map(input.bodies.map((body, index) => [body.id, index])),
				input.bodies.length * 2
			)
		);
		const freeNormal = gradients.map(
			(gradient, index) => dot(gradient, freeAcceleration) + geometric[index]!
		);
		const reduced = reduceActiveSet(input, delassus, freeNormal, active, tolerance);
		removals.push(...reduced.removalSequence);
		const separating = reduced.activeIndices.filter(
			(index) => dot(gradients[index]!, velocity) > tolerance * 64
		);
		const next = reduced.activeIndices.filter((index) => !separating.includes(index));
		if (separating.length > 0) {
			removals.push(separating.map((index) => input.contacts[index]!.id));
		}
		if (next.length === 0) return null;
		if (sameIndices(active, next)) {
			return { endpoint, activeIndices: next, solution: reduced.solution! };
		}
		active = next;
	}
	return null;
}

function reduceActiveSet(
	input: ContactCaptureInput,
	delassus: readonly (readonly number[])[],
	freeNormal: readonly number[],
	initial: readonly number[],
	tolerance: number
): {
	readonly activeIndices: readonly number[];
	readonly solution: AccelerationSolution | null;
	readonly removalSequence: string[][];
} {
	let active = [...initial];
	let solution: AccelerationSolution | null = null;
	const removalSequence: string[][] = [];
	while (active.length > 0) {
		solution = solveAcceleration(delassus, freeNormal, active, tolerance);
		if (!solution) return { activeIndices: [], solution: null, removalSequence };
		const forceScale = Math.max(1, ...solution.reactions.map(Math.abs));
		const threshold = tolerance * forceScale * 64;
		const next = active.filter((index) => solution!.reactions[index]! > threshold);
		if (sameIndices(active, next)) break;
		const nextSet = new Set(next);
		removalSequence.push(
			active.filter((index) => !nextSet.has(index)).map((index) => input.contacts[index]!.id)
		);
		active = next;
	}
	return { activeIndices: active, solution, removalSequence };
}

function solveAcceleration(
	delassus: readonly (readonly number[])[],
	freeNormal: readonly number[],
	active: readonly number[],
	tolerance: number
): AccelerationSolution | null {
	if (active.length === 0) {
		return {
			reactions: freeNormal.map(() => 0),
			normalAccelerations: [...freeNormal]
		};
	}
	const solved = solveNonnegativeQuadratic(
		active.map((row) => active.map((column) => delassus[row]![column]!)),
		active.map((index) => freeNormal[index]!),
		tolerance
	);
	if (!solved) return null;
	const reactions = freeNormal.map(() => 0);
	for (let index = 0; index < active.length; index += 1) {
		reactions[active[index]!] = solved.values[index]!;
	}
	return {
		reactions,
		normalAccelerations: freeNormal.map(
			(value, row) =>
				value +
				reactions.reduce((sum, reaction, column) => sum + delassus[row]![column]! * reaction, 0)
		)
	};
}

function geometricAccelerations(
	input: ContactCaptureInput,
	velocity: readonly number[],
	bodyIndex: ReadonlyMap<string, number>
): number[] {
	return input.contacts.map((contact) => {
		if (contact.curvatureRadius === null) return 0;
		const relative =
			contact.type === 'body-fixed'
				? bodyVelocity(velocity, bodyIndex.get(contact.bodyId)!)
				: subtract(
						bodyVelocity(velocity, bodyIndex.get(contact.secondBodyId)!),
						bodyVelocity(velocity, bodyIndex.get(contact.firstBodyId)!)
					);
		const normal = contact.type === 'body-fixed' ? contact.normal : contact.normalFromFirstToSecond;
		const normalSpeed = relative[0] * normal[0] + relative[1] * normal[1];
		const tangentSpeedSquared = Math.max(
			0,
			relative[0] * relative[0] + relative[1] * relative[1] - normalSpeed * normalSpeed
		);
		return tangentSpeedSquared / contact.curvatureRadius;
	});
}

function contactGradient(
	contact: ContactCaptureInput['contacts'][number],
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

function endpointVelocity(input: ContactCaptureInput, endpoint: ContactCaptureEndpoint): number[] {
	const byId = new Map(endpoint.bodyVelocities.map((body) => [body.bodyId, body.velocity]));
	return input.bodies.flatMap(({ id }) => byId.get(id) ?? [0, 0]);
}

function selectedContactIndices(
	input: ContactCaptureInput,
	endpoint: ContactCaptureEndpoint,
	tolerance: number
): number[] {
	const byId = new Map(endpoint.contacts.map((contact) => [contact.contactId, contact]));
	return input.contacts
		.map((contact, index) => ({ index, result: byId.get(contact.id) }))
		.filter(({ result }) => result !== undefined && result.postImpactNormalVelocity <= tolerance)
		.map(({ index }) => index);
}

function bodyVelocity(velocity: readonly number[], index: number): readonly [number, number] {
	return [velocity[index * 2]!, velocity[index * 2 + 1]!];
}

function subtract(
	left: readonly [number, number],
	right: readonly [number, number]
): readonly [number, number] {
	return [left[0] - right[0], left[1] - right[1]];
}

function sameIndices(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
