import type { RunOutcome, SimulationInput } from '$lib/simulation/contracts';
import { boardStateScenarios, canonicalPlinkoScenarios } from '$lib/simulation/world';

export type WorkbenchScenarioCategoryId =
	| 'canonical-launches'
	| 'board-layouts'
	| 'physical-settings'
	| 'adversarial-contacts'
	| 'saved-regression-cases';

export interface WorkbenchScenarioCategory {
	readonly id: WorkbenchScenarioCategoryId;
	readonly name: string;
}

export interface WorkbenchScenarioDescriptor {
	readonly id: string;
	readonly name: string;
	readonly categoryId: WorkbenchScenarioCategoryId;
	readonly verificationPurpose: string;
	readonly expectedOutcomes: readonly RunOutcome[];
	readonly input: SimulationInput;
}

export type ScenarioOutcomeAssessment =
	| { readonly status: 'not-run'; readonly actualOutcome: null }
	| { readonly status: 'matched' | 'mismatched'; readonly actualOutcome: RunOutcome };

export const workbenchScenarioCategories = [
	{ id: 'canonical-launches', name: 'Canonical launches' },
	{ id: 'board-layouts', name: 'Board layouts' },
	{ id: 'physical-settings', name: 'Physical settings' },
	{ id: 'adversarial-contacts', name: 'Adversarial contacts' },
	{ id: 'saved-regression-cases', name: 'Saved regression cases' }
] as const satisfies readonly WorkbenchScenarioCategory[];

const canonicalExpectedOutcomes: Readonly<Record<string, readonly RunOutcome[]>> = {
	'vertical-centre-drop': ['settled'],
	'offset-drop': ['exited'],
	'angled-launch': ['exited'],
	'high-speed-launch': ['exited'],
	'near-grazing-peg-contact': ['exited']
};

const boardLayoutScenarioIds = new Set([
	'no-pegs',
	'isolated-peg',
	'sparse',
	'canonical',
	'dense',
	'mirrored-sparse',
	'reversed-sparse'
]);

export const workbenchScenarios = [
	...canonicalPlinkoScenarios.map((scenario): WorkbenchScenarioDescriptor => ({
		id: scenario.id,
		name: scenario.name,
		categoryId: 'canonical-launches',
		verificationPurpose: scenario.verificationPurpose,
		expectedOutcomes: canonicalExpectedOutcomes[scenario.id]!,
		input: scenario.input
	})),
	...boardStateScenarios.map((scenario): WorkbenchScenarioDescriptor => ({
		id: scenario.id,
		name: scenario.name,
		categoryId:
			scenario.id === 'close-contacts'
				? 'adversarial-contacts'
				: boardLayoutScenarioIds.has(scenario.id)
					? 'board-layouts'
					: 'physical-settings',
		verificationPurpose: scenario.verificationPurpose,
		expectedOutcomes: scenario.expectedOutcomes,
		input: scenario.input
	}))
] as const satisfies readonly WorkbenchScenarioDescriptor[];

export const defaultWorkbenchScenario = workbenchScenarios[0];

export function getWorkbenchScenario(id: string | null): WorkbenchScenarioDescriptor | undefined {
	return workbenchScenarios.find((scenario) => scenario.id === id);
}

export function assessScenarioOutcome(
	scenario: WorkbenchScenarioDescriptor,
	actualScenarioId: string | null,
	actualOutcome: RunOutcome | null
): ScenarioOutcomeAssessment {
	if (scenario.id !== actualScenarioId || actualOutcome === null) {
		return { status: 'not-run', actualOutcome: null };
	}

	return {
		status: scenario.expectedOutcomes.includes(actualOutcome) ? 'matched' : 'mismatched',
		actualOutcome
	};
}
