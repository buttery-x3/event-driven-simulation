import { describe, expect, it } from 'vitest';
import type { DynamicContactRecord, SimulationRunRecord } from '../../../../contracts';
import { evaluateMotionSegmentVelocity } from '../../../../motion';
import { constructSimulationRun } from '../../../../run';
import { validateSimulationRun } from '../../../../verification';
import { settlingScenarios } from '../definitions';

const requiredIds = [
	'three-ball-settlement',
	'off-axis-incremental-pile',
	'staggered-twenty-ball-pile',
	'legacy-twenty-ball-container-drop-control'
] as const;

const runs = new Map<string, SimulationRunRecord>();

describe('FLAME-89 finite-capture settling frontier', () => {
	it('publishes deterministic default-distance scenarios with the legacy geometry isolated as a control', () => {
		expect(settlingScenarios.map(({ id }) => id)).toEqual(requiredIds);
		expect(
			settlingScenarios.every(
				({ expectedOutcomes, input }) =>
					expectedOutcomes.length === 1 && input.settings.contactCaptureDistance === 1e-9
			)
		).toBe(true);

		const threeBall = scenario('three-ball-settlement');
		expect(
			threeBall.input.initialDynamicBodies.map(({ position, velocity }) => ({ position, velocity }))
		).toEqual([
			{ position: [-2, 0.5], velocity: [2, 0] },
			{ position: [0, 0.5], velocity: [-0.5, 0] },
			{ position: [2, 0.5], velocity: [-1.5, 0] }
		]);

		const incremental = scenario('off-axis-incremental-pile');
		const joining = incremental.input.initialDynamicBodies.slice(1);
		expect(joining.map(({ releaseTime }) => releaseTime)).toEqual([0.75, 3, 5.5]);
		expect(joining.map(({ position }) => Math.sign(position[0]))).toEqual([-1, 1, -1]);
		expect(joining.every(({ position }) => position[0] !== 0)).toBe(true);

		const staggered = scenario('staggered-twenty-ball-pile');
		expect(staggered.input.initialDynamicBodies).toHaveLength(20);
		expect(staggered.regressionFixture).toBe(false);
		expect(hasPositiveInitialSeparation(staggered)).toBe(true);
		expect(rowXCoordinates(staggered, 1)).not.toEqual(rowXCoordinates(staggered, 2));

		const legacy = scenario('legacy-twenty-ball-container-drop-control');
		expect(legacy.regressionFixture).toBe(true);
		expect(rowXCoordinates(legacy, 1)).toEqual(rowXCoordinates(legacy, 2));
	});

	it('keeps the supported FLAME-57 reproducer outside finite capture before represented rest', () => {
		const result = run('three-ball-settlement');
		const decisions = captureDecisions(result);

		expect(result.outcome).toBe('settled');
		expect(decisions.every(({ selectedEndpoint }) => selectedEndpoint === 'ordinary')).toBe(true);
		expect(capturedDecisions(result)).toEqual([]);
		expect(bodyPairEdges(result)).toEqual(['collapse-1<->collapse-2', 'collapse-2<->collapse-3']);
		expect(validateSimulationRun(result.input, result).failures).toEqual([]);
	});

	it('finds no three-ball sensitivity in the one permitted FLAME-87 proof-scale comparison', () => {
		const baseline = run('three-ball-settlement');
		const coarseInput = {
			...baseline.input,
			settings: { ...baseline.input.settings, contactCaptureDistance: 1e-6 }
		};
		const coarse = constructSimulationRun(coarseInput);

		expect(
			captureDecisions(coarse).every(({ selectedEndpoint }) => selectedEndpoint === 'ordinary')
		).toBe(true);
		expect(coarse.outcome).toBe(baseline.outcome);
		expect(coarse.diagnostics.eventCount).toBe(baseline.diagnostics.eventCount);
		expect(maximumTerminalSpeed(coarse)).toBe(maximumTerminalSpeed(baseline));
	});

	it('retains joining-01 left-wall contact into floor rest instead of a microscopic free-flight rebound', () => {
		const result = run('off-axis-incremental-pile');
		const joining01 = result.bodyStates.find(({ bodyId }) => bodyId === 'joining-01');
		const joining01Rest = result.contactComponents.find(
			(component) =>
				component.type === 'resting-anchored' &&
				component.bodyIds.includes('joining-01') &&
				component.fixedColliderIds.includes('floor') &&
				component.fixedColliderIds.includes('left-wall')
		);
		const wallSlide = result.trajectories
			.find(({ bodyId }) => bodyId === 'joining-01')
			?.segments.find(
				(segment) =>
					segment.type === 'linear-contact' && segment.supportingColliderId === 'left-wall'
			);

		expect(result.outcome).toBe('unresolved');
		expect([
			'zero-time-loop',
			'unresolved-collision-search',
			'unsupported-body-body-response'
		]).toContain(result.terminalReason.type);
		expect(result.diagnostics.eventCount).toBeGreaterThan(0);
		expect(joining01?.lifecycle).toBe('resting');
		expect(joining01Rest?.fixedColliderIds).toEqual(['floor', 'left-wall']);
		expect(wallSlide).toMatchObject({
			type: 'linear-contact',
			supportingColliderId: 'left-wall'
		});
		expect(JSON.stringify(result.terminalReason)).not.toContain('Body pair joining-01/joining-02');
		expect(JSON.stringify(result.terminalReason)).not.toContain('penetrating');
		expect(JSON.stringify(result.terminalReason)).not.toContain(
			'A bounded circular interval could not certify contact or separation.'
		);
		expect(result.terminalReason.time).toBeGreaterThan(4.0352);
		expect(
			result.dynamicContacts.some(
				(contact) =>
					contact.time > 4.033 &&
					contact.participants.some(
						(participant) => participant.type === 'body' && participant.bodyId === 'base'
					) &&
					contact.participants.some(
						(participant) => participant.type === 'body' && participant.bodyId === 'joining-02'
					)
			)
		).toBe(true);
		expect(bodyPairEdges(result)).toEqual([
			'base<->joining-01',
			'base<->joining-02',
			'joining-01<->joining-02'
		]);
		expect(obliqueBodyContacts(result).length).toBeGreaterThan(0);
		expect(hasChangingPartners(result)).toBe(true);
		expect(
			result.componentEvents.some(
				({ change, reactivatedBodyIds }) =>
					change === 'dissolved' && reactivatedBodyIds?.includes('base')
			)
		).toBe(true);
		expect(maximumTerminalSpeed(result)).toBeGreaterThan(0.8);
	}, 15_000);

	it('forms changing diagonal dense-pile contacts before the same downstream retained-pair boundary', () => {
		const result = run('staggered-twenty-ball-pile');
		const capture = capturedDecisions(result)[0]!;
		const floorTime = Math.min(...fixedContactTimes(result, 'floor'));

		expect(result.outcome).toBe('unresolved');
		expect(result.diagnostics.eventCount).toBeGreaterThan(0);
		expect(result.terminalReason).toMatchObject({
			type: 'unsupported-body-body-response',
			bodyIds: ['staggered-1-1', 'staggered-2-1']
		});
		expect(capture.retainedContactIds).toEqual([
			expect.stringMatching(/^body-contact:staggered-1-1:staggered-2-1:/),
			expect.stringMatching(/^fixed-contact:staggered-2-1:left-wall:/),
			expect.stringMatching(/^fixed-contact:staggered-1-1:floor:/)
		]);
		expect(bodyPairEdges(result).length).toBeGreaterThanOrEqual(7);
		expect(obliqueBodyContacts(result).length).toBeGreaterThanOrEqual(20);
		expect(hasChangingPartners(result)).toBe(true);
		expect(obliqueBodyContacts(result).some(({ time }) => time >= floorTime)).toBe(true);
		expect(maximumTerminalSpeed(result)).toBeGreaterThan(2);
		// Represented fixed-contact retention reaches the same unsupported pair terminal,
		// but same-time rest recording currently duplicates dense-pile evidence. That is a
		// later record-integrity frontier, not this issue's wall-release fix.
		expect(
			validateSimulationRun(result.input, result).failures.every(({ code }) =>
				[
					'INVALID_CONTACT_PARTICIPANT',
					'MALFORMED_COMPONENT_MEMBERSHIP',
					'PENETRATING_POST_IMPACT_VELOCITY',
					'IMPACT_EVIDENCE_MISMATCH'
				].includes(code)
			)
		).toBe(true);
	}, 180_000);

	it('uses the five-column legacy input only to show capture replaced its former root-topology failure', () => {
		const result = run('legacy-twenty-ball-container-drop-control');

		expect(result.outcome).toBe('event-limit');
		expect(result.diagnostics.eventCount).toBeGreaterThan(0);
		expect(JSON.stringify(result.terminalReason)).not.toContain('indeterminate local topology');
		expect(result.terminalReason).toMatchObject({ type: 'event-limit', limit: 1_000 });
		expect(capturedDecisions(result)).toHaveLength(0);
		expect(bodyPairEdges(result)).toHaveLength(15);
		expect(obliqueBodyContacts(result)).toEqual([]);
		const failures = validateSimulationRun(result.input, result).failures;
		expect(failures).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: 'terminal-outcome',
					code: 'LIMIT_MISMATCH'
				})
			])
		);
		expect(
			failures.every(({ code }) => code === 'LIMIT_MISMATCH' || code === 'EARLY_GEOMETRY_CROSSING')
		).toBe(true);
	}, 180_000);
});

