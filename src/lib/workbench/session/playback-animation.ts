export function startPlaybackAnimationLoop(
	onElapsed: (elapsedSeconds: number) => void
): () => void {
	let previousTimestamp: number | null = null;
	let animationFrame = 0;
	const animate = (timestamp: number) => {
		const elapsedSeconds = previousTimestamp === null ? 0 : (timestamp - previousTimestamp) / 1_000;
		previousTimestamp = timestamp;
		onElapsed(elapsedSeconds);
		animationFrame = requestAnimationFrame(animate);
	};
	animationFrame = requestAnimationFrame(animate);
	return () => cancelAnimationFrame(animationFrame);
}
