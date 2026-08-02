import type { Vec2 } from '../contracts';
import { evaluatePolynomial, type IsolatedPolynomialRoot } from '../math';
import { dotVec2, normaliseVec2 } from '../math';
import type {
	BoundaryContactCandidateClassification,
	BoundaryContactCandidateDiagnostic,
	BoundaryContactFeature,
	BoundaryContactQuery,
	BoundaryContactTolerances
} from './boundary-contact';

export interface BoundaryFeatureRoot extends IsolatedPolynomialRoot {
	readonly feature: BoundaryContactFeature;
	readonly normalizedCoefficients: readonly number[];
}

export function evaluateBoundaryCandidate(
	query: BoundaryContactQuery,
	root: BoundaryFeatureRoot,
	time: number,
	position: Vec2,
	velocity: Vec2,
	start: Vec2,
	end: Vec2,
	tangent: Vec2,
	positiveNormal: Vec2,
	segmentLength: number,
	tangentCoordinate: number,
	tolerances: BoundaryContactTolerances
):
	| { readonly type: 'evaluated'; readonly diagnostic: BoundaryContactCandidateDiagnostic }
	| {
			readonly type: 'unresolved';
			readonly reason: string;
			readonly diagnostic: BoundaryContactCandidateDiagnostic;
	  } {
	const polynomialResidual = Math.abs(
		evaluatePolynomial(root.normalizedCoefficients, root.normalizedTime)
	);

	if (root.feature.startsWith('segment-face')) {
		return evaluateFaceCandidate(
			query,
			root,
			time,
			position,
			velocity,
			start,
			tangent,
			positiveNormal,
			segmentLength,
			tangentCoordinate,
			tolerances,
			polynomialResidual
		);
	}

	return evaluateEndpointCandidate(
		query,
		root,
		time,
		position,
		velocity,
		start,
		end,
		segmentLength,
		tangentCoordinate,
		tolerances,
		polynomialResidual
	);
}

function evaluateFaceCandidate(
	query: BoundaryContactQuery,
	root: BoundaryFeatureRoot,
	time: number,
	position: Vec2,
	velocity: Vec2,
	start: Vec2,
	tangent: Vec2,
	positiveNormal: Vec2,
	segmentLength: number,
	tangentCoordinate: number,
	tolerances: BoundaryContactTolerances,
	polynomialResidual: number
) {
	const side = root.feature === 'segment-face-positive' ? 1 : -1;
	const normal: Vec2 = [positiveNormal[0] * side, positiveNormal[1] * side];
	const signedDistance = dotVec2(
		[position[0] - start[0], position[1] - start[1]],
		positiveNormal
	);
	const surfaceSeparation = Math.abs(signedDistance - side * query.ballRadius);
	const normalVelocity = dotVec2(velocity, normal);
	const contactPoint: Vec2 = [
		start[0] + tangent[0] * clamp(tangentCoordinate, 0, segmentLength),
		start[1] + tangent[1] * clamp(tangentCoordinate, 0, segmentLength)
	];
	let classification: BoundaryContactCandidateClassification =
		tangentCoordinate < -tolerances.contactDistance ||
		tangentCoordinate > segmentLength + tolerances.contactDistance
			? 'rejected-outside-extent'
			: normalVelocity > tolerances.normalVelocity
				? 'rejected-separating'
				: 'accepted';

	if (surfaceSeparation > tolerances.contactDistance) {
		classification = 'rejected-outside-contact-tolerance';
	}

	const diagnostic = {
		time,
		feature: root.feature,
		source: root.source,
		centrePosition: position,
		contactPoint,
		normal,
		normalVelocity,
		surfaceSeparation,
		tangentCoordinate,
		polynomialResidual,
		refinementIterations: root.refinementIterations,
		classification
	} satisfies BoundaryContactCandidateDiagnostic;

	return classification === 'rejected-outside-contact-tolerance'
		? {
				type: 'unresolved' as const,
				reason: 'A boundary-face root could not be verified within the contact-distance tolerance.',
				diagnostic
			}
		: { type: 'evaluated' as const, diagnostic };
}

function evaluateEndpointCandidate(
	query: BoundaryContactQuery,
	root: BoundaryFeatureRoot,
	time: number,
	position: Vec2,
	velocity: Vec2,
	start: Vec2,
	end: Vec2,
	segmentLength: number,
	tangentCoordinate: number,
	tolerances: BoundaryContactTolerances,
	polynomialResidual: number
) {
	const endpoint = root.feature === 'start-endpoint' ? start : end;
	const offset: Vec2 = [position[0] - endpoint[0], position[1] - endpoint[1]];
	const distance = Math.hypot(offset[0], offset[1]);
	const surfaceSeparation = Math.abs(distance - query.ballRadius);
	const normal = normaliseVec2(offset, tolerances.contactDistance);
	const isOwnedByEndpoint =
		root.feature === 'start-endpoint'
			? tangentCoordinate <= tolerances.contactDistance
			: tangentCoordinate >= segmentLength - tolerances.contactDistance;
	const contactPoint = endpoint;

	if (!Number.isFinite(surfaceSeparation) || !Number.isFinite(polynomialResidual) || !normal) {
		const diagnostic = {
			time,
			feature: root.feature,
			source: root.source,
			centrePosition: position,
			contactPoint,
			normal,
			normalVelocity: null,
			surfaceSeparation,
			tangentCoordinate,
			polynomialResidual,
			refinementIterations: root.refinementIterations,
			classification: 'rejected-outside-contact-tolerance'
		} satisfies BoundaryContactCandidateDiagnostic;
		return {
			type: 'unresolved' as const,
			reason: 'A stable endpoint contact geometry could not be calculated.',
			diagnostic
		};
	}

	const normalVelocity = dotVec2(velocity, normal);
	let classification: BoundaryContactCandidateClassification = !isOwnedByEndpoint
		? 'rejected-shadowed-by-face'
		: normalVelocity > tolerances.normalVelocity
			? 'rejected-separating'
			: 'accepted';
	if (surfaceSeparation > tolerances.contactDistance) {
		classification = 'rejected-outside-contact-tolerance';
	}

	const diagnostic = {
		time,
		feature: root.feature,
		source: root.source,
		centrePosition: position,
		contactPoint,
		normal,
		normalVelocity,
		surfaceSeparation,
		tangentCoordinate,
		polynomialResidual,
		refinementIterations: root.refinementIterations,
		classification
	} satisfies BoundaryContactCandidateDiagnostic;

	return classification === 'rejected-outside-contact-tolerance'
		? {
				type: 'unresolved' as const,
				reason: 'An endpoint root could not be verified within the contact-distance tolerance.',
				diagnostic
			}
		: { type: 'evaluated' as const, diagnostic };
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
