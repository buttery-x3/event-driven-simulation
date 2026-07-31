import type { ContactEvent, MotionSegment, StaticCircleCollider, Vec2 } from './contracts';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from './trajectory';
import { dotVec2, normaliseVec2 } from './vector';

export interface PegContactTolerances {
	readonly contactDistance: number;
	readonly eventTime: number;
	readonly normalVelocity: number;
	readonly polynomialResidual: number;
}

export const defaultPegContactTolerances = {
	contactDistance: 1e-9,
	eventTime: 1e-9,
	normalVelocity: 1e-9,
	polynomialResidual: 1e-12
} as const satisfies PegContactTolerances;

export interface PegContactQuery {
	readonly segment: MotionSegment;
	readonly ballRadius: number;
	readonly peg: StaticCircleCollider;
	readonly searchUntilTime: number;
	readonly tolerances?: PegContactTolerances;
	readonly maximumRefinementIterations?: number;
}

export type PegContactCandidateClassification =
	'accepted' | 'rejected-separating' | 'rejected-outside-contact-tolerance';

export interface PegContactCandidateDiagnostic {
	readonly time: number;
	readonly polynomialResidual: number;
	readonly surfaceSeparation: number;
	readonly normalVelocity: number | null;
	readonly source: 'boundary' | 'critical-point' | 'bracketed-root';
	readonly refinementIterations: number;
	readonly classification: PegContactCandidateClassification;
}

export interface PegContactDiagnostics {
	readonly searchInterval: readonly [startTime: number, endTime: number];
	readonly normalizedPolynomialCoefficients: readonly number[];
	readonly polynomialScale: number | null;
	readonly refinementIterations: number;
	readonly candidates: readonly PegContactCandidateDiagnostic[];
}

export interface PegContactState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly normal: Vec2;
	readonly normalVelocity: number;
}

export type PegContactQueryResult =
	| {
			readonly type: 'contact';
			readonly event: ContactEvent;
			readonly state: PegContactState;
			readonly diagnostics: PegContactDiagnostics;
	  }
	| {
			readonly type: 'no-contact';
			readonly diagnostics: PegContactDiagnostics;
	  }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly diagnostics: PegContactDiagnostics;
	  }
	| {
			readonly type: 'invalid-input';
			readonly reason: string;
			readonly diagnostics: PegContactDiagnostics;
	  };

interface IsolatedRoot {
	readonly normalizedTime: number;
	readonly source: PegContactCandidateDiagnostic['source'];
	readonly refinementIterations: number;
}

type RootIsolationResult =
	| {
			readonly type: 'roots';
			readonly roots: readonly IsolatedRoot[];
			readonly refinementIterations: number;
	  }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly refinementIterations: number;
	  };

const defaultMaximumRefinementIterations = 128;

