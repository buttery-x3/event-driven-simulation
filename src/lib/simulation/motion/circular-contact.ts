import type { CircularContactMotionSegment, Vec2 } from '../contracts';
import { dotVec2 } from '../math';

export interface CircularContactState {
	readonly angle: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly normal: Vec2;
}

export function evaluateCircularContactState(
	segment: CircularContactMotionSegment,
	time: number
): CircularContactState {
	const angle = circularContactAngleAtTime(segment, time);
	const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
	const tangent: Vec2 = [-normal[1] * segment.direction, normal[0] * segment.direction];
	const speed = Math.sqrt(Math.max(0, circularContactSpeedSquared(segment, angle)));

	return {
		angle,
		normal,
		position: [
			segment.centre[0] + segment.contactRadius * normal[0],
			segment.centre[1] + segment.contactRadius * normal[1]
		],
		velocity: [tangent[0] * speed, tangent[1] * speed]
	};
}

export function circularContactSpeedSquared(
	segment: Pick<
		CircularContactMotionSegment,
		'centre' | 'contactRadius' | 'startAngle' | 'startTangentialSpeed' | 'gravity'
	>,
	angle: number
): number {
	const startNormal: Vec2 = [Math.cos(segment.startAngle), Math.sin(segment.startAngle)];
	const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
	const displacement: Vec2 = [
		segment.contactRadius * (normal[0] - startNormal[0]),
		segment.contactRadius * (normal[1] - startNormal[1])
	];

	return segment.startTangentialSpeed ** 2 + 2 * dotVec2(segment.gravity, displacement);
}

export function circularContactTravelTime(
	segment: Pick<
		CircularContactMotionSegment,
		'centre' | 'contactRadius' | 'startAngle' | 'direction' | 'startTangentialSpeed' | 'gravity'
	>,
	endAngle: number
): number {
	const angularDistance = segment.direction * (endAngle - segment.startAngle);
	if (angularDistance <= 0) return 0;

	return integrateTravelTime(segment, angularDistance);
}

function circularContactAngleAtTime(segment: CircularContactMotionSegment, time: number): number {
	if (time <= segment.startTime) return segment.startAngle;
	if (time >= segment.endTime) return segment.endAngle;

	const target = time - segment.startTime;
	const angularDistance = segment.direction * (segment.endAngle - segment.startAngle);
	let lower = 0;
	let upper = Math.max(0, angularDistance);

	for (let iteration = 0; iteration < 52; iteration += 1) {
		const middle = (lower + upper) / 2;
		if (integrateTravelTime(segment, middle) < target) lower = middle;
		else upper = middle;
	}

	const distance = (lower + upper) / 2;
	return segment.startAngle + segment.direction * distance;
}

function integrateTravelTime(
	segment: Pick<
		CircularContactMotionSegment,
		'centre' | 'contactRadius' | 'startAngle' | 'direction' | 'startTangentialSpeed' | 'gravity'
	>,
	angularDistance: number
): number {
	if (angularDistance <= 0) return 0;

	const integrand = (phase: number): number => {
		const sine = Math.sin(phase);
		const cosine = Math.cos(phase);
		const distance = angularDistance * sine * sine;
		const angle = segment.startAngle + segment.direction * distance;
		const speedSquared = circularContactSpeedSquared(segment, angle);
		if (phase === 0 || phase === Math.PI / 2) {
			return endpointIntegrand(segment, angle, angularDistance, speedSquared, phase === 0 ? 1 : -1);
		}
		if (speedSquared <= 0) return Number.POSITIVE_INFINITY;
		const distanceDerivative = 2 * angularDistance * sine * cosine;
		return (segment.contactRadius * distanceDerivative) / Math.sqrt(speedSquared);
	};

	const start = integrand(0);
	const end = integrand(Math.PI / 2);
	const middle = integrand(Math.PI / 4);
	const whole = ((Math.PI / 2) * (start + 4 * middle + end)) / 6;
	return adaptiveSimpson(integrand, 0, Math.PI / 2, start, middle, end, whole, 1e-11, 14);
}

function endpointIntegrand(
	segment: Pick<
		CircularContactMotionSegment,
		'centre' | 'contactRadius' | 'startAngle' | 'direction' | 'startTangentialSpeed' | 'gravity'
	>,
	angle: number,
	angularDistance: number,
	speedSquared: number,
	slopeDirection: -1 | 1
): number {
	if (speedSquared > 1e-12) return 0;

	const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
	const directedTangent: Vec2 = [-normal[1] * segment.direction, normal[0] * segment.direction];
	const speedSquaredSlope =
		2 * segment.contactRadius * dotVec2(segment.gravity, directedTangent) * slopeDirection;
	return speedSquaredSlope > 0
		? 2 * segment.contactRadius * Math.sqrt(angularDistance / speedSquaredSlope)
		: Number.POSITIVE_INFINITY;
}

function adaptiveSimpson(
	fn: (value: number) => number,
	left: number,
	right: number,
	leftValue: number,
	middleValue: number,
	rightValue: number,
	whole: number,
	tolerance: number,
	depth: number
): number {
	const middle = (left + right) / 2;
	const leftMiddle = (left + middle) / 2;
	const rightMiddle = (middle + right) / 2;
	const leftMiddleValue = fn(leftMiddle);
	const rightMiddleValue = fn(rightMiddle);
	const leftIntegral = ((middle - left) * (leftValue + 4 * leftMiddleValue + middleValue)) / 6;
	const rightIntegral = ((right - middle) * (middleValue + 4 * rightMiddleValue + rightValue)) / 6;
	const combined = leftIntegral + rightIntegral;

	if (depth <= 0 || Math.abs(combined - whole) <= 15 * tolerance) {
		return combined + (combined - whole) / 15;
	}

	return (
		adaptiveSimpson(
			fn,
			left,
			middle,
			leftValue,
			leftMiddleValue,
			middleValue,
			leftIntegral,
			tolerance / 2,
			depth - 1
		) +
		adaptiveSimpson(
			fn,
			middle,
			right,
			middleValue,
			rightMiddleValue,
			rightValue,
			rightIntegral,
			tolerance / 2,
			depth - 1
		)
	);
}
