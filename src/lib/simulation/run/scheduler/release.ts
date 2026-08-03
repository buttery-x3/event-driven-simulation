import type { InitialDynamicCircleBodyState, StaticCollider, Vec2 } from '../../contracts';
import { evaluatePredictedBodyPosition } from '../single-ball/local-events';
import type { SchedulerState } from './types';

export function releaseOverlapReasons(
	state: SchedulerState,
	batch: readonly InitialDynamicCircleBodyState[]
): ReadonlyMap<string, string> {
	const reasons = new Map<string, string>();
	const tolerance = state.input.settings.tolerances.contactDistance;
	for (const body of batch) {
		const fixed = state.input.scene.staticColliders.find((collider) =>
			overlapsFixed(body, collider, tolerance)
		);
		if (fixed) reasons.set(body.id, `Release overlaps fixed collider ${fixed.id}.`);
		for (const runtime of state.runtimes.values()) {
			const position = evaluatePredictedBodyPosition(
				runtime,
				state.predictions.get(runtime.body.id) ?? null,
				body.releaseTime
			);
			if (position && overlapsBody(body, runtime.body, position, tolerance)) {
				reasons.set(body.id, `Release overlaps active body ${runtime.body.id}.`);
			}
		}
	}
	for (let leftIndex = 0; leftIndex < batch.length; leftIndex += 1) {
		for (let rightIndex = leftIndex + 1; rightIndex < batch.length; rightIndex += 1) {
			const left = batch[leftIndex]!;
			const right = batch[rightIndex]!;
			if (!overlapsBody(left, right, right.position, tolerance)) continue;
			const detail = `Simultaneous releases ${left.id} and ${right.id} overlap.`;
			reasons.set(left.id, detail);
			reasons.set(right.id, detail);
		}
	}
	return reasons;
}

function overlapsFixed(
	body: InitialDynamicCircleBodyState,
	collider: StaticCollider,
	tolerance: number
): boolean {
	const distance =
		'centre' in collider
			? Math.hypot(body.position[0] - collider.centre[0], body.position[1] - collider.centre[1]) -
				collider.physicalShape.radius
			: distanceToSegment(body.position, collider.physicalShape.start, collider.physicalShape.end);
	return distance < body.physicalShape.radius - tolerance;
}

function overlapsBody(
	body: InitialDynamicCircleBodyState,
	other: InitialDynamicCircleBodyState,
	otherPosition: Vec2,
	tolerance: number
): boolean {
	return (
		Math.hypot(body.position[0] - otherPosition[0], body.position[1] - otherPosition[1]) <
		body.physicalShape.radius + other.physicalShape.radius - tolerance
	);
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	const lengthSquared = dx * dx + dy * dy;
	const parameter = Math.max(
		0,
		Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)
	);
	return Math.hypot(point[0] - (start[0] + parameter * dx), point[1] - (start[1] + parameter * dy));
}
