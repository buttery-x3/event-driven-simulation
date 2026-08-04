import type { RunTerminalReason, Vec2 } from '../../../../contracts';
import { dotVec2 } from '../../../../math';
import { circularContactSpeedSquared, circularContactTravelTime } from '../../../../motion';
import { circularPosition, colliderSeparation, containsPosition, outsideBounds } from '../geometry';
import type { SustainedContactRequest } from '../types';

export interface CircularContactSeed {
	readonly centre: Vec2;
	readonly contactRadius: number;
	readonly startAngle: number;
	readonly direction: -1 | 1;
	readonly startTangentialSpeed: number;
	readonly gravity: Vec2;
}

export type AngularEvent =
	| { readonly angle: number; readonly type: 'support-lost' | 'turning-point' }
	| {
			readonly angle: number;
			readonly type: 'contact';
			readonly colliderId: string;
	  }
	| {
			readonly angle: number;
			readonly type: 'terminal';
			readonly terminalReason: RunTerminalReason;
	  };

export function findEarliestAngularEvent(
	request: SustainedContactRequest,
	seed: CircularContactSeed
): AngularEvent | null {
	const motionBoundary = findCircularMotionBoundary(seed);
	if (!motionBoundary) return null;

	return findEarliestAngularSceneEvent(request, seed, motionBoundary.angle) ?? motionBoundary;
}

export function findCircularMotionBoundary(seed: CircularContactSeed): AngularEvent | null {
	let previousAngle = seed.startAngle;
	let previousSpeedSquared = circularContactSpeedSquared(seed, previousAngle);
	let previousSupport = supportExpression(seed, previousAngle);
	for (let index = 1; index <= 512; index += 1) {
		const angle = seed.startAngle + seed.direction * ((Math.PI * 2 * index) / 512);
		const speedSquared = circularContactSpeedSquared(seed, angle);
		const support = supportExpression(seed, angle);
		const candidates: AngularEvent[] = [];

		if (previousSpeedSquared > 0 && speedSquared <= 0) {
			candidates.push({
				type: 'turning-point',
				angle: bisectNumber(
					previousAngle,
					angle,
					(candidate) => circularContactSpeedSquared(seed, candidate) <= 0
				)
			});
		}
		if (previousSupport <= 0 && support >= 0) {
			candidates.push({
				type: 'support-lost',
				angle: bisectNumber(
					previousAngle,
					angle,
					(candidate) => supportExpression(seed, candidate) >= 0
				)
			});
		}
		if (candidates.length > 0) return firstAlongDirection(candidates, seed.direction);

		previousAngle = angle;
		previousSpeedSquared = speedSquared;
		previousSupport = support;
	}
	return null;
}

export function findEarliestAngularSceneEvent(
	request: SustainedContactRequest,
	seed: CircularContactSeed,
	endAngle: number
): AngularEvent | null {
	const angularDistance = seed.direction * (endAngle - seed.startAngle);
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
): AngularEvent | null {
	const events: AngularEvent[] = [];
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
	return firstAlongDirection(events, seed.direction);
}

function supportExpression(seed: CircularContactSeed, angle: number): number {
	const normal: Vec2 = [Math.cos(angle), Math.sin(angle)];
	return (
		circularContactSpeedSquared(seed, angle) / seed.contactRadius + dotVec2(seed.gravity, normal)
	);
}

function firstAlongDirection(events: AngularEvent[], direction: -1 | 1): AngularEvent | null {
	return (
		events.sort(
			(left, right) =>
				direction * (left.angle - right.angle) ||
				('colliderId' in left ? left.colliderId : '').localeCompare(
					'colliderId' in right ? right.colliderId : ''
				)
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
	return upper;
}
