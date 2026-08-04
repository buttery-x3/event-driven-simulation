import { addScaled, dot, gramMatrix, independentBasis, pseudoInverseSolveSymmetric } from './linear-algebra';
import { solveNonnegativeLeastSquares } from './nonnegative-qp';

export interface LinealityResult {
	readonly basis: readonly (readonly number[])[];
	readonly contactIndices: readonly number[];
}

export function detectLineality(
	gradients: readonly (readonly number[])[],
	tolerance: number
): LinealityResult {
	const members = new Set<number>();
	for (let index = 0; index < gradients.length; index += 1) {
		const others = gradients.filter((_, candidate) => candidate !== index);
		const representation = solveNonnegativeLeastSquares(
			others,
			gradients[index]!.map((value) => -value),
			tolerance
		);
		const scale = Math.max(1, Math.sqrt(dot(gradients[index]!, gradients[index]!)));
		if (!representation || representation.residualNorm > tolerance * scale * 16) continue;
		members.add(index);
		let otherIndex = 0;
		for (let candidate = 0; candidate < gradients.length; candidate += 1) {
			if (candidate === index) continue;
			if ((representation.values[otherIndex] ?? 0) > tolerance) members.add(candidate);
			otherIndex += 1;
		}
	}
	const contactIndices = [...members].sort((left, right) => left - right);
	return {
		contactIndices,
		basis: independentBasis(
			contactIndices.map((index) => gradients[index]!),
			tolerance * 16
		)
	};
}

export function projectEqualityCompatible(
	vector: readonly number[],
	basis: readonly (readonly number[])[],
	inverseMasses: readonly number[],
	tolerance: number
): number[] | null {
	if (basis.length === 0) return [...vector];
	const system = gramMatrix(basis, inverseMasses);
	const multipliers = pseudoInverseSolveSymmetric(
		system,
		basis.map((direction) => dot(direction, vector)),
		tolerance
	);
	if (!multipliers) return null;
	let projected = [...vector];
	for (let index = 0; index < basis.length; index += 1) {
		const correction = basis[index]!.map(
			(value, coordinate) => inverseMasses[coordinate]! * value
		);
		projected = addScaled(projected, correction, -multipliers[index]!);
	}
	return projected;
}
