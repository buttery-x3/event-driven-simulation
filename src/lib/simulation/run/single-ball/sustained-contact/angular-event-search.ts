import type { RunTerminalReason, Vec2 } from '../../../contracts';
import { dotVec2 } from '../../../math';
import { circularContactSpeedSquared, circularContactTravelTime } from '../../../motion';
import { circularPosition, colliderSeparation, containsPosition, outsideBounds } from './geometry';
import type { SustainedContactRequest } from './types';

export interface CircularContactSeed {
	readonly centre: Vec2;
	readonly contactRadius: number;
	readonly startAngle: number;
	readonly direction: -1 | 1;
	readonly startTangentialSpeed: number;
	readonly gravity: Vec2;
}

export interface AngularSceneEvent {
	readonly angle: number;
	readonly type: 'contact' | 'terminal';
	readonly colliderId?: string;
	readonly terminalReason?: RunTerminalReason;
}

export function findDetachAngle(seed: CircularContactSeed): number | null {
	const supportExpression = (angle: number) => {
		const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
		return (
			circularContactSpeedSquared(seed, angle) / seed.contactRadius + dotVec2(seed.gravity, normal)
		);
	};
	let previousAngle = seed.startAngle;
	let previous = supportExpression(previousAngle);
	for (let index = 1; index <= 512; index += 1) {
		const angle = seed.startAngle + seed.direction * ((Math.PI * 2 * index) / 512);
		if (circularContactSpeedSquared(seed, angle) < -1e-10) return null;
		const current = supportExpression(angle);
		if (previous <= 0 && current >= 0) {
			return bisectNumber(previousAngle, angle, (candidate) => supportExpression(candidate) >= 0);
		}
		previousAngle = angle;
		previous = current;
	}
	return null;
}

export function findEarliestAngularSceneEvent(
	request: SustainedContactRequest,
	seed: CircularContactSeed,
	detachAngle: number
): AngularSceneEvent | null {
	const angularDistance = seed.direction * (detachAngle - seed.startAngle);
	let previousAngle = seed.startAngle;
	let previousPosition = circularPosition(seed.centre, seed.contactRadius, previousAngle);
	for (let index = 1; index <= 512; index += 1) {
		const angle = seed.startAngle + seed.direction * ((angularDistance * index) / 512);
		const position = circularPosition(seed.centre, seed.contactRadius, angle);
		const event = crossedSceneEvent(
			request,
			previousAngle,
			angle,
			previousPosition,
			position,
			seed
		);
		if (event) return event;
		previousAngle = angle;
		previousPosition = position;
	}
	return null;
}

function crossedSceneEvent(
	request: SustainedContactRequest,
	startAngle: number,
	endAngle: number,
	startPosition: Vec2,
	endPosition: Vec2,
	seed: CircularContactSeed
): AngularSceneEvent | null {
	const events: AngularSceneEvent[] = [];
	for (const region of request.input.scene.terminationRegions) {
		if (
			!containsPosition(region.minimum, region.maximum, startPosition) &&
			containsPosition(region.minimum, region.maximum, endPosition)
		) {
			const angle = bisectNumber(startAngle, endAngle, (candidate) =>
				containsPosition(
					region.minimum,
					region.maximum,
					circularPosition(seed.centre, seed.contactRadius, candidate)
				)
			);
			events.push({
				type: 'terminal',
				angle,
				terminalReason: {
					type: region.purpose === 'complete' ? 'completion-region' : 'escape-region',
					regionId: region.id,
					time: request.time + circularContactTravelTime(seed, angle)
				}
			});
		}
	}
	const halfWidth = request.input.scene.bounds.width / 2;
	const boundsBoundary = outsideBounds(endPosition, halfWidth, request.input.scene.bounds.height);
	if (
		!outsideBounds(startPosition, halfWidth, request.input.scene.bounds.height) &&
		boundsBoundary
	) {
		const angle = bisectNumber(startAngle, endAngle, (candidate) =>
			Boolean(
				outsideBounds(
					circularPosition(seed.centre, seed.contactRadius, candidate),
					halfWidth,
					request.input.scene.bounds.height
				)
			)
		);
		events.push({
			type: 'terminal',
			angle,
			terminalReason: {
				type: 'bounds-escape',
				boundary: boundsBoundary,
				time: request.time + circularContactTravelTime(seed, angle)
			}
		});
	}
	for (const collider of request.input.scene.staticColliders) {
		if (collider.id === request.colliderId) continue;
		const startSeparation = colliderSeparation(
			startPosition,
			request.body.physicalShape.radius,
			collider
		);
		const endSeparation = colliderSeparation(
			endPosition,
			request.body.physicalShape.radius,
			collider
		);
		if (
			startSeparation > request.input.settings.tolerances.contactDistance &&
			endSeparation <= request.input.settings.tolerances.contactDistance
		) {
			const angle = bisectNumber(
				startAngle,
				endAngle,
				(candidate) =>
					colliderSeparation(
						circularPosition(seed.centre, seed.contactRadius, candidate),
						request.body.physicalShape.radius,
						collider
					) <= request.input.settings.tolerances.contactDistance
			);
			events.push({ type: 'contact', angle, colliderId: collider.id });
		}
	}
	return (
		events.sort(
			(left, right) =>
				seed.direction * (left.angle - right.angle) ||
				(left.colliderId ?? '').localeCompare(right.colliderId ?? '')
		)[0] ?? null
	);
}

function bisectNumber(left: number, right: number, predicate: (value: number) => boolean): number {
	let lower = left;
	let upper = right;
	for (let iteration = 0; iteration < 60; iteration += 1) {
		const middle = (lower + upper) / 2;
		if (predicate(middle)) upper = middle;
		else lower = middle;
	}
	return (lower + upper) / 2;
}
