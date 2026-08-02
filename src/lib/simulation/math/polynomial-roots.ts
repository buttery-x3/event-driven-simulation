export interface IsolatedPolynomialRoot {
	readonly normalizedTime: number;
	readonly source: 'boundary' | 'critical-point' | 'bracketed-root';
	readonly refinementIterations: number;
	readonly isolatingInterval: readonly [minimum: number, maximum: number];
	readonly neighbourhood: {
		readonly before: PolynomialRootNeighbourhoodSample | null;
		readonly after: PolynomialRootNeighbourhoodSample | null;
	};
}

export interface PolynomialRootNeighbourhoodSample {
	readonly normalizedTime: number;
	readonly value: number;
}

type RootEstimate = Omit<IsolatedPolynomialRoot, 'neighbourhood'>;

export type PolynomialRootIsolationResult =
	| {
			readonly type: 'roots';
			readonly roots: readonly IsolatedPolynomialRoot[];
			readonly refinementIterations: number;
	  }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly refinementIterations: number;
	  };

export function isolatePolynomialRoots(
	inputCoefficients: readonly number[],
	minimum: number,
	maximum: number,
	timeTolerance: number,
	residualTolerance: number,
	maximumIterations: number
): PolynomialRootIsolationResult {
	const coefficients = trimPolynomial(inputCoefficients);
	const degree = coefficients.length - 1;

	if (degree < 1) {
		return Math.abs(coefficients[0] ?? 0) <= residualTolerance
			? {
					type: 'unresolved',
					reason: 'The contact polynomial is numerically indistinguishable from zero.',
					refinementIterations: 0
				}
			: { type: 'roots', roots: [], refinementIterations: 0 };
	}

	if (degree === 1) {
		const root = -coefficients[0]! / coefficients[1]!;
		if (!Number.isFinite(root)) {
			return {
				type: 'unresolved',
				reason: 'A linear root could not be represented as a finite number.',
				refinementIterations: 0
			};
		}
		if (root < minimum - timeTolerance || root > maximum + timeTolerance) {
			return { type: 'roots', roots: [], refinementIterations: 0 };
		}
		const estimate: RootEstimate = {
			normalizedTime: clamp(root, minimum, maximum),
			source: 'bracketed-root',
			refinementIterations: 0,
			isolatingInterval: [clamp(root, minimum, maximum), clamp(root, minimum, maximum)]
		};
		return {
			type: 'roots',
			roots: attachRootNeighbourhoods(coefficients, [estimate], minimum, maximum, timeTolerance),
			refinementIterations: 0
		};
	}

	const derivative = coefficients.slice(1).map((coefficient, index) => coefficient * (index + 1));
	const criticalResult = isolatePolynomialRoots(
		derivative,
		minimum,
		maximum,
		timeTolerance,
		residualTolerance,
		maximumIterations
	);
	if (criticalResult.type === 'unresolved') return criticalResult;

	const criticalPoints = deduplicateRoots(criticalResult.roots, timeTolerance)
		.map((root) => root.normalizedTime)
		.filter((root) => root > minimum + timeTolerance && root < maximum - timeTolerance);
	const partition = [minimum, ...criticalPoints, maximum];
	const roots: RootEstimate[] = [];
	let refinementIterations = criticalResult.refinementIterations;

	for (const point of partition) {
		const value = evaluatePolynomial(coefficients, point);
		if (!Number.isFinite(value)) {
			return {
				type: 'unresolved',
				reason: 'The contact polynomial produced a non-finite value during root isolation.',
				refinementIterations
			};
		}
		if (Math.abs(value) <= residualTolerance) {
			roots.push({
				normalizedTime: point,
				source: point === minimum || point === maximum ? 'boundary' : 'critical-point',
				refinementIterations: 0,
				isolatingInterval: [point, point]
			});
		}
	}

	for (let index = 0; index < partition.length - 1; index += 1) {
		const left = partition[index]!;
		const right = partition[index + 1]!;
		const leftValue = evaluatePolynomial(coefficients, left);
		const rightValue = evaluatePolynomial(coefficients, right);

		if (leftValue === 0 || rightValue === 0 || Math.sign(leftValue) === Math.sign(rightValue)) {
			continue;
		}

		const refined = refineBracketedRoot(
			coefficients,
			left,
			right,
			leftValue,
			timeTolerance,
			maximumIterations
		);
		refinementIterations += refined.iterations;
		if (refined.type === 'unresolved') {
			return {
				type: 'unresolved',
				reason: refined.reason,
				refinementIterations
			};
		}
		roots.push({
			normalizedTime: refined.root,
			source: 'bracketed-root',
			refinementIterations: refined.iterations,
			isolatingInterval: refined.interval
		});
	}
	const uniqueRoots = deduplicateRoots(roots, timeTolerance);

	return {
		type: 'roots',
		roots: attachRootNeighbourhoods(coefficients, uniqueRoots, minimum, maximum, timeTolerance),
		refinementIterations
	};
}

