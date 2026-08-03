import type {
	BodyLifecycleState,
	BodyRunState,
	BodyTrajectory,
	EntityId,
	MotionSegment,
	PhysicalEvent,
	RendererPlaybackInput,
	Vec2
} from '$lib/simulation/contracts';
import {
	evaluateMotionSegmentPosition,
	evaluateMotionSegmentVelocity
} from '$lib/simulation/motion';
import { assertRecordedInspectionEligible } from './playback-admission';
import { clampPlaybackTime } from './playback-clock';

export interface PlaybackBodyPose {
	readonly bodyId: EntityId;
	readonly position: Vec2 | null;
	readonly velocity: Vec2 | null;
	readonly segmentIndex: number | null;
	readonly motionMode: MotionSegment['type'] | null;
	readonly lifecycle: BodyLifecycleState;
	readonly contactComponentIds: readonly string[];
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
	assertRecordedInspectionEligible(input);

	const time = clampPlaybackTime(requestedTime, input.playableUntilTime);
	const trajectoriesByBody = new Map(
		input.trajectories.map((trajectory) => [trajectory.bodyId, trajectory] as const)
	);
	const statesByBody = new Map(input.bodyStates.map((state) => [state.bodyId, state] as const));

	return {
		time,
		bodies: input.initialDynamicBodies.map((body) => {
			const trajectory = trajectoriesByBody.get(body.id);
			const bodyState = statesByBody.get(body.id);
			const selection = trajectory ? selectRecordedSegment(trajectory, time) : null;
			const terminalSelection =
				!selection &&
				trajectory &&
				bodyState &&
				bodyState.terminalOutcome !== null &&
				bodyState.recordedUntilTime !== null &&
				time > bodyState.recordedUntilTime
					? selectLastRecordedSegment(trajectory)
					: null;
			const initialStateVisible = time === body.releaseTime && time <= input.playableUntilTime;
			const selectedSegment = selection?.segment ?? terminalSelection?.segment ?? null;
			const selectedTime = selection
				? time
				: terminalSelection
					? terminalSelection.segment.endTime
					: null;

			return {
				bodyId: body.id,
				position:
					selectedSegment && selectedTime !== null
						? evaluateMotionSegmentPosition(selectedSegment, selectedTime)
						: initialStateVisible
							? body.position
							: null,
				velocity: selection
					? evaluateMotionSegmentVelocity(selection.segment, time)
					: terminalSelection
						? [0, 0]
						: initialStateVisible
							? body.velocity
							: null,
				segmentIndex: selection?.index ?? terminalSelection?.index ?? null,
				motionMode: selectedSegment?.type ?? null,
				lifecycle: getLifecycleAtTime(body.releaseTime, bodyState, selectedSegment, time),
				contactComponentIds: input.contactComponents
					.filter(
						(component) =>
							component.bodyIds.includes(body.id) &&
							component.createdAtTime <= time &&
							(component.dissolvedAtTime === null || component.dissolvedAtTime >= time)
					)
					.map(({ id }) => id)
			};
		}),
		mostRecentEvent: findMostRecentEvent(input.events, time)
	};
}

function selectLastRecordedSegment(
	trajectory: BodyTrajectory
): { readonly segment: MotionSegment; readonly index: number } | null {
	const index = trajectory.segments.length - 1;
	const segment = trajectory.segments[index];
	return segment ? { segment, index } : null;
}

function getLifecycleAtTime(
	releaseTime: number,
	state: BodyRunState | undefined,
	segment: MotionSegment | null,
	time: number
): BodyLifecycleState {
	if (time < releaseTime) return 'scheduled';
	if (!state) return 'invalid';
	if (state.lifecycle === 'resting' || segment?.type === 'stationary') return 'resting';
	if (
		state.recordedUntilTime !== null &&
		time >= state.recordedUntilTime &&
		['completed', 'escaped', 'invalid', 'unresolved'].includes(state.lifecycle)
	) {
		return state.lifecycle;
	}
	return 'active';
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
