import type { Vec2 } from './contracts';

export function dotVec2(left: Vec2, right: Vec2): number {
	return left[0] * right[0] + left[1] * right[1];
}

export function normaliseVec2(vector: Vec2, tolerance: number): Vec2 | null {
	const length = Math.hypot(vector[0], vector[1]);

	if (!Number.isFinite(length) || length <= tolerance) {
		return null;
	}

	return [vector[0] / length, vector[1] / length];
}
