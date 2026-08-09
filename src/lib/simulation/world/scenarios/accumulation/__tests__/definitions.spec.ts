import { describe, expect, it } from 'vitest';
import type { AccumulationDiagnostic, SimulationRunRecord } from '../../../../contracts';
import { constructSimulationRun } from '../../../../run';
import { accumulationScenarios } from '../definitions';

const requiredIds = [
	'flame-46-exact-fit-generalised',
	'flame-46-oversized-generalised',
	'three-ball-settlement',
	'dynamic-alternating-supports',
	'multi-body-non-alternating-accumulation',
	'lineality-created-at-accumulation',
	'accumulation-separates-components',
	'incremental-pile-formation',
	'twenty-ball-container-drop',
	'pile-reactivated-after-settlement',
	'dense-nonconverging-cascade',
	'uncertifiable-temporal-tail',
	'uncertifiable-limit-geometry'
] as const;

const runs = new Map<string, SimulationRunRecord>();

describe('FLAME-57 production accumulation scenarios', () => {
	it('publishes every required scenario with one exact observed outcome', () => {
		expect(accumulationScenarios.map(({ id }) => id)).toEqual(requiredIds);
		expect(
			accumulationScenarios.every(({ expectedOutcomes }) => expectedOutcomes.length === 1)
		).toBe(true);
	});

	it.each(accumulationScenarios)('$id records its narrow current production result', (scenario) => {
		const result = run(scenario.id);
		expect(result.outcome, JSON.stringify(result.terminalReason)).toBe(
			scenario.expectedOutcomes[0]
		);
	});

	it('does not promote any observed-ratio prefix as a certified accumulation', () => {
		for (const scenario of accumulationScenarios) expect(promotions(run(scenario.id))).toEqual([]);
	});

	it.each(['flame-46-exact-fit-generalised', 'flame-46-oversized-generalised'])(
		'%s retains a genuine contracting FLAME-46 prefix but rejects heuristic certification',
		(id) => {
			const diagnostic = unsupportedDiagnostic(run(id));
			const times = sourceTimes(run(id), diagnostic);
			expect(times.length).toBeGreaterThanOrEqual(5);
			expect(strictlyPositiveDifferences(times)).toBe(true);
			expect(diagnostic.participantBodyIds).toHaveLength(1);
			expect(diagnostic.candidateFixedColliderIds).toEqual(['dense-peg-01-06', 'dense-peg-01-07']);
		}
	);

	it('three-ball-settlement is now a real supported three-body contraction, not a time-zero pile', () => {
		const result = run('three-ball-settlement');
		const diagnostic = unsupportedDiagnostic(result);
		const times = sourceTimes(result, diagnostic);

		expect(result.events.filter(({ type, time }) => type === 'contact' && time === 0)).toHaveLength(
			3
		);
		expect(bodyPairEdges(result)).toEqual(
			expect.arrayContaining(['collapse-1<->collapse-2', 'collapse-2<->collapse-3'])
		);
		expect(diagnostic.participantBodyIds).toEqual(['collapse-1', 'collapse-2', 'collapse-3']);
		expect(strictlyContractingIntervals(times)).toBe(true);
		expect(result.outcome).toBe('time-limit');
	});

	it('dynamic-alternating-supports records both dynamic and fixed edges in its source components', () => {
		const result = run('dynamic-alternating-supports');
		const diagnostic = unsupportedDiagnostic(result);
		const components = sourceComponents(result, diagnostic);

		expect(diagnostic.participantBodyIds).toEqual(['collapse-1', 'collapse-2', 'collapse-3']);
		expect(
			components.every(
				({ activeContactIds }) =>
					activeContactIds.some((id) => id.startsWith('body-contact:')) &&
					activeContactIds.some((id) => id.startsWith('fixed-contact:'))
			)
		).toBe(true);
		expect(strictlyContractingIntervals(sourceTimes(result, diagnostic))).toBe(true);
	});

	it('multi-body-non-alternating-accumulation produces a changing four-body edge history', () => {
		const result = run('multi-body-non-alternating-accumulation');
		const edges = bodyPairEdges(result);
		const maximumCandidateSize = Math.max(
			0,
			...(result.diagnostics.accumulations ?? []).map(
				({ participantBodyIds }) => participantBodyIds.length
			)
		);

		expect(edges).toEqual(
			expect.arrayContaining([
				'collapse-1<->collapse-2',
				'collapse-2<->collapse-3',
				'collapse-3<->collapse-4'
			])
		);
		expect(maximumCandidateSize).toBe(4);
		expect(promotions(result)).toEqual([]);
		expect(rejectionReasons(result)).toContain(
			'Observed contraction ratios are finite-prefix evidence only; no supported analytic accumulation family certifies that future event intervals remain below the observed ratio.'
		);
	});

	it('lineality candidate uses a dedicated minimal throat and alternating physical contacts', () => {
		const scenario = scenarioById('lineality-created-at-accumulation');
		const result = run(scenario.id);
		const sourceIds = unsupportedDiagnostic(result).sourceEventIds;

		expect(scenario.input.scene.staticColliders.map(({ id }) => id)).toEqual([
			'throat-left',
			'throat-right',
			'floor'
		]);
		expect(sourceIds.some((id) => id.includes('throat-left'))).toBe(true);
		expect(sourceIds.some((id) => id.includes('throat-right'))).toBe(true);
		expect(promotions(result)).toEqual([]);
	});

	it('separation candidate is a genuine unsupported three-body contraction, not a time cutoff alias', () => {
		const result = run('accumulation-separates-components');
		const diagnostic = unsupportedDiagnostic(result);
		expect(diagnostic.participantBodyIds).toEqual(['collapse-1', 'collapse-2', 'collapse-3']);
		expect(strictlyContractingIntervals(sourceTimes(result, diagnostic))).toBe(true);
		expect(result.input.scene.staticColliders).toEqual([]);
		expect(promotions(result)).toEqual([]);
	});

	it('incremental pile releases a falling body that physically reaches the supported base', () => {
		const result = run('incremental-pile-formation');
		expect(
			result.releases.some(({ bodyId, time }) => bodyId === 'joining-01' && time === 0.75)
		).toBe(true);
		expect(bodyPairEdges(result)).toContain('base<->joining-01');
		expect(result.terminalReason).toMatchObject({
			type: 'unresolved-collision-search',
			time: expect.any(Number)
		});
		expect(JSON.stringify(result.terminalReason)).toContain('indeterminate local topology');
	});

	it('twenty-ball-container-drop really drops twenty moving bodies and preserves the scale failure', () => {
		const scenario = scenarioById('twenty-ball-container-drop');
		const result = run(scenario.id);
		const firstContactTime = Math.min(
			...result.events.filter(({ type }) => type === 'contact').map(({ time }) => time)
		);

		expect(scenario.input.initialDynamicBodies).toHaveLength(20);
		expect(
			scenario.input.initialDynamicBodies.every(
				({ physicalShape, position }) => position[1] > physicalShape.radius
			)
		).toBe(true);
		expect(firstContactTime).toBeGreaterThan(0);
		expect(bodyPairEdges(result).length).toBeGreaterThanOrEqual(5);
		expect(result.outcome).toBe('unresolved');
		expect(JSON.stringify(result.terminalReason)).toContain('indeterminate local topology');
	});

	it('dense-nonconverging-cascade rejects non-contracting intervals without promotion', () => {
		const result = run('dense-nonconverging-cascade');
		expect(promotions(result)).toEqual([]);
		expect(rejectionReasons(result)).toEqual([
			'The recent physical-event intervals do not form a strictly contracting envelope.'
		]);
	});

	it('uncertifiable-temporal-tail has a shrinking physical prefix and the exact missing-proof reason', () => {
		const result = run('uncertifiable-temporal-tail');
		const diagnostic = unsupportedDiagnostic(result);
		expect(strictlyContractingIntervals(sourceTimes(result, diagnostic))).toBe(true);
		expect(diagnostic.reason).toContain('finite-prefix evidence only');
		expect(diagnostic.limit).toBeNull();
	});

	it('uncertifiable-limit-geometry remains blocked at its honest temporal prerequisite', () => {
		const result = run('uncertifiable-limit-geometry');
		expect(bodyPairEdges(result).length).toBeGreaterThanOrEqual(3);
		expect(rejectionReasons(result)).toContain(
			'Observed contraction ratios are finite-prefix evidence only; no supported analytic accumulation family certifies that future event intervals remain below the observed ratio.'
		);
		expect(promotions(result)).toEqual([]);
	});

	it.todo('settles the supported three-ball contraction through a certified accumulation');
	it.todo('proves lineality appears only in reconstructed limit geometry and FLAME-53 evidence');
	it.todo('produces downstream separation or release after certified multi-body promotion');
	it.todo('forms the complete incremental pile and reactivates it after certified settlement');
	it.todo('settles the genuine twenty-ball dynamic drop through certified accumulation');
	it.todo('reaches and rejects limiting geometry after a certified temporal prerequisite');
});

