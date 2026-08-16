import { describe, expect, it } from 'vitest';
import type { SimulationInput, Vec2 } from '../../../../contracts';
import type { FixedWorldContactCandidate } from '../../../../collision';
import { acquireAlternatingContactLimit } from '../acquisition';

const input: SimulationInput = {
	scene: {
		id: 'acquisition-tolerance-test',
		coordinateSystem: {
			origin: 'centre-bottom',
			horizontalAxis: 'right',
			verticalAxis: 'up',
			lengthUnit: 'metre'
		},
		bounds: { width: 4, height: 4 },
		staticColliders: [
			{
				id: 'left',
				motionAuthority: 'static',
				physicalShape: { type: 'circle', radius: 0.5 },
				centre: [-1, 0]
			},
			{
				id: 'right',
				motionAuthority: 'static',
				physicalShape: { type: 'circle', radius: 0.5 },
				centre: [1, 0]
			}
		],
		terminationRegions: []
	},
	initialDynamicBodies: [
		{
			id: 'ball',
			motionAuthority: 'dynamic',
			physicalShape: { type: 'circle', radius: 0.5 },
			mass: 1,
			position: [0, 0],
			velocity: [0, 0],
			releaseTime: 0
		}
	],
	settings: {
		gravity: [0, -9.81],
		restitution: 1,
		contactCaptureDistance: 1e-9,
		maximumEvents: 20,
		maximumSimulationTime: 4,
		tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
	}
};

describe('alternating-contact manifold acquisition', () => {
	it.each([-0.5e-9, 0.5e-9])(
		'classifies tolerance-contained %s normal-speed signs as non-impulsive',
		(horizontalSpeed) => {
			const acquired = acquire(horizontalSpeed);

			expect(acquired).not.toBeNull();
			expect(acquired!.candidates.map(({ response }) => response)).toEqual([
				'non-impulsive-contact',
				'non-impulsive-contact'
			]);
		}
	);

	it('keeps a definite inward normal speed classified as impact', () => {
		const acquired = acquire(2e-9);

		expect(acquired).not.toBeNull();
		expect(acquired!.candidates.map(({ response }) => response)).toContain('impact');
	});
});

function acquire(horizontalSpeed: number) {
	return acquireAlternatingContactLimit(
		input,
		input.initialDynamicBodies[0]!,
		2.8,
		[0, 0],
		[horizontalSpeed, 0],
		[candidate('left', [1, 0], 2.8)],
		[
			{ time: 0, manifoldKey: 'left:circle', colliderIds: ['left'] },
			{ time: 1, manifoldKey: 'right:circle', colliderIds: ['right'] },
			{ time: 1.8, manifoldKey: 'left:circle', colliderIds: ['left'] },
			{ time: 2.4, manifoldKey: 'right:circle', colliderIds: ['right'] }
		]
	);
}

function candidate(id: string, normal: Vec2, time: number): FixedWorldContactCandidate {
	return {
		type: 'contact-candidate',
		bodyId: 'ball',
		colliderId: id,
		colliderKind: 'circle',
		feature: 'circle',
		time,
		position: [0, 0],
		contactPoint: [0, 0],
		normal,
		normalVelocity: 0,
		response: 'impact'
	};
}
