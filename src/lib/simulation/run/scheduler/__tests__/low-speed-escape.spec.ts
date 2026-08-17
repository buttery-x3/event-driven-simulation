import { describe, expect, it } from 'vitest';
import type {
	InitialDynamicCircleBodyState,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../../contracts';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { validateSimulationRun } from '../../../verification';
import { constructSimulationRun } from '../construct';

describe('FLAME-96 low-speed escape policy', () => {
	it('uses elastic escape for an unsupported low-speed body-body impact', () => {
		const input = simulationInput(
			[body('incoming', [-0.5, 2], [0.04, 0]), body('target', [0.5, 2], [0, 0])],
			[],
			[0, 0],
			0
		);
		const run = constructSimulationRun(input);
		const solve = run.diagnostics.constrainedImpactSolves?.[0];

		expect(solve).toMatchObject({
			kind: 'support-preserving-elastic',
			mode: 'support-preserving',
			supportReactions: [],
			lockReactions: []
		});
		expect(velocity(solve!.finalVelocity, solve!.bodyIds, 'incoming')).toEqual([0, 0]);
		expect(velocity(solve!.finalVelocity, solve!.bodyIds, 'target')[0]).toBeCloseTo(0.04, 12);
		expect(validateSimulationRun(input, run).failures).toEqual([]);
	});

	it('preserves an authoritative floor support while allowing tangent escape', () => {
		const input = simulationInput(
			[body('supported', [0, 0.5], [0, 0]), body('incoming', [-0.75, 0.5], [0.04, 0], 1, 0.25)],
			[floor()],
			[0, -2],
			0
		);
		const run = constructSimulationRun(input);
		const solve = run.diagnostics.constrainedImpactSolves?.[0];

		expect(solve?.mode).toBe('support-preserving');
		expect(solve?.contacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: 'support-constraint' }),
				expect.objectContaining({ role: 'impact' })
			])
		);
		expect(solve?.supportReactions).toHaveLength(1);
		expect(velocity(solve!.finalVelocity, solve!.bodyIds, 'supported')[1]).toBeCloseTo(0, 12);
		expect(validateSimulationRun(input, run).failures).toEqual([]);
	});

	it('propagates through an initially zero-normal unsupported contact', () => {
		const input = simulationInput(
			[
				body('incoming', [-1, 2], [0.04, 0]),
				body('middle', [0, 2], [0, 0]),
				body('outgoing', [1, 2], [0, 0])
			],
			[],
			[0, 0],
			0
		);
		const run = constructSimulationRun(input);
		const solve = run.diagnostics.constrainedImpactSolves?.[0];

		expect(solve?.contacts.filter(({ role }) => role === 'impact')).toHaveLength(2);
		expect(velocity(solve!.finalVelocity, solve!.bodyIds, 'outgoing')[0]).toBeCloseTo(0.04, 12);
		expect(validateSimulationRun(input, run).failures).toEqual([]);
	});

	it('leaves impacts above 0.05 to configured restitution', () => {
		const input = simulationInput(
			[body('incoming', [-0.5, 2], [0.051, 0]), body('target', [0.5, 2], [0, 0])],
			[],
			[0, 0],
			0
		);
		const run = constructSimulationRun(input);

		expect(run.diagnostics.constrainedImpactSolves).toEqual([]);
		expect(run.diagnostics.impactSolves).toHaveLength(1);
		expect(validateSimulationRun(input, run).failures).toEqual([]);
	});

	it('keeps a supported represented-rest outcome below 0.01 authoritative', () => {
		const input = simulationInput(
			[body('lower', [0, 0.5], [0, 0]), body('upper', [0, 1.5], [0, -0.009], 0.25)],
			[floor()],
			[0, -2],
			0
		);
		const run = constructSimulationRun(input);

		expect(run.diagnostics.constrainedImpactSolves).toEqual([]);
		expect(run.contactComponents).toContainEqual(
			expect.objectContaining({
				type: 'resting-anchored',
				bodyIds: ['lower', 'upper']
			})
		);
		expect(validateSimulationRun(input, run).failures).toEqual([]);
	});

	it('does not treat an unrepresented touching fixed contact as support', () => {
		const input = simulationInput(
			[
				body('touching', [0, 0.5], [0.001, 0.02]),
				body('incoming', [-0.75, 0.5], [0.04, 0.02], 0, 0.25)
			],
			[floor()],
			[0, 0],
			0
		);
		const run = constructSimulationRun(input);

		expect(run.diagnostics.constrainedImpactSolves).toEqual([]);
		expect(run.diagnostics.impactSolves).toHaveLength(1);
		expect(validateSimulationRun(input, run).failures).toEqual([]);
	});

	it('passes a representable dynamic tangent continuation through common mode authority', () => {
		const input = simulationInput(
			[
				body('support', [0, 1], [0, 0]),
				body('slider', [0, 2], [0, 0]),
				body('incoming', [-0.75, 2], [0.04, 0], 1, 0.25, 0.5)
			],
			[peg('wedge-left', [-0.6, 0.2]), peg('wedge-right', [0.6, 0.2])],
			[0, -2],
			0
		);
		const run = constructSimulationRun(input);
		const solve = run.diagnostics.constrainedImpactSolves?.[0];

		expect(solve?.mode).toBe('support-preserving');
		expect(run.contactComponents).toContainEqual(
			expect.objectContaining({
				type: 'dynamic-sustained-support',
				dynamicSupport: expect.objectContaining({
					movingBodyId: 'slider',
					supportBodyId: 'support'
				})
			})
		);
		expect(validateSimulationRun(input, run).failures).toEqual([]);
	});

	it('locks and preserves the complete dormant component only for anchored fallback', () => {
		const input = simulationInput(
			[
				body('lower', [0, 0.5], [0, 0]),
				body('upper', [0, 1.5], [0, 0]),
				body('incoming', [-0.75, 0.5], [0.04, 0], 1, 0.25)
			],
			[floor()],
			[0, -2],
			0
		);
		const run = constructSimulationRun(input);
		const solve = run.diagnostics.constrainedImpactSolves?.[0];
		const original = run.contactComponents.find(
			(component) => component.type === 'resting-anchored' && component.createdAtTime === 0
		);

		expect(solve?.mode).toBe('anchored-fallback');
		expect(solve?.lockReactions).toHaveLength(4);
		expect(original?.dissolvedAtTime).toBeNull();
		expect(run.contactComponents.filter(({ id }) => id === original?.id)).toHaveLength(1);
		expect(velocity(solve!.finalVelocity, solve!.bodyIds, 'lower')).toEqual([0, 0]);
		expect(velocity(solve!.finalVelocity, solve!.bodyIds, 'upper')).toEqual([0, 0]);
		expect(velocity(solve!.finalVelocity, solve!.bodyIds, 'incoming')[0]).toBeCloseTo(-0.04, 12);
		expect(validateSimulationRun(input, run).failures).toEqual([]);
	});

	it('round-trips constrained evidence and rejects corrupted impulse certification', () => {
		const input = simulationInput(
			[body('incoming', [-0.5, 2], [0.04, 0]), body('target', [0.5, 2], [0, 0])],
			[],
			[0, 0],
			0
		);
		const run = constructSimulationRun(input);
		const roundTrip = parseSimulationRunFixture(JSON.stringify(run));
		expect(roundTrip.diagnostics.constrainedImpactSolves).toEqual(
			run.diagnostics.constrainedImpactSolves
		);

		const corrupted = structuredClone(run);
		Object.assign(corrupted.diagnostics.constrainedImpactSolves![0]!.impactImpulses[0]!, {
			impulse: -1
		});
		expect(() => parseSimulationRunFixture(JSON.stringify(corrupted))).toThrow(
			expect.objectContaining({ code: 'INVALID_RUN_RECORD' })
		);
		expect(validateSimulationRun(input, corrupted).failures).toContainEqual(
			expect.objectContaining({ code: 'NEGATIVE_IMPULSE' })
		);
	});
});

