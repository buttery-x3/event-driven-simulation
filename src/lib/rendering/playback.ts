import type {
	BodyTrajectory,
	EntityId,
	MotionSegment,
	PhysicalEvent,
	RendererPlaybackInput,
	SimulationRunRecord,
	Vec2
} from '$lib/simulation/contracts';

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

export function toRendererPlaybackInput(run: SimulationRunRecord): RendererPlaybackInput {
	return {
		contractVersion: run.contractVersion,
		scene: run.input.scene,
		initialBodies: run.input.initialBodies,
		status: run.status,
		playableUntilTime: run.diagnostics.simulatedUntilTime,
		trajectories: run.trajectories,
		events: run.events,
		diagnostics: run.diagnostics
	};
}

export function assertPlaybackEligible(
	input: RendererPlaybackInput
): asserts input is RendererPlaybackInput & { status: { readonly type: 'complete' } } {
	if (input.status.type !== 'complete') {
		throw new Error(
			`Ordinary playback requires a complete run; received ${input.status.type}: ${input.status.reason}`
		);
	}

	if (!Number.isFinite(input.playableUntilTime) || input.playableUntilTime < 0) {
		throw new Error('Ordinary playback requires a finite, non-negative playable duration.');
	}
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
		bodies: input.initialBodies.map((body) => {
			const trajectory = trajectoriesByBody.get(body.id);
			const selection = trajectory ? selectRecordedSegment(trajectory, time) : null;

			return {
				bodyId: body.id,
				position: selection ? evaluateRecordedSegment(selection.segment, time) : null,
				segmentIndex: selection?.index ?? null
			};
		}),
		mostRecentEvent: findMostRecentEvent(input.events, time)
	};
}

export function clampPlaybackTime(time: number, duration: number): number {
	if (!Number.isFinite(time)) {
		return time === Number.POSITIVE_INFINITY ? duration : 0;
	}

	return Math.min(Math.max(time, 0), duration);
}

export class PlaybackClock {
	#time = 0;
	#playing = false;

	public constructor(readonly duration: number) {
		if (!Number.isFinite(duration) || duration < 0) {
			throw new Error('Playback duration must be finite and non-negative.');
		}
	}

	public get time(): number {
		return this.#time;
	}

	public get playing(): boolean {
		return this.#playing;
	}

	public play(): void {
		if (this.#time >= this.duration) {
			this.#time = 0;
		}

		this.#playing = this.duration > 0;
	}

	public pause(): void {
		this.#playing = false;
	}

	public restart(): void {
		this.#time = 0;
		this.#playing = this.duration > 0;
	}

	public seek(time: number): void {
		this.#time = clampPlaybackTime(time, this.duration);

		if (this.#time >= this.duration) {
			this.#playing = false;
		}
	}

	public advance(elapsedPresentationSeconds: number): void {
		if (!Number.isFinite(elapsedPresentationSeconds) || elapsedPresentationSeconds < 0) {
			throw new Error('Elapsed presentation time must be finite and non-negative.');
		}

		if (!this.#playing) return;

		this.#time = clampPlaybackTime(this.#time + elapsedPresentationSeconds, this.duration);

		if (this.#time >= this.duration) {
			this.#playing = false;
		}
	}
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

function evaluateRecordedSegment(segment: MotionSegment, time: number): Vec2 {
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

function findMostRecentEvent(events: readonly PhysicalEvent[], time: number): PhysicalEvent | null {
	let mostRecent: PhysicalEvent | null = null;

	for (const event of events) {
		if (event.time <= time && (!mostRecent || event.time >= mostRecent.time)) {
			mostRecent = event;
		}
	}

	return mostRecent;
}
