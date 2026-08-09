import { describe, expect, it } from 'vitest';
import exactFitJson from '../../../../../../fixtures/regressions/flame-46-exact-fit-tangent-release.json?raw';
import oversizedJson from '../../../../../../fixtures/regressions/flame-46-oversized-two-peg-rest.json?raw';
import { toRendererPlaybackInput } from '$lib/rendering/playback';
import type { SimulationInput, StaticCollider } from '../../../contracts';
import { evaluateMotionSegmentPosition } from '../../../motion';
import { parseSimulationInputFixture } from '../../../serialization/simulation-input';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { validateSimulationRun } from '../../../verification';
import { constructSingleBallRun } from '../construct';

const exactFitInput = parseSimulationInputFixture(exactFitJson);
const oversizedInput = parseSimulationInputFixture(oversizedJson);
const leftPegId = 'dense-peg-01-06';
const rightPegId = 'dense-peg-01-07';

describe('FLAME-46 general accumulation promotion', () => {
	it('releases the exact-fit ball downward through the tangent throat', () => {
		const run = constructSingleBallRun(exactFitInput);

		expect(run.outcome).toBe('settled');
		expect(run.terminalReason.type).not.toBe('zero-time-loop');
		expect(validateSimulationRun(run.input, run).failures).toEqual([]);
		const promotion = promotedAccumulation(run, 'release');
		expect(promotion?.mechanism).toBe('general-accumulation');
		expect(promotion?.limit?.activeLimitContacts.map(fixedColliderId).sort()).toEqual([
			leftPegId,
			rightPegId
		]);
		const impact = run.diagnostics.impactSolves?.find((solve) =>
			promotion?.downstreamImpactComponentIds.includes(solve.componentId ?? '')
		);
		expect(impact?.linealityDimension).toBeGreaterThan(0);
		expect(impact?.finalVelocity[1]).toBeLessThan(0);
		const release = run.trajectories[0]!.segments.find(
			(segment) =>
				segment.type === 'free-flight' && segment.startTime === promotion?.limit?.candidateLimitTime
		);
		expect(release?.startVelocity[1]).toBeLessThan(0);
		expect(targetPegClearances(run)).toEqual([]);
		expect(parseSimulationRunFixture(JSON.stringify(run))).toEqual(run);
		expect(toRendererPlaybackInput(run).events).toEqual(run.events);
	});

	it('settles the oversized ball on the acquired two-peg support', () => {
		const run = constructSingleBallRun(oversizedInput);

		expect(run.outcome).toBe('settled');
		const promotion = promotedAccumulation(run, 'rest');
		expect(promotion?.limit?.activeLimitContacts.map(fixedColliderId).sort()).toEqual([
			leftPegId,
			rightPegId
		]);
		expect(promotion?.downstreamSupportComponentIds).not.toEqual([]);
		const resting = run.contactComponents.find(({ id }) =>
			promotion?.downstreamSupportComponentIds.includes(id)
		);
		expect(resting?.type).toBe('resting-anchored');
		expect(
			resting?.retainedSupportReactions.every(({ impulsePerTime }) => impulsePerTime >= 0)
		).toBe(true);
		expect(
			run.trajectories[0]!.segments.some(
				(segment) =>
					segment.type === 'circular-contact' &&
					(segment.supportingColliderId === leftPegId ||
						segment.supportingColliderId === rightPegId)
			)
		).toBe(false);
		expect(validateSimulationRun(run.input, run).failures).toEqual([]);
		expect(parseSimulationRunFixture(JSON.stringify(run))).toEqual(run);
		expect(toRendererPlaybackInput(run).terminalReason).toEqual(run.terminalReason);
		expect(promotion?.mechanism).toBe('general-accumulation');
	});

	it('keeps the exact-width boundary geometric and tolerance-aware', () => {
		const below = constructSingleBallRun(withRadius(exactFitInput, 0.134999));
		const exact = constructSingleBallRun(exactFitInput);
		const above = constructSingleBallRun(withRadius(exactFitInput, 0.135001));

		expect(below.outcome).not.toBe('settled');
		expect(below.terminalReason.type).not.toBe('zero-time-loop');
		expect(promotedAccumulation(exact, 'release')).toBeDefined();
		expect(exact.terminalReason.type).not.toBe('zero-time-loop');
		expect(promotedAccumulation(above, 'rest')).toBeDefined();
		expect(validateSimulationRun(below.input, below).failures).toEqual([]);
		expect(validateSimulationRun(exact.input, exact).failures).toEqual([]);
		expect(validateSimulationRun(above.input, above).failures).toEqual([]);
	});

	it('preserves mirror, collider-order, and collider-renaming invariance', () => {
		const input = oversizedInput;
		const baseline = constructSingleBallRun(input);
		const reversed = constructSingleBallRun(
			withColliders(input, [...input.scene.staticColliders].reverse())
		);
		const renamed = constructSingleBallRun(
			withColliders(
				input,
				input.scene.staticColliders.map((collider, index) => ({
					...collider,
					id: `renamed-${index}`
				}))
			)
		);
		const mirrored = constructSingleBallRun(mirrorInput(input));

		expect(reversed.trajectories).toEqual(baseline.trajectories);
		expect(renamed.trajectories).toEqual(baseline.trajectories);
		expect(reversed.outcome).toBe(baseline.outcome);
		expect(renamed.outcome).toBe(baseline.outcome);
		expect(mirrored.outcome).toBe(baseline.outcome);
		expect(mirrored.terminalReason.time).toBeCloseTo(baseline.terminalReason.time ?? 0, 10);
	});

	it('fails independent validation when the reported finite tail bound is tampered', () => {
		const run = constructSingleBallRun(oversizedInput);
		const accumulationIndex = run.diagnostics.accumulations?.findIndex(
			({ finalClassification }) => finalClassification === 'rest'
		);
		expect(accumulationIndex).toBeGreaterThanOrEqual(0);
		const tampered = {
			...run,
			diagnostics: {
				...run.diagnostics,
				accumulations: run.diagnostics.accumulations!.map((candidate, index) =>
					index === accumulationIndex && candidate.limit
						? {
								...candidate,
								limit: {
									...candidate.limit,
									remainingTimeUpperBound: candidate.limit.remainingTimeUpperBound + 1
								}
							}
						: candidate
				)
			}
		};

		expect(
			validateSimulationRun(tampered.input, tampered).failures.some(
				({ code }) => code === 'LIMIT_MISMATCH'
			)
		).toBe(true);
	});
});

