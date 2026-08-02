import type {
	ConstantAccelerationMotionSegment,
	ContactEvent,
	StaticLineSegmentCollider,
	Vec2
} from '../contracts';
import { isolatePolynomialRoots, type IsolatedPolynomialRoot } from '../math';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../motion';
import { dotVec2 } from '../math';
import { evaluateBoundaryCandidate, type BoundaryFeatureRoot } from './boundary-candidate';
import { validateBoundaryContactQuery } from './boundary-query-validation';

export interface BoundaryContactTolerances {
	readonly contactDistance: number;
	readonly eventTime: number;
	readonly normalVelocity: number;
	readonly polynomialResidual: number;
}

export const defaultBoundaryContactTolerances = {
	contactDistance: 1e-9,
	eventTime: 1e-9,
	normalVelocity: 1e-9,
	polynomialResidual: 1e-12
} as const satisfies BoundaryContactTolerances;

export interface BoundaryContactQuery {
	readonly segment: ConstantAccelerationMotionSegment;
	readonly ballRadius: number;
	readonly boundary: StaticLineSegmentCollider;
	readonly searchUntilTime: number;
	readonly tolerances?: BoundaryContactTolerances;
	readonly maximumRefinementIterations?: number;
	readonly ignoreInitialContact?: boolean;
}

export type BoundaryContactFeature =
	'segment-face-negative' | 'segment-face-positive' | 'start-endpoint' | 'end-endpoint';

export type BoundaryContactCandidateClassification =
	| 'accepted'
	| 'rejected-separating'
	| 'rejected-initial-contact'
	| 'rejected-outside-extent'
	| 'rejected-shadowed-by-face'
	| 'rejected-outside-contact-tolerance';

export interface BoundaryContactCandidateDiagnostic {
	readonly time: number;
	readonly feature: BoundaryContactFeature;
	readonly source: IsolatedPolynomialRoot['source'];
	readonly centrePosition: Vec2;
	readonly contactPoint: Vec2;
	readonly normal: Vec2 | null;
	readonly normalVelocity: number | null;
	readonly surfaceSeparation: number;
	readonly tangentCoordinate: number;
	readonly polynomialResidual: number;
	readonly refinementIterations: number;
	readonly classification: BoundaryContactCandidateClassification;
}

export interface BoundaryContactDiagnostics {
	readonly searchInterval: readonly [startTime: number, endTime: number];
	readonly segmentLength: number | null;
	readonly refinementIterations: number;
	readonly candidates: readonly BoundaryContactCandidateDiagnostic[];
}

export interface BoundaryContactState {
	readonly time: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly contactPoint: Vec2;
	readonly normal: Vec2;
	readonly normalVelocity: number;
	readonly feature: BoundaryContactFeature;
}

export type BoundaryContactQueryResult =
	| {
			readonly type: 'contact';
			readonly event: ContactEvent;
			readonly state: BoundaryContactState;
			readonly diagnostics: BoundaryContactDiagnostics;
	  }
	| {
			readonly type: 'no-contact';
			readonly diagnostics: BoundaryContactDiagnostics;
	  }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly diagnostics: BoundaryContactDiagnostics;
	  }
	| {
			readonly type: 'invalid-input';
			readonly reason: string;
			readonly diagnostics: BoundaryContactDiagnostics;
	  };

const defaultMaximumRefinementIterations = 128;

const featureOrder: Readonly<Record<BoundaryContactFeature, number>> = {
	'segment-face-negative': 0,
	'segment-face-positive': 1,
	'start-endpoint': 2,
	'end-endpoint': 3
};