export function evaluatePolynomial(coefficients: readonly number[], value: number): number {
	let result = 0;
	for (let index = coefficients.length - 1; index >= 0; index -= 1) {
		result = result * value + coefficients[index]!;
	}
	return result;
}

function refineBracketedRoot(
	coefficients: readonly number[],
	initialLeft: number,
	initialRight: number,
	initialLeftValue: number,
	timeTolerance: number,
	maxIterations: number
):
	| {
			readonly type: 'root';
			readonly root: number;
			readonly interval: readonly [number, number];
			readonly iterations: number;
	  }
	| { readonly type: 'unresolved'; readonly reason: string; readonly iterations: number } {
	let left = initialLeft;
	let right = initialRight;
	let leftValue = initialLeftValue;

	for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
		const midpoint = left + (right - left) / 2;
		const midpointValue = evaluatePolynomial(coefficients, midpoint);
		if (!Number.isFinite(midpointValue)) {
			return {
				type: 'unresolved',
				reason: 'Root refinement produced a non-finite polynomial value.',
				iterations: iteration
			};
		}
		if (midpointValue === 0) {
			return {
				type: 'root',
				root: midpoint,
				interval: [midpoint, midpoint],
				iterations: iteration
			};
		}
		if (right - left <= timeTolerance) {
			const rightValue = evaluatePolynomial(coefficients, right);
			const secantRoot =
				leftValue === rightValue
					? midpoint
					: left - (leftValue * (right - left)) / (rightValue - leftValue);
			return {
				type: 'root',
				root:
					Number.isFinite(secantRoot) && secantRoot >= left && secantRoot <= right
						? secantRoot
						: midpoint,
				interval: [left, right],
				iterations: iteration
			};
		}
		if (Math.sign(leftValue) === Math.sign(midpointValue)) {
			left = midpoint;
			leftValue = midpointValue;
		} else {
			right = midpoint;
		}
	}

	return {
		type: 'unresolved',
		reason: `Root refinement did not reach the event-time tolerance in ${maxIterations} iterations.`,
		iterations: maxIterations
	};
}

function trimPolynomial(coefficients: readonly number[]): number[] {
	const trimmed = [...coefficients];
	while (trimmed.length > 1 && trimmed.at(-1) === 0) trimmed.pop();
	return trimmed;
}

function deduplicateRoots(roots: readonly RootEstimate[], timeTolerance: number): RootEstimate[] {
	const sorted = [...roots].sort((left, right) => left.normalizedTime - right.normalizedTime);
	const unique: RootEstimate[] = [];

	for (const root of sorted) {
		const previous = unique.at(-1);
		if (!previous || Math.abs(root.normalizedTime - previous.normalizedTime) > timeTolerance) {
			unique.push(root);
		}
	}

	return unique;
}

function attachRootNeighbourhoods(
	coefficients: readonly number[],
	roots: readonly RootEstimate[],
	minimum: number,
	maximum: number,
	timeTolerance: number
): IsolatedPolynomialRoot[] {
	return roots.map((root, index) => {
		const previous = roots[index - 1];
		const next = roots[index + 1];
		const leftLimit = previous?.isolatingInterval[1] ?? minimum;
		const rightLimit = next?.isolatingInterval[0] ?? maximum;
		const beforeTime = midpointWhenDistinct(leftLimit, root.isolatingInterval[0], timeTolerance);
		const afterTime = midpointWhenDistinct(root.isolatingInterval[1], rightLimit, timeTolerance);

		return {
			...root,
			neighbourhood: {
				before: beforeTime === null ? null : polynomialSample(coefficients, beforeTime),
				after: afterTime === null ? null : polynomialSample(coefficients, afterTime)
			}
		};
	});
}

function midpointWhenDistinct(left: number, right: number, tolerance: number): number | null {
	return right - left > tolerance ? left + (right - left) / 2 : null;
}

function polynomialSample(
	coefficients: readonly number[],
	normalizedTime: number
): PolynomialRootNeighbourhoodSample {
	return { normalizedTime, value: evaluatePolynomial(coefficients, normalizedTime) };
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
