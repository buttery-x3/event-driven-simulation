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

	return integrateTravelTime(segment, Math.sqrt(angularDistance));
}

function circularContactAngleAtTime(segment: CircularContactMotionSegment, time: number): number {
	if (time <= segment.startTime) return segment.startAngle;
	if (time >= segment.endTime) return segment.endAngle;

	const target = time - segment.startTime;
	const angularDistance = segment.direction * (segment.endAngle - segment.startAngle);
	let lower = 0;
	let upper = Math.sqrt(Math.max(0, angularDistance));

	for (let iteration = 0; iteration < 52; iteration += 1) {
		const middle = (lower + upper) / 2;
		if (integrateTravelTime(segment, middle) < target) lower = middle;
		else upper = middle;
	}

	const root = (lower + upper) / 2;
	return segment.startAngle + segment.direction * root * root;
}

function integrateTravelTime(
	segment: Pick<
		CircularContactMotionSegment,
		'centre' | 'contactRadius' | 'startAngle' | 'direction' | 'startTangentialSpeed' | 'gravity'
	>,
	upper: number
): number {
	if (upper <= 0) return 0;

	const integrand = (rootAngle: number): number => {
		if (rootAngle === 0) {
			if (segment.startTangentialSpeed > 0) return 0;
			const normal: Vec2 = [Math.cos(segment.startAngle), Math.sin(segment.startAngle)];
			const directedTangent: Vec2 = [-normal[1] * segment.direction, normal[0] * segment.direction];
			const directedAcceleration = dotVec2(segment.gravity, directedTangent);
			return directedAcceleration > 0
				? Math.sqrt((2 * segment.contactRadius) / directedAcceleration)
				: Number.POSITIVE_INFINITY;
		}

		const angle = segment.startAngle + segment.direction * rootAngle * rootAngle;
		const speedSquared = circularContactSpeedSquared(segment, angle);
		if (speedSquared <= 0) return Number.POSITIVE_INFINITY;
		return (2 * rootAngle * segment.contactRadius) / Math.sqrt(speedSquared);
	};

	const start = integrand(0);
	const end = integrand(upper);
	const middle = integrand(upper / 2);
	const whole = (upper * (start + 4 * middle + end)) / 6;
	return adaptiveSimpson(integrand, 0, upper, start, middle, end, whole, 1e-11, 14);
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
