import { describe, expect, it } from 'vitest';
import { canonicalPlinkoBoard } from '../canonical-board';
import { canonicalPlinkoScenarios } from '../scenarios/canonical-launches';

describe('canonical Plinko scenario catalogue', () => {
	it('provides the five required named, documented launch cases', () => {
		expect(canonicalPlinkoScenarios.map(({ id }) => id)).toEqual([
			'vertical-centre-drop',
			'offset-drop',
			'angled-launch',
			'high-speed-launch',
			'near-grazing-peg-contact'
		]);

		for (const scenario of canonicalPlinkoScenarios) {
			expect(scenario.initialConditionSummary.length).toBeGreaterThan(20);
			expect(scenario.verificationPurpose.length).toBeGreaterThan(20);
			expect(scenario.input.scene).toBe(canonicalPlinkoBoard);
			expect(scenario.input.initialDynamicBodies).toHaveLength(1);
			expect(scenario.input.settings.maximumSimulationTime).toBe(60);
		}
	});

	it('round-trips headlessly as serialisable data without renderer dependencies', () => {
		const restored = JSON.parse(
			JSON.stringify(canonicalPlinkoScenarios)
		) as typeof canonicalPlinkoScenarios;

		expect('window' in globalThis).toBe(false);
		expect('document' in globalThis).toBe(false);
		expect(restored).toEqual(canonicalPlinkoScenarios);
	});
});
