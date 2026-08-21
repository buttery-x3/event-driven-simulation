import { describe, expect, it } from 'vitest';
import type { DynamicContactRecord, SimulationRunRecord } from '../../contracts';
import { constructSimulationRun } from '../../run';
import { settlingScenarios } from '../../world';
import { validateSimulationRun } from '..';

const scenario = settlingScenarios.find(({ id }) => id === 'three-ball-settlement')!;

describe('FLAME-98 represented-rest support evidence', () => {
	it('keeps post-impact support records out of impact-phase body-contact checks', () => {
		const run = constructSimulationRun(scenario.input);
		const dual = dualPhaseRecords(run);

		expect(run.outcome).toBe('settled');
		expect(scenario.input.settings.restitution).toBe(0.03);
		expect(dual.impactComponent.type).toBe('exact-time-impact');
		expect(dual.restingComponent.type).toBe('resting-anchored');
		expect(dual.impactContact.preImpactNormalVelocity).toBeCloseTo(-0.04500350242066405, 12);
		expect(dual.supportContact.preImpactNormalVelocity).toBe(0);
		expect(dual.supportContact.postImpactNormalVelocity).toBe(0);
		expect(dual.prediction.decision).toBe('selected');
		expect(dual.prediction.queryOutcome).toBe('contact');
		expect(dual.prediction.bodyIds).toEqual(bodyPair(dual.impactContact));

		const valid = validateSimulationRun(run.input, run);
		expect(
			valid.failures.filter(
				({ code, reference }) =>
					code === 'IMPACT_EVIDENCE_MISMATCH' &&
					reference.path === `$.dynamicContacts[${dual.supportIndex}]`
			)
		).toEqual([]);
		expect(valid.failures.filter(({ code }) => code === 'IMPACT_EVIDENCE_MISMATCH')).toEqual([]);

		const corrupted = structuredClone(run);
		const impact = corrupted.dynamicContacts[dual.impactIndex]!;
		Object.assign(impact, {
			preImpactNormalVelocity: (impact.preImpactNormalVelocity ?? 0) - 1
		});
		expect(validateSimulationRun(run.input, corrupted).failures).toContainEqual(
			expect.objectContaining({
				category: 'contact-geometry',
				code: 'IMPACT_EVIDENCE_MISMATCH',
				reference: expect.objectContaining({
					path: `$.dynamicContacts[${dual.impactIndex}]`
				})
			})
		);
	});
});

function dualPhaseRecords(run: SimulationRunRecord) {
	const supportContact = run.dynamicContacts.find(
		(contact) =>
			contact.id.startsWith('support-contact:') &&
			contact.id.includes('body-contact:collapse-1:collapse-2:')
	);
	expect(supportContact).toBeDefined();
	const impactContact = run.dynamicContacts.find(
		(contact) =>
			contact.time === supportContact!.time &&
			contact.id.startsWith('body-contact:collapse-1:collapse-2:')
	);
	expect(impactContact).toBeDefined();
	const impactComponent = run.contactComponents.find(
		(component) =>
			component.type === 'exact-time-impact' &&
			component.activeContactIds.includes(impactContact!.id)
	);
	const restingComponent = run.contactComponents.find(
		(component) =>
			component.type === 'resting-anchored' &&
			component.activeContactIds.includes(supportContact!.id)
	);
	expect(impactComponent).toBeDefined();
	expect(restingComponent).toBeDefined();
	const pair = bodyPair(impactContact!);
	const prediction = run.diagnostics.pairPredictions.find(
		(candidate) =>
			candidate.decision === 'selected' &&
			candidate.queryOutcome === 'contact' &&
			candidate.predictedTime === supportContact!.time &&
			candidate.bodyIds[0] === pair[0] &&
			candidate.bodyIds[1] === pair[1]
	);
	expect(prediction).toBeDefined();
	return {
		impactContact: impactContact!,
		supportContact: supportContact!,
		impactComponent: impactComponent!,
		restingComponent: restingComponent!,
		prediction: prediction!,
		impactIndex: run.dynamicContacts.findIndex(({ id }) => id === impactContact!.id),
		supportIndex: run.dynamicContacts.findIndex(({ id }) => id === supportContact!.id)
	};
}

function bodyPair(contact: DynamicContactRecord): readonly [string, string] {
	const participants = contact.participants.filter(
		(participant): participant is Extract<typeof participant, { type: 'body' }> =>
			participant.type === 'body'
	);
	return [participants[0]!.bodyId, participants[1]!.bodyId];
}