export function findEarliestBoundaryContact(
	query: BoundaryContactQuery
): BoundaryContactQueryResult {
	const tolerances = query.tolerances ?? defaultBoundaryContactTolerances;
	const invalidReason = validateBoundaryContactQuery(query, tolerances);
	let diagnostics: BoundaryContactDiagnostics = {
		searchInterval: [query.segment.startTime, query.searchUntilTime],
		segmentLength: null,
		refinementIterations: 0,
		candidates: []
	};

	if (invalidReason) {
		return { type: 'invalid-input', reason: invalidReason, diagnostics };
	}

	const start = query.boundary.physicalShape.start;
	const end = query.boundary.physicalShape.end;
	const delta: Vec2 = [end[0] - start[0], end[1] - start[1]];
	const segmentLength = Math.hypot(delta[0], delta[1]);
	const tangent: Vec2 = [delta[0] / segmentLength, delta[1] / segmentLength];
	const positiveNormal: Vec2 = [-tangent[1], tangent[0]];
	diagnostics = { ...diagnostics, segmentLength };

	const initialDistance = distanceToSegment(
		query.segment.startPosition,
		start,
		tangent,
		segmentLength
	);
	if (initialDistance < query.ballRadius - tolerances.contactDistance) {
		return {
			type: 'invalid-input',
			reason: 'The motion segment starts with the ball penetrating the boundary.',
			diagnostics
		};
	}

	const searchDuration = query.searchUntilTime - query.segment.startTime;
	const featurePolynomials = buildFeaturePolynomials(
		query,
		start,
		end,
		positiveNormal,
		searchDuration
	);
	const roots: BoundaryFeatureRoot[] = [];

	for (const { feature, coefficients } of featurePolynomials) {
		if (!coefficients.every(Number.isFinite)) {
			return {
				type: 'unresolved',
				reason: `The ${feature} contact polynomial could not be represented with finite coefficients.`,
				diagnostics
			};
		}

		const polynomialScale = Math.max(...coefficients.map(Math.abs));
		if (!Number.isFinite(polynomialScale)) {
			return {
				type: 'unresolved',
				reason: `The ${feature} contact polynomial has no finite scale.`,
				diagnostics
			};
		}

		if (polynomialScale === 0) {
			roots.push({
				feature,
				normalizedTime: 0,
				source: 'boundary',
				refinementIterations: 0,
				isolatingInterval: [0, 0],
				neighbourhood: { before: null, after: null },
				normalizedCoefficients: coefficients
			});
			continue;
		}

		const normalizedCoefficients = coefficients.map((coefficient) => coefficient / polynomialScale);
		const rootIsolation = isolatePolynomialRoots(
			normalizedCoefficients,
			0,
			1,
			tolerances.eventTime / searchDuration,
			tolerances.polynomialResidual,
			query.maximumRefinementIterations ?? defaultMaximumRefinementIterations
		);
		diagnostics = {
			...diagnostics,
			refinementIterations: diagnostics.refinementIterations + rootIsolation.refinementIterations
		};

		if (rootIsolation.type === 'unresolved') {
			return {
				type: 'unresolved',
				reason: `${feature}: ${rootIsolation.reason}`,
				diagnostics
			};
		}

		roots.push(
			...rootIsolation.roots.map((root) => ({
				...root,
				feature,
				normalizedCoefficients
			}))
		);
	}

	roots.sort(
		(left, right) =>
			left.normalizedTime - right.normalizedTime ||
			featureOrder[left.feature] - featureOrder[right.feature]
	);

	const candidateDiagnostics: BoundaryContactCandidateDiagnostic[] = [];

	for (const root of roots) {
		const time = query.segment.startTime + root.normalizedTime * searchDuration;
		const position = evaluateMotionSegmentPosition(query.segment, time);
		const velocity = evaluateMotionSegmentVelocity(query.segment, time);
		const tangentCoordinate = dotVec2([position[0] - start[0], position[1] - start[1]], tangent);
		const candidateResult = evaluateBoundaryCandidate(
			query,
			root,
			time,
			position,
			velocity,
			start,
			end,
			tangent,
			positiveNormal,
			segmentLength,
			tangentCoordinate,
			tolerances
		);

		const diagnostic =
			query.ignoreInitialContact &&
			candidateResult.diagnostic.classification === 'accepted' &&
			time - query.segment.startTime <= tolerances.eventTime
				? { ...candidateResult.diagnostic, classification: 'rejected-initial-contact' as const }
				: candidateResult.diagnostic;
		candidateDiagnostics.push(diagnostic);
		diagnostics = { ...diagnostics, candidates: candidateDiagnostics };

		if (candidateResult.type === 'unresolved') {
			return {
				type: 'unresolved',
				reason: candidateResult.reason,
				diagnostics
			};
		}

		if (diagnostic.classification === 'accepted') {
			const normal = diagnostic.normal!;
			const normalVelocity = diagnostic.normalVelocity!;
			return {
				type: 'contact',
				event: {
					type: 'contact',
					time,
					bodyId: query.segment.bodyId,
					colliderId: query.boundary.id,
					position,
					normal
				},
				state: {
					time,
					position,
					velocity,
					contactPoint: diagnostic.contactPoint,
					normal,
					normalVelocity,
					feature: root.feature
				},
				diagnostics
			};
		}
	}

	return { type: 'no-contact', diagnostics };
}

