export type Matrix = readonly (readonly number[])[];

export function dot(left: readonly number[], right: readonly number[]): number {
	let result = 0;
	for (let index = 0; index < left.length; index += 1) result += left[index]! * right[index]!;
	return result;
}

export function addScaled(
	target: readonly number[],
	vector: readonly number[],
	scale: number
): number[] {
	return target.map((value, index) => value + scale * vector[index]!);
}

export function multiplyMatrixVector(matrix: Matrix, vector: readonly number[]): number[] {
	return matrix.map((row) => dot(row, vector));
}

export function gramMatrix(
	columns: readonly (readonly number[])[],
	weights?: readonly number[]
): number[][] {
	return columns.map((left) =>
		columns.map((right) =>
			left.reduce(
				(sum, value, index) => sum + value * right[index]! * (weights?.[index] ?? 1),
				0
			)
		)
	);
}

export function weightedNorm(vector: readonly number[], weights: readonly number[]): number {
	return Math.sqrt(Math.max(0, vector.reduce((sum, value, i) => sum + weights[i]! * value * value, 0)));
}

export function pseudoInverseSolveSymmetric(
	matrix: Matrix,
	rightHandSide: readonly number[],
	tolerance: number
): number[] | null {
	if (matrix.length === 0) return [];
	const decomposition = jacobiEigenDecomposition(matrix, tolerance);
	if (!decomposition) return null;
	const scale = Math.max(1, ...decomposition.values.map(Math.abs));
	const cutoff = tolerance * scale;
	const result = matrix.map(() => 0);
	for (let column = 0; column < matrix.length; column += 1) {
		const eigenvalue = decomposition.values[column]!;
		if (Math.abs(eigenvalue) <= cutoff) continue;
		const eigenvector = decomposition.vectors.map((row) => row[column]!);
		const coefficient = dot(eigenvector, rightHandSide) / eigenvalue;
		for (let row = 0; row < result.length; row += 1)
			result[row] += coefficient * eigenvector[row]!;
	}
	return result.every(Number.isFinite) ? result : null;
}

export function independentBasis(
	vectors: readonly (readonly number[])[],
	tolerance: number
): number[][] {
	const result: number[][] = [];
	for (const vector of vectors) {
		let residual = [...vector];
		for (const basis of result) residual = addScaled(residual, basis, -dot(residual, basis));
		const length = Math.sqrt(dot(residual, residual));
		if (length <= tolerance) continue;
		result.push(residual.map((value) => value / length));
	}
	return result;
}

function jacobiEigenDecomposition(
	input: Matrix,
	tolerance: number
): { readonly values: number[]; readonly vectors: number[][] } | null {
	const size = input.length;
	if (input.some((row) => row.length !== size || !row.every(Number.isFinite))) return null;
	const matrix = input.map((row) => [...row]);
	const vectors = Array.from({ length: size }, (_, row) =>
		Array.from({ length: size }, (_, column) => (row === column ? 1 : 0))
	);
	const maximumIterations = Math.max(32, size * size * 64);
	for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
		let pivotRow = 0;
		let pivotColumn = 0;
		let maximum = 0;
		for (let row = 0; row < size; row += 1) {
			for (let column = row + 1; column < size; column += 1) {
				const value = Math.abs(matrix[row]![column]!);
				if (value > maximum) {
					maximum = value;
					pivotRow = row;
					pivotColumn = column;
				}
			}
		}
		const diagonalScale = Math.max(1, ...matrix.map((row, index) => Math.abs(row[index]!)));
		if (maximum <= tolerance * diagonalScale) {
			return { values: matrix.map((row, index) => row[index]!), vectors };
		}
		rotate(matrix, vectors, pivotRow, pivotColumn);
	}
	return null;
}

function rotate(matrix: number[][], vectors: number[][], row: number, column: number): void {
	const diagonalDifference = matrix[column]![column]! - matrix[row]![row]!;
	const angle = 0.5 * Math.atan2(2 * matrix[row]![column]!, diagonalDifference);
	const cosine = Math.cos(angle);
	const sine = Math.sin(angle);
	for (let index = 0; index < matrix.length; index += 1) {
		if (index === row || index === column) continue;
		const left = matrix[index]![row]!;
		const right = matrix[index]![column]!;
		matrix[index]![row] = matrix[row]![index] = cosine * left - sine * right;
		matrix[index]![column] = matrix[column]![index] = sine * left + cosine * right;
	}
	const leftDiagonal = matrix[row]![row]!;
	const rightDiagonal = matrix[column]![column]!;
	const coupling = matrix[row]![column]!;
	matrix[row]![row] =
		cosine * cosine * leftDiagonal - 2 * sine * cosine * coupling + sine * sine * rightDiagonal;
	matrix[column]![column] =
		sine * sine * leftDiagonal + 2 * sine * cosine * coupling + cosine * cosine * rightDiagonal;
	matrix[row]![column] = matrix[column]![row] = 0;
	for (let index = 0; index < vectors.length; index += 1) {
		const left = vectors[index]![row]!;
		const right = vectors[index]![column]!;
		vectors[index]![row] = cosine * left - sine * right;
		vectors[index]![column] = sine * left + cosine * right;
	}
}