function simulationInput(
	bodies: readonly InitialDynamicCircleBodyState[],
	staticColliders: readonly StaticCollider[],
	gravity: Vec2,
	restitution: number
): SimulationInput {
	return {
		scene: {
			id: 'flame-96-phase-b',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 20, height: 10 },
			staticColliders,
			terminationRegions: []
		},
		initialDynamicBodies: bodies,
		settings: {
			gravity,
			restitution,
			contactCaptureDistance: 1e-9,
			maximumEvents: 30,
			maximumSimulationTime: 1.1,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function body(
	id: string,
	position: Vec2,
	velocity: Vec2,
	releaseTime = 0,
	radius = 0.5,
	mass = 1
): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius },
		mass,
		position,
		velocity,
		releaseTime
	};
}

function floor(): StaticCollider {
	return {
		id: 'floor',
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start: [-5, 0], end: [5, 0] }
	};
}

function peg(id: string, centre: Vec2): StaticCollider {
	return {
		id,
		motionAuthority: 'static',
		centre,
		physicalShape: { type: 'circle', radius: 0.5 }
	};
}

function velocity(values: readonly number[], bodyIds: readonly string[], bodyId: string): Vec2 {
	const index = bodyIds.indexOf(bodyId) * 2;
	return [values[index]!, values[index + 1]!];
}
