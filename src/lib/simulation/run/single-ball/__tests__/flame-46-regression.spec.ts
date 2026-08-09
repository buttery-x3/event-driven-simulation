import { describe, expect, it } from 'vitest';
import exactFitJson from '../../../../../../fixtures/regressions/flame-46-exact-fit-tangent-release.json?raw';
import oversizedJson from '../../../../../../fixtures/regressions/flame-46-oversized-two-peg-rest.json?raw';
import type { SimulationInput, StaticCollider } from '../../../contracts';
import { parseSimulationInputFixture } from '../../../serialization/simulation-input';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { constructSingleBallRun } from '../construct';

const exactFitInput = parseSimulationInputFixture(exactFitJson);
const oversizedInput = parseSimulationInputFixture(oversizedJson);

describe('FLAME-46 accumulation regressions while FLAME-57 is incomplete', () => {
	it('retains the exact-fit contracting prefix without promoting an observed ratio', () => {
		const run = constructSingleBallRun(exactFitInput);
		const diagnostic = unsupportedDiagnostic(run);

		expect(run.outcome).toBe('unresolved');
		expect(run.terminalReason.type).toBe('zero-time-loop');
		expect(diagnostic.sourceEventIds).toHaveLength(5);
		expect(diagnostic.candidateFixedColliderIds).toEqual(['dense-peg-01-06', 'dense-peg-01-07']);
		expect(promotions(run)).toEqual([]);
		expect(
			run.trajectories
				.flatMap(({ segments }) => segments)
				.some(({ type }) => type === 'accumulation-tail')
		).toBe(false);
		expect(parseSimulationRunFixture(JSON.stringify(run))).toEqual(run);
	});

	it('retains the oversized contracting prefix and exposes the unsupported continuation', () => {
		const run = constructSingleBallRun(oversizedInput);
		const diagnostic = unsupportedDiagnostic(run);

		expect(run.outcome).toBe('invalid');
		expect(run.terminalReason).toMatchObject({ type: 'invalid-state', time: expect.any(Number) });
		expect(JSON.stringify(run.terminalReason)).toContain('penetrating the fixed circle');
		expect(diagnostic.candidateFixedColliderIds).toEqual(['dense-peg-01-06', 'dense-peg-01-07']);
		expect(promotions(run)).toEqual([]);
		expect(parseSimulationRunFixture(JSON.stringify(run))).toEqual(run);
	});

	it('preserves collider-order and collider-renaming invariance at the blocked boundary', () => {
		const baseline = constructSingleBallRun(oversizedInput);
		const reversed = constructSingleBallRun(
			withColliders(oversizedInput, [...oversizedInput.scene.staticColliders].reverse())
		);
		const renamedColliderIds = new Map<string, string>();
		const renamed = constructSingleBallRun(
			withColliders(
				oversizedInput,
				oversizedInput.scene.staticColliders.map((collider, index) => {
					const renamedId = `renamed-${index}`;
					renamedColliderIds.set(renamedId, collider.id);
					return { ...collider, id: renamedId };
				})
			)
		);

		expect(reversed.trajectories).toEqual(baseline.trajectories);
		expect(normalizeIdentifiers(renamed.trajectories, renamedColliderIds)).toEqual(
			baseline.trajectories
		);
		expect(reversed.outcome).toBe(baseline.outcome);
		expect(renamed.outcome).toBe(baseline.outcome);
		expect(normalizeIdentifiers(renamed.terminalReason, renamedColliderIds)).toEqual(
			baseline.terminalReason
		);
		expect(
			normalizeIdentifiers(
				{ ...renamed.diagnostics, simulationWallTimeMilliseconds: 0 },
				renamedColliderIds
			)
		).toEqual({ ...baseline.diagnostics, simulationWallTimeMilliseconds: 0 });
	});

	it.todo('releases the exact-fit ball through proved limit geometry and FLAME-53 lineality');
	it.todo('settles the oversized ball through a proved limit and FLAME-54 support reactions');
});

function unsupportedDiagnostic(run: ReturnType<typeof constructSingleBallRun>) {
	const diagnostic = run.diagnostics.accumulations?.find(({ reason }) =>
		reason.includes('no supported analytic accumulation family')
	);
	expect(diagnostic).toBeDefined();
	return diagnostic!;
}

function promotions(run: ReturnType<typeof constructSingleBallRun>) {
	return (run.diagnostics.accumulations ?? []).filter(({ status }) => status === 'certified');
}

function withColliders(
	input: SimulationInput,
	staticColliders: readonly StaticCollider[]
): SimulationInput {
	return { ...input, scene: { ...input.scene, staticColliders } };
}

function normalizeIdentifiers<T>(value: T, aliases: ReadonlyMap<string, string>): T {
	const replacements = [...aliases].sort(([left], [right]) => right.length - left.length);
	return JSON.parse(
		JSON.stringify(value, (_key, nestedValue) => {
			if (typeof nestedValue !== 'string') return nestedValue;
			return replacements.reduce(
				(normalized, [alias, canonical]) => normalized.replaceAll(alias, canonical),
				nestedValue
			);
		})
	) as T;
}
