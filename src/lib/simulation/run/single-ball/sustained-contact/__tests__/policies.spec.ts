import { describe, expect, it } from 'vitest';
import type { SimulationInput, StaticCollider } from '../../../../contracts';
import { findDetachAngle, findEarliestAngularSceneEvent } from '../angular-event-search';
import {
	detachedContactResult,
	restingContactResult,
	unresolvedContactResult
} from '../contact-mode-results';
import type { SustainedContactRequest } from '../types';

const supportingCollider: StaticCollider = {
	id: 'peg',
	motionAuthority: 'static',
	physicalShape: { type: 'circle', radius: 0.5 },
	centre: [0, 0]
};

function makeRequest(): SustainedContactRequest {
	const input: SimulationInput = {
		scene: {
			id: 'policy-test',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 10, height: 10 },
			staticColliders: [supportingCollider],
			terminationRegions: [
				{
					id: 'exit',
					type: 'axis-aligned-box',
					purpose: 'complete',
					minimum: [-0.1, 0.8],
					maximum: [0.2, 1.1]
				}
			]
		},
		initialDynamicBodies: [
			{
				id: 'ball',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius: 0.1 },
				position: [1, 0],
				velocity: [0, 1]
			}
		],
		settings: {
			gravity: [0, 0],
			restitution: 0,
			maximumEvents: 10,
			maximumSimulationTime: 10,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
	return {
		input,
		body: input.initialDynamicBodies[0]!,
		colliderId: 'peg',
		time: 0,
		position: [1, 0],
		normal: [1, 0],
		outgoingVelocity: [0, 1],
		entryFrom: 'impact',
		entryReason: 'impact-collapse'
	};
}

describe('sustained-contact numerical event policy', () => {
	it('certifies detachment independently from continuation orchestration', () => {
		const startAngle = Math.PI / 2;
		const angle = findDetachAngle({
			centre: [0, 0],
			contactRadius: 0.6,
			startAngle,
			direction: 1,
			startTangentialSpeed: 0.1,
			gravity: [0, -10]
		});

		expect(angle).not.toBeNull();
		expect(angle!).toBeGreaterThan(startAngle);
	});

	it('selects the first angular terminal-region entry before the supplied detach angle', () => {
		const request = makeRequest();
		const event = findEarliestAngularSceneEvent(
			request,
			{
				centre: [0, 0],
				contactRadius: 1,
				startAngle: 0,
				direction: 1,
				startTangentialSpeed: 1,
				gravity: [0, 0]
			},
			Math.PI
		);

		expect(event).toMatchObject({
			type: 'terminal',
			terminalReason: { type: 'completion-region', regionId: 'exit' }
		});
		expect(event!.angle).toBeLessThan(Math.PI);
	});
});

describe('shared sustained-contact result construction', () => {
	it('constructs resting, detached, and unresolved lifecycle results consistently', () => {
		const request = makeRequest();

		expect(restingContactResult(request)).toMatchObject({
			events: [{ from: 'impact', to: 'resting', reason: 'impact-collapse' }],
			terminalReason: { type: 'resting-contact', colliderId: 'peg' },
			nextState: null
		});
		expect(detachedContactResult(request, [2, 3])).toMatchObject({
			events: [{ from: 'impact', to: 'free-flight', reason: 'support-lost' }],
			terminalReason: null,
			nextState: { velocity: [2, 3], releasedContactColliderId: 'peg' }
		});
		expect(unresolvedContactResult(request, 'search failed')).toMatchObject({
			events: [
				{ from: 'impact', to: 'sliding' },
				{ from: 'sliding', to: 'free-flight', reason: 'unresolved' }
			],
			terminalReason: { type: 'unresolved-collision-search', detail: 'search failed' }
		});
	});
});
