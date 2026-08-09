import type { BodyTrajectory, MotionSegment, Vec2 } from '../contracts';
import { evaluateCircularContactState } from './circular-contact';

export function evaluateMotionSegmentPosition(segment: MotionSegment, time: number): Vec2 {
	if (segment.type === 'stationary') return segment.startPosition;
	if (segment.type === 'accumulation-tail') return evaluateAccumulationTail(segment, time).position;
	if (segment.type === 'circular-contact') {
		return evaluateCircularContactState(segment, time).position;
	}
	const elapsed = time - segment.startTime;
	const elapsedSquared = elapsed * elapsed;

	return [
		segment.startPosition[0] +
			segment.startVelocity[0] * elapsed +
			0.5 * segment.acceleration[0] * elapsedSquared,
		segment.startPosition[1] +
			segment.startVelocity[1] * elapsed +
			0.5 * segment.acceleration[1] * elapsedSquared
	];
}

export function evaluateMotionSegmentVelocity(segment: MotionSegment, time: number): Vec2 {
	if (segment.type === 'stationary') return [0, 0];
	if (segment.type === 'accumulation-tail') return evaluateAccumulationTail(segment, time).velocity;
	if (segment.type === 'circular-contact') {
		return evaluateCircularContactState(segment, time).velocity;
	}
	const elapsed = time - segment.startTime;

	return [
		segment.startVelocity[0] + segment.acceleration[0] * elapsed,
		segment.startVelocity[1] + segment.acceleration[1] * elapsed
	];
}

function evaluateAccumulationTail(
	segment: Extract<MotionSegment, { readonly type: 'accumulation-tail' }>,
	time: number
): { readonly position: Vec2; readonly velocity: Vec2 } {
	const duration = segment.endTime - segment.startTime;
	if (!(duration > 0)) return { position: segment.endPosition, velocity: segment.endVelocity };
	const fraction = Math.max(0, Math.min(1, (time - segment.startTime) / duration));
	const squared = fraction * fraction;
	const cubed = squared * fraction;
	const h00 = 2 * cubed - 3 * squared + 1;
	const h10 = cubed - 2 * squared + fraction;
	const h01 = -2 * cubed + 3 * squared;
	const h11 = cubed - squared;
	const dh00 = (6 * squared - 6 * fraction) / duration;
	const dh10 = 3 * squared - 4 * fraction + 1;
	const dh01 = (-6 * squared + 6 * fraction) / duration;
	const dh11 = 3 * squared - 2 * fraction;
	return {
		position: [
			h00 * segment.startPosition[0] +
				h10 * duration * segment.startVelocity[0] +
				h01 * segment.endPosition[0] +
				h11 * duration * segment.endVelocity[0],
			h00 * segment.startPosition[1] +
				h10 * duration * segment.startVelocity[1] +
				h01 * segment.endPosition[1] +
				h11 * duration * segment.endVelocity[1]
		],
		velocity: [
			dh00 * segment.startPosition[0] +
				dh10 * segment.startVelocity[0] +
				dh01 * segment.endPosition[0] +
				dh11 * segment.endVelocity[0],
			dh00 * segment.startPosition[1] +
				dh10 * segment.startVelocity[1] +
				dh01 * segment.endPosition[1] +
				dh11 * segment.endVelocity[1]
		]
	};
}

export function evaluateBodyTrajectoryPosition(
	trajectory: BodyTrajectory,
	time: number
): Vec2 | null {
	const segment = trajectory.segments.find(
		(candidate) => time >= candidate.startTime && time <= candidate.endTime
	);

	return segment ? evaluateMotionSegmentPosition(segment, time) : null;
}
