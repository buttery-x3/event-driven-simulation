import type { Vec2 } from '$lib/simulation/contracts';

export type VelocityEntryMode = 'speed-angle' | 'components';

export interface VelocityEntryDraft {
	readonly velocityMode: VelocityEntryMode;
	readonly speed: string;
	readonly angleDegrees: string;
	readonly velocityX: string;
	readonly velocityY: string;
}

export function convertSpeedAndAngleToVelocity(speed: number, angleDegrees: number): Vec2 {
	const angleRadians = degreesToRadians(angleDegrees);
	return normalizeVectorComponent([speed * Math.cos(angleRadians), speed * Math.sin(angleRadians)]);
}

export function changeVelocityEntryMode<T extends VelocityEntryDraft>(
	draft: T,
	mode: VelocityEntryMode
): T {
	if (draft.velocityMode === mode) return draft;

	if (mode === 'components') {
		const speed = Number(draft.speed);
		const angleDegrees = Number(draft.angleDegrees);
		if (!Number.isFinite(speed) || !Number.isFinite(angleDegrees) || speed < 0) {
			return { ...draft, velocityMode: mode };
		}
		const velocity = convertSpeedAndAngleToVelocity(speed, angleDegrees);
		return {
			...draft,
			velocityMode: mode,
			velocityX: String(velocity[0]),
			velocityY: String(velocity[1])
		};
	}

	const velocityX = Number(draft.velocityX);
	const velocityY = Number(draft.velocityY);
	if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) {
		return { ...draft, velocityMode: mode };
	}
	const speed = Math.hypot(velocityX, velocityY);
	return {
		...draft,
		velocityMode: mode,
		speed: String(speed),
		angleDegrees: String(speed === 0 ? 0 : radiansToDegrees(Math.atan2(velocityY, velocityX)))
	};
}

function degreesToRadians(value: number): number {
	return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
	return (value * 180) / Math.PI;
}

function normalizeVectorComponent(vector: Vec2): Vec2 {
	return vector.map((component) =>
		Math.abs(component) < 1e-15 ? 0 : component
	) as unknown as Vec2;
}