function buildFeaturePolynomials(
	query: BoundaryContactQuery,
	start: Vec2,
	end: Vec2,
	positiveNormal: Vec2,
	searchDuration: number
): readonly {
	readonly feature: BoundaryContactFeature;
	readonly coefficients: readonly number[];
}[] {
	const initialFromStart: Vec2 = [
		query.segment.startPosition[0] - start[0],
		query.segment.startPosition[1] - start[1]
	];
	const normalPosition = dotVec2(initialFromStart, positiveNormal);
	const normalVelocity = dotVec2(query.segment.startVelocity, positiveNormal);
	const normalAcceleration = dotVec2(query.segment.acceleration, positiveNormal);

	return [
		{
			feature: 'segment-face-negative',
			coefficients: [
				normalPosition + query.ballRadius,
				normalVelocity * searchDuration,
				0.5 * normalAcceleration * searchDuration * searchDuration
			]
		},
		{
			feature: 'segment-face-positive',
			coefficients: [
				normalPosition - query.ballRadius,
				normalVelocity * searchDuration,
				0.5 * normalAcceleration * searchDuration * searchDuration
			]
		},
		{
			feature: 'start-endpoint',
			coefficients: buildPointContactPolynomial(query, start, searchDuration)
		},
		{
			feature: 'end-endpoint',
			coefficients: buildPointContactPolynomial(query, end, searchDuration)
		}
	];
}

function buildPointContactPolynomial(
	query: BoundaryContactQuery,
	point: Vec2,
	searchDuration: number
): readonly number[] {
	const relativePosition: Vec2 = [
		query.segment.startPosition[0] - point[0],
		query.segment.startPosition[1] - point[1]
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
		dotVec2(relativePosition, relativePosition) - query.ballRadius * query.ballRadius,
		2 * dotVec2(relativePosition, scaledVelocity),
		dotVec2(scaledVelocity, scaledVelocity) + 2 * dotVec2(relativePosition, scaledHalfAcceleration),
		2 * dotVec2(scaledVelocity, scaledHalfAcceleration),
		dotVec2(scaledHalfAcceleration, scaledHalfAcceleration)
	];
}

function distanceToSegment(point: Vec2, start: Vec2, tangent: Vec2, segmentLength: number): number {
	const tangentCoordinate = dotVec2([point[0] - start[0], point[1] - start[1]], tangent);
	const clampedCoordinate = clamp(tangentCoordinate, 0, segmentLength);
	const closestPoint: Vec2 = [
		start[0] + tangent[0] * clampedCoordinate,
		start[1] + tangent[1] * clampedCoordinate
	];
	return Math.hypot(point[0] - closestPoint[0], point[1] - closestPoint[1]);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
