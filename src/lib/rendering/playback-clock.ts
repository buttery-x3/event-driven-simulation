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