export function findEarliestPegContact(query: PegContactQuery): PegContactQueryResult {
	const tolerances = query.tolerances ?? defaultPegContactTolerances;
	const invalidReason = validateQuery(query, tolerances);
	let diagnostics: PegContactDiagnostics = {
		searchInterval: [query.segment.startTime, query.searchUntilTime],
		normalizedPolynomialCoefficients: [],
		polynomialScale: null,
		refinementIterations: 0,
		candidates: []
	};

	if (invalidReason) {
		return { type: 'invalid-input', reason: invalidReason, diagnostics };
	}

	const searchDuration = query.searchUntilTime - query.segment.startTime;
	const combinedRadius = query.ballRadius + query.peg.physicalShape.radius;
	const initialOffset: Vec2 = [
		query.segment.startPosition[0] - query.peg.centre[0],
		query.segment.startPosition[1] - query.peg.centre[1]
	];
	const initialSurfaceSeparation = Math.hypot(initialOffset[0], initialOffset[1]) - combinedRadius;

	if (initialSurfaceSeparation < -tolerances.contactDistance) {
		return {
			type: 'invalid-input',
			reason: 'The motion segment starts with the ball penetrating the peg.',
			diagnostics
		};
	}

	const coefficients = buildContactPolynomial(query, searchDuration, combinedRadius);
	if (!coefficients.every(Number.isFinite)) {
		return {
			type: 'unresolved',
			reason: 'The contact polynomial could not be represented with finite coefficients.',
			diagnostics
		};
	}

	const polynomialScale = Math.max(...coefficients.map(Math.abs));
	if (!Number.isFinite(polynomialScale)) {
		return {
			type: 'unresolved',
			reason: 'The contact polynomial is degenerate across the supported interval.',
			diagnostics: { ...diagnostics, polynomialScale }
		};
	}
	if (polynomialScale === 0) {
		const normal = normaliseVec2(initialOffset, tolerances.contactDistance);
		const velocity = evaluateMotionSegmentVelocity(query.segment, query.segment.startTime);
		if (!normal) {
			return {
				type: 'unresolved',
				reason: 'A stable normal could not be calculated for the degenerate initial contact.',
				diagnostics: { ...diagnostics, polynomialScale }
			};
		}

		const normalVelocity = dotVec2(velocity, normal);
		const candidate: PegContactCandidateDiagnostic = {
			time: query.segment.startTime,
			polynomialResidual: 0,
			surfaceSeparation: Math.abs(initialSurfaceSeparation),
			normalVelocity,
			source: 'boundary',
			refinementIterations: 0,
			classification:
				normalVelocity > tolerances.normalVelocity ? 'rejected-separating' : 'accepted'
		};
		const degenerateDiagnostics = {
			...diagnostics,
			polynomialScale,
			candidates: [candidate]
		};

		if (candidate.classification === 'accepted') {
			const position = evaluateMotionSegmentPosition(query.segment, query.segment.startTime);
			return {
				type: 'contact',
				event: {
					type: 'contact',
					time: query.segment.startTime,
					bodyId: query.segment.bodyId,
					colliderId: query.peg.id,
					position,
					normal
				},
				state: {
					time: query.segment.startTime,
					position,
					velocity,
					normal,
					normalVelocity
				},
				diagnostics: degenerateDiagnostics
			};
		}

		return {
			type: 'unresolved',
			reason: 'The contact polynomial is degenerate across the supported interval.',
			diagnostics: degenerateDiagnostics
		};
	}

	const normalizedCoefficients = coefficients.map((coefficient) => coefficient / polynomialScale);
	diagnostics = {
		...diagnostics,
		normalizedPolynomialCoefficients: normalizedCoefficients,
		polynomialScale
	};

	const rootIsolation = isolateRoots(
		normalizedCoefficients,
		0,
		1,
		tolerances.eventTime / searchDuration,
		tolerances.polynomialResidual,
		query.maximumRefinementIterations ?? defaultMaximumRefinementIterations
	);

	diagnostics = {
		...diagnostics,
		refinementIterations: rootIsolation.refinementIterations
	};

	if (rootIsolation.type === 'unresolved') {
		return {
			type: 'unresolved',
			reason: rootIsolation.reason,
			diagnostics
		};
	}

	const candidateDiagnostics: PegContactCandidateDiagnostic[] = [];

	for (const root of rootIsolation.roots) {
		const time = query.segment.startTime + root.normalizedTime * searchDuration;
		const position = evaluateMotionSegmentPosition(query.segment, time);
		const velocity = evaluateMotionSegmentVelocity(query.segment, time);
		const offset: Vec2 = [position[0] - query.peg.centre[0], position[1] - query.peg.centre[1]];
		const distance = Math.hypot(offset[0], offset[1]);
		const surfaceSeparation = Math.abs(distance - combinedRadius);
		const polynomialResidual = Math.abs(
			evaluatePolynomial(normalizedCoefficients, root.normalizedTime)
		);

		if (!Number.isFinite(surfaceSeparation) || !Number.isFinite(polynomialResidual)) {
			return {
				type: 'unresolved',
				reason: 'A candidate contact could not be evaluated with finite geometry.',
				diagnostics: { ...diagnostics, candidates: candidateDiagnostics }
			};
		}

		if (surfaceSeparation > tolerances.contactDistance) {
			const candidate: PegContactCandidateDiagnostic = {
				time,
				polynomialResidual,
				surfaceSeparation,
				normalVelocity: null,
				source: root.source,
				refinementIterations: root.refinementIterations,
				classification: 'rejected-outside-contact-tolerance'
			};
			candidateDiagnostics.push(candidate);
			return {
				type: 'unresolved',
				reason: 'A mathematical root could not be verified within the contact-distance tolerance.',
				diagnostics: { ...diagnostics, candidates: candidateDiagnostics }
			};
		}

		const normal = normaliseVec2(offset, tolerances.contactDistance);
		if (!normal) {
			return {
				type: 'unresolved',
				reason: 'A stable contact normal could not be calculated for a candidate root.',
				diagnostics: { ...diagnostics, candidates: candidateDiagnostics }
			};
		}

		const normalVelocity = dotVec2(velocity, normal);
		if (!Number.isFinite(normalVelocity)) {
			return {
				type: 'unresolved',
				reason: 'A candidate contact produced a non-finite normal velocity.',
				diagnostics: { ...diagnostics, candidates: candidateDiagnostics }
			};
		}

		const classification =
			normalVelocity > tolerances.normalVelocity ? 'rejected-separating' : 'accepted';
		candidateDiagnostics.push({
			time,
			polynomialResidual,
			surfaceSeparation,
			normalVelocity,
			source: root.source,
			refinementIterations: root.refinementIterations,
			classification
		});

		if (classification === 'accepted') {
			const completedDiagnostics = { ...diagnostics, candidates: candidateDiagnostics };
			return {
				type: 'contact',
				event: {
					type: 'contact',
					time,
					bodyId: query.segment.bodyId,
					colliderId: query.peg.id,
					position,
					normal
				},
				state: { time, position, velocity, normal, normalVelocity },
				diagnostics: completedDiagnostics
			};
		}
	}

	return {
		type: 'no-contact',
		diagnostics: { ...diagnostics, candidates: candidateDiagnostics }
	};
}

