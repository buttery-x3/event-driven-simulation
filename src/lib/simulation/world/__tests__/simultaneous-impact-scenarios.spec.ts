import { describe, expect, it } from 'vitest';
import { constructSimulationRun } from '../../run';
import { validateSimulationRun } from '../../verification';
import { simultaneousImpactScenarios } from '../scenarios';

describe('production simultaneous-impact scenarios', () => {
	it('provides every FLAME-53 named scenario through the production scheduler', () => {
		expect(simultaneousImpactScenarios.map(({ id }) => id)).toEqual([
			'three-ball-newtons-cradle',
			'two-balls-and-floor-simultaneous',
			'symmetric-three-body-impact',
			'inactive-contact-removed',
			'exact-versus-near-simultaneous',
			'participant-order-invariance',
			'unsupported-retained-dynamic-contact',
			'implicit-equality-anti-locking',
			'floating-point-scale-invariance',
			'multi-body-lineality-component',
			'termination-certification-failure'
		]);
		for (const scenario of simultaneousImpactScenarios) {
			const result = constructSimulationRun(scenario.input);
			expect(scenario.expectedOutcomes, scenario.id).toContain(result.outcome);
			expect(validateSimulationRun(scenario.input, result).failures, scenario.id).toEqual([]);
		}
	});

	it("matches Newton's cradle, symmetric, and supported-floor analytical outcomes", () => {
		expect(finalVelocities(run('three-ball-newtons-cradle'))).toEqual({
			left: [0, 0],
			centre: [0, 0],
			right: [2, 0]
		});
		const symmetric = finalVelocities(run('symmetric-three-body-impact'));
		expect(symmetric.left[0]).toBeCloseTo(-1, 12);
		expect(symmetric.centre[0]).toBeCloseTo(0, 12);
		expect(symmetric.right[0]).toBeCloseTo(1, 12);
		expect(finalVelocities(run('two-balls-and-floor-simultaneous'))).toEqual({
			lower: [0, 0],
			upper: [0, 1]
		});
	});

	it('rejects inactive geometry and preserves a positive-time ordered event', () => {
		const inactive = run('inactive-contact-removed');
		expect(
			inactive.diagnostics.impactSolves![0]!.candidateEvidence!.some(
				({ type, active, separation }) => type === 'body-body' && !active && separation > 0
			)
		).toBe(true);
		const ordered = run('exact-versus-near-simultaneous');
		const times = [...new Set(ordered.contactComponents.map(({ createdAtTime }) => createdAtTime))];
		expect(times).toHaveLength(2);
		expect(times[1]).toBeGreaterThan(times[0]!);
	});

	it('is invariant to participant names and declaration order', () => {
		const baseline = finalVelocities(run('symmetric-three-body-impact'));
		const reordered = Object.values(finalVelocities(run('participant-order-invariance'))).sort(
			(left, right) => left[0] - right[0]
		);
		expect(reordered).toEqual(Object.values(baseline).sort((left, right) => left[0] - right[0]));
	});

	it('records anti-locking, scale-aware reflections, and multi-body lineality', () => {
		const antiLocking = firstSolve(run('implicit-equality-anti-locking'));
		const throatIndex = antiLocking.bodyIds.indexOf('throat-body') * 2;
		expect(antiLocking.linealityDimension).toBeGreaterThan(0);
		expect(antiLocking.projectedVelocity[throatIndex]).toBe(0);
		expect(antiLocking.projectedVelocity[throatIndex + 1]).toBe(-1);

		const scaled = run('floating-point-scale-invariance').diagnostics.impactSolves!;
		expect(scaled).toHaveLength(3);
		expect(scaled.every(({ reflections }) => reflections.length <= 1)).toBe(true);

		const multiBody = firstSolve(run('multi-body-lineality-component'));
		expect(multiBody.bodyIds).toHaveLength(3);
		expect(multiBody.linealityDimension).toBeGreaterThan(0);
	});

	it('promotes a resolved supported contact graph into persistent dormancy', () => {
		const result = run('unsupported-retained-dynamic-contact');
		expect(result.terminalReason).toMatchObject({ type: 'world-complete', outcome: 'settled' });
		expect(firstSolve(result).completion).toBe('complete');
		expect(result.dynamicContacts.some(({ state }) => state === 'retained')).toBe(true);
		expect(
			result.contactComponents.some(
				({ type, dissolvedAtTime }) => type === 'resting-anchored' && dissolvedAtTime === null
			)
		).toBe(true);
	});

	it('fails closed at the deliberate contact resource boundary', () => {
		const result = run('termination-certification-failure');
		expect(result.terminalReason).toMatchObject({ type: 'numerical-failure' });
		expect('detail' in result.terminalReason ? result.terminalReason.detail : '').toContain(
			'resource boundary'
		);
		expect(result.dynamicContacts).toHaveLength(17);
		expect(result.dynamicContacts.every(({ state }) => state === 'incoming')).toBe(true);
	});
});

function run(id: (typeof simultaneousImpactScenarios)[number]['id']) {
	const scenario = simultaneousImpactScenarios.find((candidate) => candidate.id === id)!;
	return constructSimulationRun(scenario.input);
}

function firstSolve(result: ReturnType<typeof run>) {
	return result.diagnostics.impactSolves![0]!;
}

function finalVelocities(result: ReturnType<typeof run>) {
	const solve = firstSolve(result);
	return Object.fromEntries(
		solve.bodyIds.map((bodyId, index) => [
			bodyId,
			[solve.finalVelocity[index * 2]!, solve.finalVelocity[index * 2 + 1]!]
		])
	);
}
