import type { BodyTrajectory, MotionSegment, Vec2 } from './contracts';

export function evaluateMotionSegmentPosition(segment: MotionSegment, time: number): Vec2 {
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
	const elapsed = time - segment.startTime;

	return [
		segment.startVelocity[0] + segment.acceleration[0] * elapsed,
		segment.startVelocity[1] + segment.acceleration[1] * elapsed
	];
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
