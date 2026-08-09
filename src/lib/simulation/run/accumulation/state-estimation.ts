import type { AccumulationLimitContact, AccumulationStateResidual, Vec2 } from '../../contracts';
import { projectEqualityCompatible } from '../dynamic-impact';
import type { AccumulationObservation, LimitBodyEstimate, TemporalCertification } from './types';

export function estimateLimitingBodyStates(
	observations: readonly AccumulationObservation[],
	participantBodyIds: readonly string[],
	temporal: TemporalCertification,
	positionResolution: number,
	velocityResolution: number
):
	| {
			readonly estimates: readonly LimitBodyEstimate[];
			readonly residuals: readonly AccumulationStateResidual[];
	  }
	| string {
	const estimates: LimitBodyEstimate[] = [];
	const residuals: AccumulationStateResidual[] = [];
	for (const bodyId of participantBodyIds) {
		const samples = observations
			.map((observation) => observation.bodyStates.find((body) => body.bodyId === bodyId))
			.filter((body): body is NonNullable<typeof body> => body !== undefined);
		if (samples.length < 3)
			return `Body ${bodyId} does not have three finite state samples in the candidate cluster.`;
		const recent = samples.slice(-6);
		if (recent.some((body) => !finite(body.position) || !finite(body.velocity)))
			return `Body ${bodyId} has a non-finite source state.`;
		const current = recent.at(-1)!;
		const previous = recent.at(-2)!;
		const positionStep = distance(current.position, previous.position);
		const velocityStep = distance(current.velocity, previous.velocity);
		const tailScale = temporal.ratioUpperBound / (1 - temporal.ratioUpperBound);
		const positionTailUpperBound = positionStep * tailScale;
		const velocityTailUpperBound = velocityStep * tailScale;
		const position = convergentVec2(
			recent.map(({ position: value }) => value),
			current.position
		);
		const velocity = convergentVec2(
			recent.map(({ velocity: value }) => value),
			current.velocity
		);
		estimates.push({
			...current,
			position,
			velocity,
			currentPosition: current.position,
			currentVelocity: current.velocity,
			positionTailUpperBound,
			velocityTailUpperBound
		});
		residuals.push({
			bodyId,
			currentToLimitPositionDistance: distance(current.position, position),
			positionTailUpperBound,
			positionResolution,
			currentToLimitVelocityDistance: distance(current.velocity, velocity),
			velocityTailUpperBound,
			velocityResolution
		});
	}
	return { estimates, residuals };
}

export function updatePositionResiduals(
	residuals: readonly AccumulationStateResidual[],
	estimates: readonly LimitBodyEstimate[]
): readonly AccumulationStateResidual[] | string {
	return residuals
		.map((residual) => {
			const estimate = estimates.find(({ bodyId }) => bodyId === residual.bodyId)!;
			const distanceToLimit = distance(estimate.currentPosition, estimate.position);
			if (
				distanceToLimit >
				Math.max(residual.positionResolution, residual.positionTailUpperBound * 1.25)
			)
				return null;
			return { ...residual, currentToLimitPositionDistance: distanceToLimit };
		})
		.filter((residual): residual is AccumulationStateResidual => residual !== null).length ===
		residuals.length
		? residuals.map((residual) => {
				const estimate = estimates.find(({ bodyId }) => bodyId === residual.bodyId)!;
				return {
					...residual,
					currentToLimitPositionDistance: distance(estimate.currentPosition, estimate.position)
				};
			})
		: 'Reconstructed limiting geometry exceeds the certified position-tail enclosure.';
}

export function projectLimitingVelocities(
	estimates: readonly LimitBodyEstimate[],
	contacts: readonly AccumulationLimitContact[],
	residuals: readonly AccumulationStateResidual[],
	tolerance: number
):
	| {
			readonly estimates: readonly LimitBodyEstimate[];
			readonly residuals: readonly AccumulationStateResidual[];
	  }
	| string {
	const bodyIndex = new Map(estimates.map(({ bodyId }, index) => [bodyId, index]));
	const velocity = estimates.flatMap(({ velocity: [x, y] }) => [x, y]);
	const inverseMasses = estimates.flatMap(({ mass }) => [1 / mass, 1 / mass]);
	const gradients = contacts.map((contact) => {
		const gradient = Array.from({ length: estimates.length * 2 }, () => 0);
		if (contact.type === 'body-fixed') {
			const index = bodyIndex.get(contact.bodyId)! * 2;
			gradient[index] = contact.normal[0];
			gradient[index + 1] = contact.normal[1];
		} else {
			const firstIndex = bodyIndex.get(contact.firstBodyId)! * 2;
			const secondIndex = bodyIndex.get(contact.secondBodyId)! * 2;
			gradient[firstIndex] = -contact.normalFromFirstToSecond[0];
			gradient[firstIndex + 1] = -contact.normalFromFirstToSecond[1];
			gradient[secondIndex] = contact.normalFromFirstToSecond[0];
			gradient[secondIndex + 1] = contact.normalFromFirstToSecond[1];
		}
		return gradient;
	});
	const projected = projectEqualityCompatible(velocity, gradients, inverseMasses, tolerance);
	if (!projected) return 'The limiting contact-kinematic projection could not be certified.';
	const projectedEstimates = estimates.map((estimate, index) => ({
		...estimate,
		velocity: [projected[index * 2]!, projected[index * 2 + 1]!] as Vec2
	}));
	const projectedResiduals = residuals.map((residual) => {
		const estimate = projectedEstimates.find(({ bodyId }) => bodyId === residual.bodyId)!;
		const distanceToLimit = distance(estimate.currentVelocity, estimate.velocity);
		if (
			distanceToLimit >
			Math.max(residual.velocityResolution, residual.velocityTailUpperBound * 1.25)
		)
			return null;
		return { ...residual, currentToLimitVelocityDistance: distanceToLimit };
	});
	if (projectedResiduals.some((residual) => residual === null))
		return 'The limiting contact-kinematic projection exceeds the certified velocity-tail enclosure.';
	return {
		estimates: projectedEstimates,
		residuals: projectedResiduals as readonly AccumulationStateResidual[]
	};
}

function convergentVec2(samples: readonly Vec2[], fallback: Vec2): Vec2 {
	if (samples.length >= 6) {
		const first = aitkenVec2([samples.at(-6)!, samples.at(-4)!, samples.at(-2)!], fallback);
		const second = aitkenVec2([samples.at(-5)!, samples.at(-3)!, samples.at(-1)!], fallback);
		return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
	}
	return aitkenVec2(samples.slice(-3), fallback);
}

function aitkenVec2(samples: readonly Vec2[], fallback: Vec2): Vec2 {
	return [
		aitken(samples[0]![0], samples[1]![0], samples[2]![0], fallback[0]),
		aitken(samples[0]![1], samples[1]![1], samples[2]![1], fallback[1])
	];
}

function aitken(first: number, second: number, third: number, fallback: number): number {
	const denominator = third - 2 * second + first;
	const scale = Math.max(1, Math.abs(first), Math.abs(second), Math.abs(third));
	if (Math.abs(denominator) <= Number.EPSILON * scale * 512) return fallback;
	const estimate = first - ((second - first) * (second - first)) / denominator;
	return Number.isFinite(estimate) ? estimate : fallback;
}

function finite(vector: Vec2): boolean {
	return vector.every(Number.isFinite);
}

function distance(left: Vec2, right: Vec2): number {
	return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
