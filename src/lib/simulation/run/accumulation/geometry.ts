import type {
	AccumulationConnectedComponent,
	AccumulationGeometricResidual,
	AccumulationLimitContact,
	AccumulationPenetrationEvidence,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../contracts';
import type { AccumulationObservedContact, LimitBodyEstimate } from './types';

interface GeometryResult {
	readonly estimates: readonly LimitBodyEstimate[];
	readonly activeContacts: readonly AccumulationLimitContact[];
	readonly connectedComponents: readonly AccumulationConnectedComponent[];
	readonly residuals: readonly AccumulationGeometricResidual[];
	readonly penetrationEvidence: AccumulationPenetrationEvidence;
}

export function reconstructLimitGeometry(
	input: SimulationInput,
	estimates: readonly LimitBodyEstimate[],
	candidateContacts: readonly AccumulationObservedContact[],
	constraintContacts: readonly AccumulationObservedContact[] = candidateContacts
): GeometryResult | string {
	const tolerance = Math.max(input.settings.tolerances.contactDistance, Number.EPSILON * 256);
	const positions = new Map(estimates.map((body) => [body.bodyId, body.position]));
	seedFixedCircleIntersections(input, estimates, positions, constraintContacts, tolerance);
	for (let iteration = 0; iteration < 64; iteration += 1) {
		let maximumCorrection = 0;
		for (const contact of constraintContacts) {
			const correction = projectContact(input, estimates, positions, contact, tolerance);
			if (!Number.isFinite(correction))
				return `Candidate contact ${contactKey(contact)} is degenerate.`;
			maximumCorrection = Math.max(maximumCorrection, correction);
		}
		if (maximumCorrection <= tolerance * 0.125) break;
		if (iteration === 63)
			return 'The candidate limiting constraints did not converge within the bounded reconstruction budget.';
	}
	const reconstructed = estimates.map((body) => ({
		...body,
		position: positions.get(body.bodyId)!
	}));
	if (reconstructed.some(({ position }) => !position.every(Number.isFinite)))
		return 'The reconstructed limiting positions are not finite.';
	const queried = queryCompleteGeometry(input, reconstructed, tolerance);
	if (queried.penetrationEvidence.maximumPenetration > tolerance)
		return `The limiting geometry penetrates by ${queried.penetrationEvidence.maximumPenetration}, beyond tolerance ${tolerance}.`;
	const activeKeys = new Set(queried.activeContacts.map(limitContactKey));
	const residuals = candidateContacts.map((contact) => {
		const separation = contactSeparation(input, reconstructed, contact);
		return {
			contactId: contactKey(contact),
			separation,
			activeAtLimit: activeKeys.has(observedLimitKey(contact))
		};
	});
	if (residuals.some(({ separation }) => !Number.isFinite(separation)))
		return 'A candidate limiting contact has non-finite geometry.';
	return { ...queried, estimates: reconstructed, residuals };
}

function seedFixedCircleIntersections(
	input: SimulationInput,
	bodies: readonly LimitBodyEstimate[],
	positions: Map<string, Vec2>,
	contacts: readonly AccumulationObservedContact[],
	tolerance: number
): void {
	for (const body of bodies) {
		const fixedCircleContacts = contacts.flatMap((contact) => {
			if (contact.type !== 'body-fixed' || contact.bodyId !== body.bodyId) return [];
			const collider = input.scene.staticColliders.find(({ id }) => id === contact.colliderId);
			return collider?.physicalShape.type === 'circle' && 'centre' in collider ? [collider] : [];
		});
		if (fixedCircleContacts.length < 2) continue;
		const candidates: Vec2[] = [];
		for (let firstIndex = 0; firstIndex < fixedCircleContacts.length; firstIndex += 1) {
			for (
				let secondIndex = firstIndex + 1;
				secondIndex < fixedCircleContacts.length;
				secondIndex += 1
			) {
				candidates.push(
					...circleConstraintIntersections(
						fixedCircleContacts[firstIndex]!,
						fixedCircleContacts[secondIndex]!,
						body.radius,
						tolerance
					)
				);
			}
		}
		const current = positions.get(body.bodyId)!;
		const selected = candidates.sort((left, right) => {
			const alignmentDifference =
				fixedCircleNormalAlignment(input, body.bodyId, contacts, right) -
				fixedCircleNormalAlignment(input, body.bodyId, contacts, left);
			return alignmentDifference !== 0
				? alignmentDifference
				: distance(left, current) - distance(right, current);
		})[0];
		if (selected) positions.set(body.bodyId, selected);
	}
}

function fixedCircleNormalAlignment(
	input: SimulationInput,
	bodyId: string,
	contacts: readonly AccumulationObservedContact[],
	position: Vec2
): number {
	return contacts.reduce((score, contact) => {
		if (contact.type !== 'body-fixed' || contact.bodyId !== bodyId) return score;
		const collider = input.scene.staticColliders.find(({ id }) => id === contact.colliderId);
		if (!collider || collider.physicalShape.type !== 'circle' || !('centre' in collider))
			return score;
		const offset: Vec2 = [position[0] - collider.centre[0], position[1] - collider.centre[1]];
		const length = Math.hypot(...offset);
		return length > 0
			? score + (offset[0] * contact.normal[0] + offset[1] * contact.normal[1]) / length
			: score;
	}, 0);
}

function circleConstraintIntersections(
	first: Extract<StaticCollider, { readonly physicalShape: { readonly type: 'circle' } }>,
	second: Extract<StaticCollider, { readonly physicalShape: { readonly type: 'circle' } }>,
	bodyRadius: number,
	tolerance: number
): Vec2[] {
	if (!('centre' in first) || !('centre' in second)) return [];
	const offset: Vec2 = [second.centre[0] - first.centre[0], second.centre[1] - first.centre[1]];
	const centreDistance = Math.hypot(...offset);
	if (!(centreDistance > 0)) return [];
	const firstRadius = first.physicalShape.radius + bodyRadius;
	const secondRadius = second.physicalShape.radius + bodyRadius;
	if (
		centreDistance > firstRadius + secondRadius + tolerance ||
		centreDistance < Math.abs(firstRadius - secondRadius) - tolerance
	)
		return [];
	const along =
		(firstRadius * firstRadius - secondRadius * secondRadius + centreDistance * centreDistance) /
		(2 * centreDistance);
	const heightSquared = firstRadius * firstRadius - along * along;
	if (heightSquared < -2 * Math.max(firstRadius, secondRadius) * tolerance) return [];
	const unit: Vec2 = [offset[0] / centreDistance, offset[1] / centreDistance];
	const base: Vec2 = [first.centre[0] + along * unit[0], first.centre[1] + along * unit[1]];
	const heightToleranceSquared = 2 * Math.max(firstRadius, secondRadius) * tolerance;
	const height = Math.sqrt(heightSquared <= heightToleranceSquared ? 0 : heightSquared);
	if (height === 0) return [base];
	const perpendicular: Vec2 = [-unit[1], unit[0]];
	return [
		[base[0] + height * perpendicular[0], base[1] + height * perpendicular[1]],
		[base[0] - height * perpendicular[0], base[1] - height * perpendicular[1]]
	];
}

function projectContact(
	input: SimulationInput,
	bodies: readonly LimitBodyEstimate[],
	positions: Map<string, Vec2>,
	contact: AccumulationObservedContact,
	tolerance: number
): number {
	if (contact.type === 'body-fixed') {
		const body = bodies.find(({ bodyId }) => bodyId === contact.bodyId);
		const collider = input.scene.staticColliders.find(({ id }) => id === contact.colliderId);
		if (!body || !collider) return Number.NaN;
		const position = positions.get(body.bodyId)!;
		const geometry = fixedGeometry(position, collider, contact.normal);
		if (!geometry) return Number.NaN;
		const separation = geometry.distance - body.radius - geometry.colliderRadius;
		positions.set(body.bodyId, [
			position[0] - separation * geometry.normal[0],
			position[1] - separation * geometry.normal[1]
		]);
		return Math.abs(separation);
	}
	const first = bodies.find(({ bodyId }) => bodyId === contact.firstBodyId);
	const second = bodies.find(({ bodyId }) => bodyId === contact.secondBodyId);
	if (!first || !second) return Number.NaN;
	const firstPosition = positions.get(first.bodyId)!;
	const secondPosition = positions.get(second.bodyId)!;
	const offset: Vec2 = [secondPosition[0] - firstPosition[0], secondPosition[1] - firstPosition[1]];
	const distance = Math.hypot(...offset);
	const normal =
		distance > tolerance
			? ([offset[0] / distance, offset[1] / distance] as Vec2)
			: contact.normalFromFirstToSecond;
	const separation = distance - first.radius - second.radius;
	const totalInverseMass = 1 / first.mass + 1 / second.mass;
	const firstShare = 1 / first.mass / totalInverseMass;
	const secondShare = 1 / second.mass / totalInverseMass;
	positions.set(first.bodyId, [
		firstPosition[0] + separation * firstShare * normal[0],
		firstPosition[1] + separation * firstShare * normal[1]
	]);
	positions.set(second.bodyId, [
		secondPosition[0] - separation * secondShare * normal[0],
		secondPosition[1] - separation * secondShare * normal[1]
	]);
	return Math.abs(separation);
}

function queryCompleteGeometry(
	input: SimulationInput,
	bodies: readonly LimitBodyEstimate[],
	tolerance: number
): Omit<GeometryResult, 'estimates' | 'residuals'> {
	const contacts: AccumulationLimitContact[] = [];
	let maximumPenetration = 0;
	let testedPairCount = 0;
	for (const body of bodies) {
		for (const collider of input.scene.staticColliders) {
			testedPairCount += 1;
			const geometry = fixedGeometry(body.position, collider, [0, 1]);
			if (!geometry) continue;
			const separation = geometry.distance - body.radius - geometry.colliderRadius;
			maximumPenetration = Math.max(maximumPenetration, -separation);
			if (Math.abs(separation) > tolerance) continue;
			contacts.push({
				id: fixedContactId(body.bodyId, collider.id, geometry.feature),
				type: 'body-fixed',
				bodyId: body.bodyId,
				colliderId: collider.id,
				feature: geometry.feature,
				contactPoint: geometry.contactPoint,
				normal: geometry.normal,
				separation
			});
		}
	}
	for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
		for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
			testedPairCount += 1;
			const first = bodies[firstIndex]!;
			const second = bodies[secondIndex]!;
			const offset: Vec2 = [
				second.position[0] - first.position[0],
				second.position[1] - first.position[1]
			];
			const distance = Math.hypot(...offset);
			const separation = distance - first.radius - second.radius;
			maximumPenetration = Math.max(maximumPenetration, -separation);
			if (!(distance > tolerance) || Math.abs(separation) > tolerance) continue;
			const [firstBodyId, secondBodyId] = [first.bodyId, second.bodyId].sort();
			const normal: Vec2 = [offset[0] / distance, offset[1] / distance];
			const directedNormal =
				firstBodyId === first.bodyId ? normal : ([-normal[0], -normal[1]] as Vec2);
			const firstBody = firstBodyId === first.bodyId ? first : second;
			contacts.push({
				id: bodyContactId(firstBodyId, secondBodyId),
				type: 'body-body',
				firstBodyId,
				secondBodyId,
				contactPoint: [
					firstBody.position[0] + firstBody.radius * directedNormal[0],
					firstBody.position[1] + firstBody.radius * directedNormal[1]
				],
				normalFromFirstToSecond: directedNormal,
				separation
			});
		}
	}
	contacts.sort((left, right) => left.id.localeCompare(right.id));
	return {
		activeContacts: contacts,
		connectedComponents: connectedComponents(bodies, contacts),
		penetrationEvidence: {
			maximumPenetration: Math.max(0, maximumPenetration),
			contactDistanceTolerance: tolerance,
			testedPairCount
		}
	};
}

