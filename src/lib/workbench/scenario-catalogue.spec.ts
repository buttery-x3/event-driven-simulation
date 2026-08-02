import { describe, expect, it } from 'vitest';
import {
	adversarialScenarios,
	boardStateScenarios,
	canonicalPlinkoScenarios
} from '$lib/simulation/world';
import {
	assessScenarioOutcome,
	defaultWorkbenchScenario,
	getWorkbenchScenario,
	workbenchScenarioCategories,
	workbenchScenarios
} from './scenario-catalogue';

describe('workbench scenario catalogue', () => {
	it('adapts every world scenario without copying its input', () => {
		expect(workbenchScenarios).toHaveLength(
			canonicalPlinkoScenarios.length + boardStateScenarios.length + adversarialScenarios.length
		);
		expect(new Set(workbenchScenarios.map(({ id }) => id)).size).toBe(workbenchScenarios.length);

		for (const source of [
			...canonicalPlinkoScenarios,
			...boardStateScenarios,
			...adversarialScenarios
		]) {
			expect(getWorkbenchScenario(source.id)?.input).toBe(source.input);
		}
	});

	it('keeps stable category metadata ready for later catalogue sources', () => {
		expect(workbenchScenarioCategories.map(({ id }) => id)).toEqual([
			'canonical-launches',
			'board-layouts',
			'physical-settings',
			'adversarial-contacts',
			'saved-regression-cases'
		]);
		expect(getWorkbenchScenario('dense')?.categoryId).toBe('board-layouts');
		expect(getWorkbenchScenario('angled-ramp')?.categoryId).toBe('physical-settings');
		expect(getWorkbenchScenario('close-contacts')?.categoryId).toBe('adversarial-contacts');
		expect(getWorkbenchScenario('lateral-gravity')?.categoryId).toBe('physical-settings');
		expect(defaultWorkbenchScenario.id).toBe('vertical-centre-drop');
	});

	it('compares authoritative outcomes only with the scenario that produced the current run', () => {
		const closeContacts = getWorkbenchScenario('close-contacts')!;
		expect(assessScenarioOutcome(closeContacts, null, null)).toEqual({
			status: 'not-run',
			actualOutcome: null
		});
		expect(assessScenarioOutcome(closeContacts, 'dense', 'unresolved').status).toBe('not-run');
		expect(assessScenarioOutcome(closeContacts, closeContacts.id, 'unresolved').status).toBe(
			'matched'
		);
		expect(assessScenarioOutcome(closeContacts, closeContacts.id, 'exited')).toEqual({
			status: 'mismatched',
			actualOutcome: 'exited'
		});
	});
});
