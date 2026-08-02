import type { Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { dotVec2 } from '../../../math';
import type { SupportReactionSolution } from './types';

export function solveSupportReactions(
	contacts: readonly FixedWorldContactCandidate[],
	acceleration: Vec2,
	tolerance: number
): SupportReactionSolution | null {
	const solutions: number[][] = [];
	for (let first = 0; first < contacts.length; first += 1) {
		const normal = contacts[first]!.normal;
		const reaction = -dotVec2(acceleration, normal);
		const residual: Vec2 = [
			acceleration[0] + reaction * normal[0],
			acceleration[1] + reaction * normal[1]
		];
		if (reaction >= -tolerance && Math.hypot(...residual) <= tolerance) {
			const values = contacts.map(() => 0);
			values[first] = Math.max(0, reaction);
			solutions.push(values);
		}
		for (let second = first + 1; second < contacts.length; second += 1) {
			const other = contacts[second]!.normal;
			const determinant = normal[0] * other[1] - normal[1] * other[0];
			if (Math.abs(determinant) <= tolerance) continue;
			const left = (-acceleration[0] * other[1] + acceleration[1] * other[0]) / determinant;
			const right = (-normal[0] * acceleration[1] + normal[1] * acceleration[0]) / determinant;
			if (left < -tolerance || right < -tolerance) continue;
			const values = contacts.map(() => 0);
			values[first] = Math.max(0, left);
			values[second] = Math.max(0, right);
			solutions.push(values);
		}
	}
	const reactions = solutions.sort((left, right) => sum(left) - sum(right))[0];
	return reactions ? { reactions } : null;
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