function connectedComponents(
	bodies: readonly LimitBodyEstimate[],
	contacts: readonly AccumulationLimitContact[]
): readonly AccumulationConnectedComponent[] {
	const remaining = new Set(bodies.map(({ bodyId }) => bodyId));
	const components: AccumulationConnectedComponent[] = [];
	while (remaining.size > 0) {
		const seed = [...remaining].sort()[0]!;
		const bodyIds = new Set([seed]);
		remaining.delete(seed);
		let changed = true;
		while (changed) {
			changed = false;
			for (const contact of contacts) {
				if (contact.type !== 'body-body') continue;
				if (!bodyIds.has(contact.firstBodyId) && !bodyIds.has(contact.secondBodyId)) continue;
				for (const bodyId of [contact.firstBodyId, contact.secondBodyId]) {
					if (!remaining.delete(bodyId)) continue;
					bodyIds.add(bodyId);
					changed = true;
				}
			}
		}
		const componentContacts = contacts.filter((contact) =>
			contact.type === 'body-fixed'
				? bodyIds.has(contact.bodyId)
				: bodyIds.has(contact.firstBodyId) && bodyIds.has(contact.secondBodyId)
		);
		const ids = [...bodyIds].sort();
		components.push({
			id: `accumulation-limit-component:${ids.join('+')}`,
			bodyIds: ids,
			fixedColliderIds: [
				...new Set(
					componentContacts.flatMap((contact) =>
						contact.type === 'body-fixed' ? [contact.colliderId] : []
					)
				)
			].sort(),
			contactIds: componentContacts.map(({ id }) => id).sort()
		});
	}
	return components;
}