function promotedAccumulation(
	run: ReturnType<typeof constructSingleBallRun>,
	classification: 'release' | 'rest'
) {
	return run.diagnostics.accumulations?.find(
		(accumulation) =>
			accumulation.status === 'certified' &&
			accumulation.finalClassification === classification &&
			accumulation.limit !== null
	);
}

function fixedColliderId(contact: { readonly type: string; readonly colliderId?: string }): string {
	return contact.colliderId ?? '';
}

function targetPegClearances(run: ReturnType<typeof constructSingleBallRun>) {
	const radius = run.input.initialDynamicBodies[0]!.physicalShape.radius;
	const pegs = run.input.scene.staticColliders.filter(
		(collider) => 'centre' in collider && (collider.id === leftPegId || collider.id === rightPegId)
	);
	return run.trajectories[0]!.segments.flatMap((segment) => {
		if (segment.type !== 'free-flight') return [];
		const fractions = [0, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.1, 0.5, 1];
		return fractions.flatMap((fraction) => {
			const time = segment.startTime + (segment.endTime - segment.startTime) * fraction;
			const position = evaluateMotionSegmentPosition(segment, time);
			return pegs.flatMap((peg) => {
				if (!('centre' in peg)) return [];
				const clearance =
					Math.hypot(position[0] - peg.centre[0], position[1] - peg.centre[1]) -
					peg.physicalShape.radius -
					radius;
				return clearance < -run.input.settings.tolerances.contactDistance ? [clearance] : [];
			});
		});
	});
}

function withRadius(input: SimulationInput, radius: number): SimulationInput {
	return {
		...input,
		initialDynamicBodies: [
			{ ...input.initialDynamicBodies[0]!, physicalShape: { type: 'circle', radius } }
		],
		settings: {
			...input.settings,
			gravity: [0, -9.81],
			restitution: 0.6,
			maximumEvents: 200,
			maximumSimulationTime: 8
		}
	};
}

function withColliders(
	input: SimulationInput,
	staticColliders: readonly StaticCollider[]
): SimulationInput {
	return { ...input, scene: { ...input.scene, staticColliders } };
}

function mirrorInput(input: SimulationInput): SimulationInput {
	return {
		...input,
		scene: {
			...input.scene,
			staticColliders: input.scene.staticColliders.map((collider) =>
				'centre' in collider
					? { ...collider, centre: [-collider.centre[0], collider.centre[1]] }
					: {
							...collider,
							physicalShape: {
								...collider.physicalShape,
								start: [-collider.physicalShape.start[0], collider.physicalShape.start[1]],
								end: [-collider.physicalShape.end[0], collider.physicalShape.end[1]]
							}
						}
			)
		},
		initialDynamicBodies: input.initialDynamicBodies.map((body) => ({
			...body,
			position: [-body.position[0], body.position[1]],
			velocity: [-body.velocity[0], body.velocity[1]]
		}))
	};
}