function validateQuery(query: PegContactQuery, tolerances: PegContactTolerances): string | null {
	const segment = query.segment;
	const finiteVectors = [
		...segment.startPosition,
		...segment.startVelocity,
		...segment.acceleration,
		...query.peg.centre
	].every(Number.isFinite);

	if (segment.bodyId.trim().length === 0 || query.peg.id.trim().length === 0) {
		return 'Body and peg IDs must be non-empty.';
	}
	if (
		!Number.isFinite(segment.startTime) ||
		!Number.isFinite(segment.endTime) ||
		segment.endTime <= segment.startTime
	) {
		return 'The motion segment must have finite times and end after it starts.';
	}
	if (!finiteVectors) {
		return 'Motion and peg coordinates must contain finite numbers.';
	}
	if (!Number.isFinite(query.ballRadius) || query.ballRadius <= 0) {
		return 'The ball radius must be a positive finite number.';
	}
	if (
		query.peg.motionAuthority !== 'static' ||
		query.peg.physicalShape.type !== 'circle' ||
		!Number.isFinite(query.peg.physicalShape.radius) ||
		query.peg.physicalShape.radius <= 0
	) {
		return 'The peg must be a fixed circle with a positive finite radius.';
	}
	if (
		!Number.isFinite(query.searchUntilTime) ||
		query.searchUntilTime <= segment.startTime ||
		query.searchUntilTime > segment.endTime
	) {
		return 'The search horizon must be after the segment start and no later than its end.';
	}

	const namedTolerances = [
		tolerances.contactDistance,
		tolerances.eventTime,
		tolerances.normalVelocity,
		tolerances.polynomialResidual
	];
	if (namedTolerances.some((tolerance) => !Number.isFinite(tolerance) || tolerance <= 0)) {
		return 'Contact, time, velocity and polynomial tolerances must be positive finite numbers.';
	}
	if (
		query.maximumRefinementIterations !== undefined &&
		(!Number.isInteger(query.maximumRefinementIterations) || query.maximumRefinementIterations < 1)
	) {
		return 'The maximum refinement iteration count must be a positive integer.';
	}

	return null;
}

