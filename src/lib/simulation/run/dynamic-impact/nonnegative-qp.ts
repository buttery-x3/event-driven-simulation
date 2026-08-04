import {
	dot,
	gramMatrix,
	multiplyMatrixVector,
	pseudoInverseSolveSymmetric
} from './linear-algebra';

export interface NonnegativeQuadraticSolution {
	readonly values: readonly number[];
	readonly objective: number;
}

export function solveNonnegativeQuadratic(
	hessian: readonly (readonly number[])[],
	linear: readonly number[],
	tolerance: number
): NonnegativeQuadraticSolution | null {
	const size = linear.length;
	if (size > 16 || hessian.length !== size) return null;
	let best: NonnegativeQuadraticSolution | null = null;
	for (let mask = 0; mask < 2 ** size; mask += 1) {
		const active = Array.from({ length: size }, (_, index) => index).filter(
			(index) => (mask & (2 ** index)) !== 0
		);
		const values = linear.map(() => 0);
		if (active.length > 0) {
			const submatrix = active.map((row) => active.map((column) => hessian[row]![column]!));
			const solved = pseudoInverseSolveSymmetric(
				submatrix,
				active.map((index) => -linear[index]!),
				tolerance
			);
			if (!solved) continue;
			for (let index = 0; index < active.length; index += 1)
				values[active[index]!] = solved[index]!;
		}
		if (values.some((value) => value < -tolerance || !Number.isFinite(value))) continue;
		const gradient = multiplyMatrixVector(hessian, values).map(
			(value, index) => value + linear[index]!
		);
		if (gradient.some((value) => value < -tolerance * 16)) continue;
		if (active.some((index) => Math.abs(gradient[index]!) > tolerance * 16)) continue;
		const normalized = values.map((value) => (Math.abs(value) <= tolerance ? 0 : value));
		const objective =
			0.5 * dot(normalized, multiplyMatrixVector(hessian, normalized)) + dot(linear, normalized);
		const candidate = { values: normalized, objective };
		if (isPreferred(candidate, best, tolerance)) best = candidate;
	}
	return best;
}

export function solveNonnegativeLeastSquares(
	columns: readonly (readonly number[])[],
	target: readonly number[],
	tolerance: number
): { readonly values: readonly number[]; readonly residualNorm: number } | null {
	if (columns.length === 0) {
		return { values: [], residualNorm: Math.sqrt(dot(target, target)) };
	}
	const hessian = gramMatrix(columns);
	const linear = columns.map((column) => -dot(column, target));
	const solution = solveNonnegativeQuadratic(hessian, linear, tolerance);
	if (!solution) return null;
	const reconstructed = target.map((_, row) =>
		columns.reduce((sum, column, index) => sum + column[row]! * solution.values[index]!, 0)
	);
	const residual = reconstructed.map((value, index) => value - target[index]!);
	return { values: solution.values, residualNorm: Math.sqrt(dot(residual, residual)) };
}

function isPreferred(
	candidate: NonnegativeQuadraticSolution,
	best: NonnegativeQuadraticSolution | null,
	tolerance: number
): boolean {
	if (!best || candidate.objective < best.objective - tolerance) return true;
	if (Math.abs(candidate.objective - best.objective) > tolerance) return false;
	const candidateNorm = dot(candidate.values, candidate.values);
	const bestNorm = dot(best.values, best.values);
	if (candidateNorm < bestNorm - tolerance) return true;
	if (Math.abs(candidateNorm - bestNorm) > tolerance) return false;
	for (let index = 0; index < candidate.values.length; index += 1) {
		if (candidate.values[index]! < best.values[index]! - tolerance) return true;
		if (candidate.values[index]! > best.values[index]! + tolerance) return false;
	}
	return false;
}