function scenarioById(id: string) {
	return accumulationScenarios.find((scenario) => scenario.id === id)!;
}

function run(id: string): SimulationRunRecord {
	const cached = runs.get(id);
	if (cached) return cached;
	const result = constructSimulationRun(scenarioById(id).input);
	runs.set(id, result);
	return result;
}

function promotions(result: SimulationRunRecord): readonly AccumulationDiagnostic[] {
	return (result.diagnostics.accumulations ?? []).filter(
		({ status, finalClassification }) => status === 'certified' && finalClassification !== 'pending'
	);
}

function rejectionReasons(result: SimulationRunRecord): readonly string[] {
	return [
		...new Set(
			(result.diagnostics.accumulations ?? [])
				.filter(({ status }) => status === 'rejected')
				.map(({ reason }) => reason)
		)
	];
}

function unsupportedDiagnostic(result: SimulationRunRecord): AccumulationDiagnostic {
	const diagnostic = (result.diagnostics.accumulations ?? []).find(({ reason }) =>
		reason.includes('no supported analytic accumulation family')
	);
	expect(diagnostic).toBeDefined();
	return diagnostic!;
}

function sourceComponents(result: SimulationRunRecord, diagnostic: AccumulationDiagnostic) {
	return diagnostic.sourceEventIds
		.filter((id) => id.startsWith('physical-component-contact:'))
		.map((id) =>
			result.contactComponents.find(
				({ id: componentId }) => componentId === id.slice('physical-component-contact:'.length)
			)
		)
		.filter((component): component is NonNullable<typeof component> => component !== undefined);
}

function sourceTimes(
	result: SimulationRunRecord,
	diagnostic: AccumulationDiagnostic
): readonly number[] {
	return diagnostic.sourceEventIds.map((id) => {
		if (id.startsWith('physical-component-contact:')) {
			const componentId = id.slice('physical-component-contact:'.length);
			return result.contactComponents.find(({ id }) => id === componentId)!.createdAtTime;
		}
		return Number(id.split(':')[2]);
	});
}

function strictlyPositiveDifferences(times: readonly number[]): boolean {
	return times.slice(1).every((time, index) => time > times[index]!);
}

function strictlyContractingIntervals(times: readonly number[]): boolean {
	if (!strictlyPositiveDifferences(times)) return false;
	const intervals = times.slice(1).map((time, index) => time - times[index]!);
	return intervals.slice(1).every((interval, index) => interval < intervals[index]!);
}

function bodyPairEdges(result: SimulationRunRecord): readonly string[] {
	return [
		...new Set(
			result.dynamicContacts.flatMap(({ participants }) => {
				const ids = participants.flatMap((participant) =>
					participant.type === 'body' ? [participant.bodyId] : []
				);
				return ids.length === 2 ? [ids.sort().join('<->')] : [];
			})
		)
	];
}
