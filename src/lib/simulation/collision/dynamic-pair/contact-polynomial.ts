import type { Vec2 } from '../../contracts';
import { dotVec2 } from '../../math';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../motion';
import type {
	DynamicCirclePathParticipant,
	DynamicPairContactState,
	PolynomialDynamicCirclePath
} from './types';

export interface RelativePairPolynomial {
	readonly relativeCoefficients: readonly [Vec2, Vec2, Vec2];
	readonly polynomialCoefficients: readonly number[];
}

export function buildDynamicPairContactPolynomial(
	first: DynamicCirclePathParticipant & { readonly path: PolynomialDynamicCirclePath },
	second: DynamicCirclePathParticipant & { readonly path: PolynomialDynamicCirclePath },
	startTime: number,
	duration: number
): RelativePairPolynomial {
	const firstPosition = evaluateMotionSegmentPosition(first.path, startTime);
	const secondPosition = evaluateMotionSegmentPosition(second.path, startTime);
	const firstVelocity = evaluateMotionSegmentVelocity(first.path, startTime);
	const secondVelocity = evaluateMotionSegmentVelocity(second.path, startTime);
	const firstAcceleration = pathAcceleration(first.path);
	const secondAcceleration = pathAcceleration(second.path);
	const relativePosition: Vec2 = [
		secondPosition[0] - firstPosition[0],
		secondPosition[1] - firstPosition[1]
	];
	const scaledRelativeVelocity: Vec2 = [
		duration * (secondVelocity[0] - firstVelocity[0]),
		duration * (secondVelocity[1] - firstVelocity[1])
	];
	const scaledHalfRelativeAcceleration: Vec2 = [
		0.5 * duration ** 2 * (secondAcceleration[0] - firstAcceleration[0]),
		0.5 * duration ** 2 * (secondAcceleration[1] - firstAcceleration[1])
	];
	const combinedRadius = first.radius + second.radius;
	return {
		relativeCoefficients: [
			relativePosition,
			scaledRelativeVelocity,
			scaledHalfRelativeAcceleration
		],
		polynomialCoefficients: [
			dotVec2(relativePosition, relativePosition) - combinedRadius ** 2,
			2 * dotVec2(relativePosition, scaledRelativeVelocity),
			dotVec2(scaledRelativeVelocity, scaledRelativeVelocity) +
				2 * dotVec2(relativePosition, scaledHalfRelativeAcceleration),
			2 * dotVec2(scaledRelativeVelocity, scaledHalfRelativeAcceleration),
			dotVec2(scaledHalfRelativeAcceleration, scaledHalfRelativeAcceleration)
		]
	};
}

export function evaluateDynamicPairCandidate(
	first: DynamicCirclePathParticipant,
	second: DynamicCirclePathParticipant,
	time: number,
	contactDistanceTolerance: number
): DynamicPairContactState | null {
	const firstPosition = evaluateMotionSegmentPosition(first.path, time);
	const secondPosition = evaluateMotionSegmentPosition(second.path, time);
	const firstVelocity = evaluateMotionSegmentVelocity(first.path, time);
	const secondVelocity = evaluateMotionSegmentVelocity(second.path, time);
	const offset: Vec2 = [secondPosition[0] - firstPosition[0], secondPosition[1] - firstPosition[1]];
	const distance = Math.hypot(...offset);
	if (!Number.isFinite(distance) || distance <= contactDistanceTolerance) return null;
	const normalFromFirstToSecond: Vec2 = [offset[0] / distance, offset[1] / distance];
	const relativeVelocity: Vec2 = [
		secondVelocity[0] - firstVelocity[0],
		secondVelocity[1] - firstVelocity[1]
	];
	const relativeNormalMotion = dotVec2(relativeVelocity, normalFromFirstToSecond);
	const contactPoint: Vec2 = [
		firstPosition[0] + first.radius * normalFromFirstToSecond[0],
		firstPosition[1] + first.radius * normalFromFirstToSecond[1]
	];
	if (
		![
			...firstPosition,
			...secondPosition,
			...firstVelocity,
			...secondVelocity,
			...relativeVelocity,
			...normalFromFirstToSecond,
			relativeNormalMotion,
			...contactPoint
		].every(Number.isFinite)
	) {
		return null;
	}
	return {
		time,
		firstPosition,
		secondPosition,
		firstVelocity,
		secondVelocity,
		relativeVelocity,
		normalFromFirstToSecond,
		relativeNormalMotion,
		contactPoint,
		response: 'impact'
	};
}

export function dynamicPairSurfaceSeparation(
	first: DynamicCirclePathParticipant,
	second: DynamicCirclePathParticipant,
	time: number
): number {
	const firstPosition = evaluateMotionSegmentPosition(first.path, time);
	const secondPosition = evaluateMotionSegmentPosition(second.path, time);
	return (
		Math.hypot(secondPosition[0] - firstPosition[0], secondPosition[1] - firstPosition[1]) -
		first.radius -
		second.radius
	);
}

function pathAcceleration(path: PolynomialDynamicCirclePath): Vec2 {
	return path.type === 'stationary' ? [0, 0] : path.acceleration;
}