function scenario(id: (typeof requiredIds)[number]) {
	return settlingScenarios.find((candidate) => candidate.id === id)!;
}

function run(id: (typeof requiredIds)[number]): SimulationRunRecord {
	const cached = runs.get(id);
	if (cached) return cached;
	const result = constructSimulationRun(scenario(id).input);
	runs.set(id, result);
	return result;
}

function captureDecisions(run: SimulationRunRecord) {
	return (run.diagnostics.impactSolves ?? []).flatMap(({ contactCapture }) =>
		contactCapture ? [contactCapture] : []
	);
}

function capturedDecisions(run: SimulationRunRecord) {
	return captureDecisions(run).filter(({ selectedEndpoint }) => selectedEndpoint === 'captured');
}

function bodyContacts(run: SimulationRunRecord): readonly DynamicContactRecord[] {
	return run.dynamicContacts.filter(({ participants }) =>
		participants.every(({ type }) => type === 'body')
	);
}

function obliqueBodyContacts(run: SimulationRunRecord): readonly DynamicContactRecord[] {
	return bodyContacts(run).filter(
		({ normalFromFirstToSecond: [x, y] }) => Math.abs(x) > 1e-6 && Math.abs(y) > 1e-6
	);
}

function bodyPairEdges(run: SimulationRunRecord): readonly string[] {
	return [
		...new Set(
			bodyContacts(run).map(({ participants }) =>
				participants
					.map((participant) => (participant.type === 'body' ? participant.bodyId : ''))
					.sort()
					.join('<->')
			)
		)
	].sort();
}