function contactSeparation(
	input: SimulationInput,
	bodies: readonly LimitBodyEstimate[],
	contact: AccumulationObservedContact
): number {
	if (contact.type === 'body-fixed') {
		const body = bodies.find(({ bodyId }) => bodyId === contact.bodyId)!;
		const collider = input.scene.staticColliders.find(({ id }) => id === contact.colliderId)!;
		const geometry = fixedGeometry(body.position, collider, contact.normal);
		return geometry ? geometry.distance - body.radius - geometry.colliderRadius : Number.NaN;
	}
	const first = bodies.find(({ bodyId }) => bodyId === contact.firstBodyId)!;
	const second = bodies.find(({ bodyId }) => bodyId === contact.secondBodyId)!;
	return (
		Math.hypot(second.position[0] - first.position[0], second.position[1] - first.position[1]) -
		first.radius -
		second.radius
	);
}

function fixedGeometry(position: Vec2, collider: StaticCollider, fallbackNormal: Vec2) {
	if (collider.physicalShape.type === 'circle' && 'centre' in collider) {
		const offset: Vec2 = [position[0] - collider.centre[0], position[1] - collider.centre[1]];
		const distance = Math.hypot(...offset);
		if (!(distance > 0)) return null;
		const normal: Vec2 = [offset[0] / distance, offset[1] / distance];
		return {
			distance,
			colliderRadius: collider.physicalShape.radius,
			contactPoint: [
				collider.centre[0] + collider.physicalShape.radius * normal[0],
				collider.centre[1] + collider.physicalShape.radius * normal[1]
			] as Vec2,
			normal,
			feature: 'circle'
		};
	}
	if (collider.physicalShape.type !== 'line-segment') return null;
	const { start, end } = collider.physicalShape;
	const edge: Vec2 = [end[0] - start[0], end[1] - start[1]];
	const lengthSquared = edge[0] * edge[0] + edge[1] * edge[1];
	if (!(lengthSquared > 0)) return null;
	const parameter = Math.max(
		0,
		Math.min(
			1,
			((position[0] - start[0]) * edge[0] + (position[1] - start[1]) * edge[1]) / lengthSquared
		)
	);
	const contactPoint: Vec2 = [start[0] + parameter * edge[0], start[1] + parameter * edge[1]];
	const offset: Vec2 = [position[0] - contactPoint[0], position[1] - contactPoint[1]];
	const distance = Math.hypot(...offset);
	const normal: Vec2 = distance > 0 ? [offset[0] / distance, offset[1] / distance] : fallbackNormal;
	const cross = edge[0] * (position[1] - start[1]) - edge[1] * (position[0] - start[0]);
	return {
		distance,
		colliderRadius: 0,
		contactPoint,
		normal,
		feature:
			parameter === 0
				? 'start-endpoint'
				: parameter === 1
					? 'end-endpoint'
					: cross >= 0
						? 'segment-face-positive'
						: 'segment-face-negative'
	};
}

function contactKey(contact: AccumulationObservedContact): string {
	return contact.type === 'body-fixed'
		? fixedContactId(contact.bodyId, contact.colliderId, contact.feature)
		: bodyContactId(...([contact.firstBodyId, contact.secondBodyId].sort() as [string, string]));
}

function observedLimitKey(contact: AccumulationObservedContact): string {
	return contact.type === 'body-fixed'
		? `body-fixed:${contact.bodyId}:${contact.colliderId}`
		: `body-body:${[contact.firstBodyId, contact.secondBodyId].sort().join(':')}`;
}

function limitContactKey(contact: AccumulationLimitContact): string {
	return contact.type === 'body-fixed'
		? `body-fixed:${contact.bodyId}:${contact.colliderId}`
		: `body-body:${[contact.firstBodyId, contact.secondBodyId].sort().join(':')}`;
}

function fixedContactId(bodyId: string, colliderId: string, feature: string): string {
	return `accumulation-fixed-contact:${bodyId}:${colliderId}:${feature}`;
}

function bodyContactId(firstBodyId: string, secondBodyId: string): string {
	return `accumulation-body-contact:${firstBodyId}:${secondBodyId}`;
}

function distance(left: Vec2, right: Vec2): number {
	return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