function buildContactPolynomial(
	query: PegContactQuery,
	searchDuration: number,
	combinedRadius: number
): number[] {
	const relativePosition: Vec2 = [
		query.segment.startPosition[0] - query.peg.centre[0],
		query.segment.startPosition[1] - query.peg.centre[1]
	];
	const scaledVelocity: Vec2 = [
		query.segment.startVelocity[0] * searchDuration,
		query.segment.startVelocity[1] * searchDuration
	];
	const scaledHalfAcceleration: Vec2 = [
		0.5 * query.segment.acceleration[0] * searchDuration * searchDuration,
		0.5 * query.segment.acceleration[1] * searchDuration * searchDuration
	];

	return [
		dotVec2(relativePosition, relativePosition) - combinedRadius * combinedRadius,
		2 * dotVec2(relativePosition, scaledVelocity),
		dotVec2(scaledVelocity, scaledVelocity) + 2 * dotVec2(relativePosition, scaledHalfAcceleration),
		2 * dotVec2(scaledVelocity, scaledHalfAcceleration),
		dotVec2(scaledHalfAcceleration, scaledHalfAcceleration)
	];
}

function isolateRoots(
	inputCoefficients: readonly number[],
	minimum: number,
	maximum: number,
	timeTolerance: number,
	residualTolerance: number,
	maximumIterations: number
): RootIsolationResult {
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
		return {
			type: 'roots',
			roots: [
				{
					normalizedTime: clamp(root, minimum, maximum),
					source: 'bracketed-root',
					refinementIterations: 0
				}
			],
			refinementIterations: 0
		};
	}

	const derivative = coefficients.slice(1).map((coefficient, index) => coefficient * (index + 1));
	const criticalResult = isolateRoots(
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
	const roots: IsolatedRoot[] = [];
	let refinementIterations = criticalResult.refinementIterations;

	for (let index = 0; index < partition.length; index += 1) {
		const point = partition[index]!;
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
				refinementIterations: 0
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
			refinementIterations: refined.iterations
		});
	}

	return {
		type: 'roots',
		roots: deduplicateRoots(roots, timeTolerance),
		refinementIterations
	};
}

function refineBracketedRoot(
	coefficients: readonly number[],
	initialLeft: number,
	initialRight: number,
	initialLeftValue: number,
	timeTolerance: number,
	maximumIterations: number
):
	| { readonly type: 'root'; readonly root: number; readonly iterations: number }
	| { readonly type: 'unresolved'; readonly reason: string; readonly iterations: number } {
	let left = initialLeft;
	let right = initialRight;
	let leftValue = initialLeftValue;

	for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
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
			return { type: 'root', root: midpoint, iterations: iteration };
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
		reason: `Root refinement did not reach the event-time tolerance in ${maximumIterations} iterations.`,
		iterations: maximumIterations
	};
}

function trimPolynomial(coefficients: readonly number[]): number[] {
	const trimmed = [...coefficients];
	while (trimmed.length > 1 && trimmed.at(-1) === 0) trimmed.pop();
	return trimmed;
}

function evaluatePolynomial(coefficients: readonly number[], value: number): number {
	let result = 0;
	for (let index = coefficients.length - 1; index >= 0; index -= 1) {
		result = result * value + coefficients[index]!;
	}
	return result;
}

function deduplicateRoots(roots: readonly IsolatedRoot[], timeTolerance: number): IsolatedRoot[] {
	const sorted = [...roots].sort((left, right) => left.normalizedTime - right.normalizedTime);
	const unique: IsolatedRoot[] = [];

	for (const root of sorted) {
		const previous = unique.at(-1);
		if (!previous || Math.abs(root.normalizedTime - previous.normalizedTime) > timeTolerance) {
			unique.push(root);
		}
	}

	return unique;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
