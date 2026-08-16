import type { RunOutcome } from '$lib/simulation/contracts';
import {
	adversarialScenarios,
	boardStateScenarios,
	canonicalPlinkoScenarios,
	dynamicPairScenarios,
	dormantComponentScenarios,
	dynamicSupportScenarios,
	pathInterruptionScenarios,
	independentBodySchedulerScenarios,
	manifoldContactScenarios,
	simultaneousImpactScenarios,
	settlingScenarios,
	type ScenarioCategoryId,
	type VerificationScenario
} from '$lib/simulation/world';

export type WorkbenchScenarioCategoryId = ScenarioCategoryId;

export interface WorkbenchScenarioCategory {
	readonly id: WorkbenchScenarioCategoryId;
	readonly name: string;
}

export type WorkbenchScenarioDescriptor = VerificationScenario;

export type ScenarioOutcomeAssessment =
	| { readonly status: 'not-run'; readonly actualOutcome: null }
	| { readonly status: 'matched' | 'mismatched'; readonly actualOutcome: RunOutcome };

export const workbenchScenarioCategories = [
	{ id: 'canonical-launches', name: 'Canonical launches' },
	{ id: 'board-layouts', name: 'Board layouts' },
	{ id: 'physical-settings', name: 'Physical settings' },
	{ id: 'multi-body-scheduler', name: 'Multi-body scheduler' },
	{ id: 'adversarial-contacts', name: 'Adversarial contacts' },
	{ id: 'saved-regression-cases', name: 'Saved regression cases' }
] as const satisfies readonly WorkbenchScenarioCategory[];

export const workbenchScenarios = [
	...canonicalPlinkoScenarios,
	...boardStateScenarios,
	...manifoldContactScenarios,
	...independentBodySchedulerScenarios,
	...dynamicPairScenarios,
	...simultaneousImpactScenarios,
	...dormantComponentScenarios,
	...dynamicSupportScenarios,
	...pathInterruptionScenarios,
	...settlingScenarios,
	...adversarialScenarios
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
