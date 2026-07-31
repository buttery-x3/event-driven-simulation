import type {
	BodyTrajectory,
	EntityId,
	MotionSegment,
	PhysicalEvent,
	RendererPlaybackInput,
	Vec2
} from '$lib/simulation/contracts';
import { evaluateMotionSegmentPosition } from '$lib/simulation/trajectory';
import { assertPlaybackEligible } from './playback-admission';
import { clampPlaybackTime } from './playback-clock';

export interface PlaybackBodyPose {
	readonly bodyId: EntityId;
	readonly position: Vec2 | null;
	readonly segmentIndex: number | null;
}

export interface PlaybackFrame {
	readonly time: number;
	readonly bodies: readonly PlaybackBodyPose[];
	readonly mostRecentEvent: PhysicalEvent | null;
}

export function getPlaybackFrame(
	input: RendererPlaybackInput,
	requestedTime: number
): PlaybackFrame {
	assertPlaybackEligible(input);

	const time = clampPlaybackTime(requestedTime, input.playableUntilTime);
	const trajectoriesByBody = new Map(
		input.trajectories.map((trajectory) => [trajectory.bodyId, trajectory] as const)
	);

	return {
		time,
		bodies: input.initialDynamicBodies.map((body) => {
			const trajectory = trajectoriesByBody.get(body.id);
			const selection = trajectory ? selectRecordedSegment(trajectory, time) : null;

			return {
				bodyId: body.id,
				position: selection ? evaluateMotionSegmentPosition(selection.segment, time) : null,
				segmentIndex: selection?.index ?? null
			};
		}),
		mostRecentEvent: findMostRecentEvent(input.events, time)
	};
}

function selectRecordedSegment(
	trajectory: BodyTrajectory,
	time: number
): { readonly segment: MotionSegment; readonly index: number } | null {
	let selected: { readonly segment: MotionSegment; readonly index: number } | null = null;

	for (const [index, segment] of trajectory.segments.entries()) {
		if (time >= segment.startTime && time <= segment.endTime) {
			selected = { segment, index };
		}
	}

	return selected;
}

function findMostRecentEvent(events: readonly PhysicalEvent[], time: number): PhysicalEvent | null {
	let mostRecent: PhysicalEvent | null = null;

	for (const event of events) {
		if (event.time <= time && (!mostRecent || event.time >= mostRecent.time)) {
			mostRecent = event;
		}
	}

	return mostRecent;
}
