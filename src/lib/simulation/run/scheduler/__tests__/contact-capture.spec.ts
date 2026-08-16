import { describe, expect, it } from 'vitest';
import type { InitialDynamicCircleBodyState, SimulationInput, Vec2 } from '../../../contracts';
import { validateSimulationRun } from '../../../verification';
import { settlingScenarios } from '../../../world';
import { constructSimulationRun } from '../construct';

describe('FLAME-88 coupled contact capture', () => {
	it('captures a low-energy three-body stack supported by the fixed floor', () => {
		const simulationInput = input();
		const run = constructSimulationRun(simulationInput);
		const captureSolve = run.diagnostics.impactSolves?.find(
			({ contactCapture }) => contactCapture?.selectedEndpoint === 'captured'
		);
		const capture = captureSolve?.contactCapture;

		expect(captureSolve?.restitution).toBe(simulationInput.settings.restitution);
		expect(capture).toMatchObject({
			selectedEndpoint: 'captured',
			meaningfulReboundVeto: false,
			retainedContactIds: [
				'body-contact:lower:middle:0',
				'body-contact:middle:upper:0',
				'fixed-contact:lower:floor:segment-face-positive:0'
			]
		});
		expect(
			capture?.contacts
				.filter(({ retained }) => retained)
				.every(({ supportReaction }) => supportReaction > 0)
		).toBe(true);
		expect(capture?.releasedContactIds).toEqual([
			'fixed-contact:lower:left-wall:segment-face-negative:0'
		]);
		expect(
			run.dynamicContacts.filter(({ state }) => state === 'retained').length
		).toBeGreaterThanOrEqual(2);
		expect(validateSimulationRun(simulationInput, run).failures).toEqual([]);
	});

	it('FLAME-90 applies one complete-component elastic response below the experimental cutoff', () => {
		const scenario = settlingScenarios.find(({ id }) => id === 'three-ball-settlement')!;
		const run = constructSimulationRun(scenario.input);
		const measured = (run.diagnostics.impactSolves ?? [])
			.filter(({ contactCapture }) => contactCapture?.selectedEndpoint === 'ordinary')
			.map((solve) => ({
				solve,
				impactSpeed: Math.max(
					0,
					...solve.contactGradients.map(
						(gradient) =>
							-gradient.reduce(
								(sum, value, index) => sum + value * solve.preImpactVelocity[index]!,
								0
							)
					)
				)
			}));
		const elastic = measured.find(({ solve }) => solve.restitution === 1);
		const nearestConfiguredAbove = measured
			.filter(({ impactSpeed }) => impactSpeed > 0.05)
			.sort((left, right) => left.impactSpeed - right.impactSpeed)[0];

		expect(elastic?.impactSpeed).toBeGreaterThan(0);
		expect(elastic?.impactSpeed).toBeLessThanOrEqual(0.05);
		expect(
			elastic?.solve.contactIds.filter((contactId) => contactId.startsWith('body-contact:'))
		).toHaveLength(1);
		expect(nearestConfiguredAbove?.impactSpeed).toBeGreaterThan(0.05);
		expect(nearestConfiguredAbove?.solve.restitution).toBe(scenario.input.settings.restitution);
	});

	it('FLAME-90 bypasses unsupported low-speed moving-pair captures with valid elastic responses', () => {
		for (const scenarioId of ['off-axis-incremental-pile', 'staggered-twenty-ball-pile']) {
			const scenario = settlingScenarios.find(({ id }) => id === scenarioId)!;
			const run = constructSimulationRun(scenario.input);
			const overrides = (run.diagnostics.impactSolves ?? []).filter(
				({ contactCapture, restitution }) =>
					contactCapture?.selectedEndpoint === 'captured' && restitution === 1
			);
			const overriddenContactIds = new Set(overrides.flatMap(({ contactIds }) => contactIds));
			const overriddenBodyContacts = run.dynamicContacts.filter(
				({ id, participants }) =>
					overriddenContactIds.has(id) && participants.every(({ type }) => type === 'body')
			);
			const validation = validateSimulationRun(scenario.input, run);

			expect(overrides.length, scenarioId).toBeGreaterThan(0);
			expect(overriddenBodyContacts.length, scenarioId).toBeGreaterThan(0);
			expect(
				overriddenBodyContacts.every(({ state }) => state === 'released'),
				scenarioId
			).toBe(true);
			expect(run.terminalReason.type, scenarioId).not.toBe('unsupported-body-body-response');
			expect(
				validation.failures.filter(
					({ message }) =>
						message ===
						'The resolved impact must satisfy equal-and-opposite impulse, tangential preservation, momentum, restitution and energy invariants.'
				),
				scenarioId
			).toEqual([]);
		}
	}, 10_000);
});

function input(): SimulationInput {
	return {
		scene: {
			id: 'flame-88-supported-stack',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 20, height: 10 },
			staticColliders: [
				{
					id: 'floor',
					motionAuthority: 'static',
					physicalShape: { type: 'line-segment', start: [-5, 0], end: [5, 0] }
				},
				{
					id: 'left-wall',
					motionAuthority: 'static',
					physicalShape: { type: 'line-segment', start: [-0.25, 0], end: [-0.25, 0.5] }
				}
			],
			terminationRegions: []
		},
		initialDynamicBodies: [
			body('lower', [0, 0.25]),
			body('middle', [0, 0.75]),
			body('upper', [0, 1.25])
		],
		settings: {
			gravity: [0, -10],
			restitution: 0.8,
			contactCaptureDistance: 1e-6,
			maximumEvents: 30,
			maximumSimulationTime: 0.25,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}

function body(id: string, position: Vec2): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: 0.25 },
		mass: 1,
		position,
		velocity: [0, -1e-3],
		releaseTime: 0
	};
}
