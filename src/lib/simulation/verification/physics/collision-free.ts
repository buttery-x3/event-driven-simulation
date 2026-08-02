import { evaluateMotionSegmentPosition } from '../../motion';
import { evaluateColliderContact } from './contact-geometry';
import { bodyFor, stateTolerance } from '../history';
import { reportRunValidationFailure, type RunValidationContext } from '../results';

const interiorSampleCount = 64;

export function validateCollisionFreeIntervals(context: RunValidationContext): void {
	for (const [trajectoryIndex, trajectory] of context.run.trajectories.entries()) {
		const body = bodyFor(context.submittedInput, trajectory.bodyId);
		if (!body) continue;
		for (const [segmentIndex, segment] of trajectory.segments.entries()) {
			if (segment.type !== 'free-flight') continue;
			for (const collider of context.submittedInput.scene.staticColliders) {
				for (let sample = 1; sample < interiorSampleCount; sample += 1) {
					const fraction = sample / interiorSampleCount;
					const time = segment.startTime + (segment.endTime - segment.startTime) * fraction;
					const position = evaluateMotionSegmentPosition(segment, time);
					const geometry = evaluateColliderContact(position, body.physicalShape.radius, collider);
					if (geometry.clearance < -stateTolerance(context)) {
						reportRunValidationFailure(
							context,
							'collision-free-interval',
							'EARLY_GEOMETRY_CROSSING',
							'A committed free-flight interval visibly crosses fixed-world geometry.',
							{
								path: `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`,
								time,
								bodyId: segment.bodyId,
								colliderId: collider.id
							}
						);
						sample = interiorSampleCount;
					}
				}
			}
		}
	}
}