function hasChangingPartners(run: SimulationRunRecord): boolean {
	const partners = new Map<string, Set<string>>();
	for (const { participants } of bodyContacts(run)) {
		const bodyIds = participants.flatMap((participant) =>
			participant.type === 'body' ? [participant.bodyId] : []
		);
		if (bodyIds.length !== 2) continue;
		for (const [bodyId, partnerId] of [
			[bodyIds[0]!, bodyIds[1]!],
			[bodyIds[1]!, bodyIds[0]!]
		] as const) {
			const current = partners.get(bodyId) ?? new Set<string>();
			current.add(partnerId);
			partners.set(bodyId, current);
		}
	}
	return [...partners.values()].some((values) => values.size > 1);
}

function fixedContactTimes(run: SimulationRunRecord, colliderId: string): readonly number[] {
	return run.dynamicContacts
		.filter(({ participants }) =>
			participants.some(
				(participant) =>
					participant.type === 'fixed-collider' && participant.colliderId === colliderId
			)
		)
		.map(({ time }) => time);
}

function maximumTerminalSpeed(run: SimulationRunRecord): number {
	return Math.max(
		0,
		...run.trajectories.map(({ segments }) => {
			const segment = segments.at(-1);
			if (!segment) return 0;
			return Math.hypot(...evaluateMotionSegmentVelocity(segment, segment.endTime));
		})
	);
}

function hasPositiveInitialSeparation(candidate: ReturnType<typeof scenario>): boolean {
	const bodies = candidate.input.initialDynamicBodies;
	return bodies.every((body, index) =>
		bodies.slice(index + 1).every((other) => {
			const distance = Math.hypot(
				body.position[0] - other.position[0],
				body.position[1] - other.position[1]
			);
			return distance > body.physicalShape.radius + other.physicalShape.radius;
		})
	);
}

function rowXCoordinates(candidate: ReturnType<typeof scenario>, row: number): readonly number[] {
	const yCoordinates = [
		...new Set(candidate.input.initialDynamicBodies.map(({ position }) => position[1]))
	].sort((left, right) => left - right);
	const y = yCoordinates[row - 1];
	return candidate.input.initialDynamicBodies
		.filter(({ position }) => position[1] === y)
		.map(({ position }) => position[0])
		.sort((left, right) => left - right);
}
