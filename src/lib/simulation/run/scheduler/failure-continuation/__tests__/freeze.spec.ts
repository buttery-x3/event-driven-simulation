import { describe, expect, it } from 'vitest';
import type { SimulationInput } from '../../../../contracts';
import { evaluateMotionSegmentVelocity } from '../../../../motion';
import { constructSimulationRun } from '../../construct';
import { settlingScenarios } from '../../../../world';

function scenario(id: string) {
	return settlingScenarios.find((entry) => entry.id === id)!;
}

function withPolicy(
	input: SimulationInput,
	failureContinuation: NonNullable<SimulationInput['settings']['failureContinuation']>
): SimulationInput {
	return { ...input, settings: { ...input.settings, failureContinuation } };
}

describe('FLAME-107 freeze-and-continue recovery', () => {
	it('detects first equivalent same-time recurrence in strict mode without a 256-retry loop', () => {
		const run = constructSimulationRun(
			withPolicy(scenario('off-axis-incremental-pile').input, 'strict')
		);
		const terminalTime = run.diagnostics.simulatedUntilTime;
		const stepsAtTerminal =
			run.diagnostics.schedulerSteps?.filter(({ worldTime }) => worldTime === terminalTime)
				.length ?? 0;

		expect(run.outcome).toBe('unresolved');
		expect([
			'zero-time-loop',
			'unsupported-body-body-response',
			'unresolved-collision-search'
		]).toContain(run.terminalReason.type);
		expect(run.physicalAuthority).toBeUndefined();
		expect(run.diagnostics.failureContinuations).toBeUndefined();
		expect(run.diagnostics.eventCount).toBeLessThan(200);
		expect(stepsAtTerminal).toBeLessThan(20);
		expect(run.terminalReason.time).toBeGreaterThan(4.0352);
	}, 20_000);

	it('freezes the affected component and lets world time advance under freeze-and-continue', () => {
		const run = constructSimulationRun(
			withPolicy(scenario('off-axis-incremental-pile').input, 'freeze-and-continue')
		);
		const continuation = run.diagnostics.failureContinuations?.[0];
		const frozenSegments = run.trajectories.flatMap(({ segments }) =>
			segments.filter(
				(segment) => segment.type === 'stationary' && segment.reason === 'frozen-after-unresolved'
			)
		);

		expect(continuation).toBeDefined();
		expect(continuation?.action).toBe('freeze-and-continue');
		expect([
			'zero-time-loop',
			'unsupported-body-body-response',
			'unresolved-collision-search'
		]).toContain(continuation?.originalFailure.type);
		expect(run.physicalAuthority).toEqual({
			type: 'approximate-after',
			time: continuation?.freezeTime
		});
		expect(continuation?.freezeTime).toBeGreaterThan(4.0352);
		expect(run.diagnostics.simulatedUntilTime).toBeGreaterThan(continuation!.freezeTime);
		expect(frozenSegments.length).toBeGreaterThan(0);
		expect(
			frozenSegments.every((segment) =>
				evaluateMotionSegmentVelocity(segment, segment.startTime).every((value) => value === 0)
			)
		).toBe(true);
		expect(
			run.releases.some(({ bodyId, status }) => bodyId === 'joining-03' && status === 'released')
		).toBe(true);
		expect(run.outcome).not.toBe('unresolved');
	}, 20_000);

	it('discovers a later collision against a previously frozen body', () => {
		const run = constructSimulationRun(
			withPolicy(scenario('off-axis-incremental-pile').input, 'freeze-and-continue')
		);
		const firstFreeze = run.diagnostics.failureContinuations?.[0];
		const frozenIds = new Set(firstFreeze?.affectedBodyIds ?? []);
		const laterContact = run.dynamicContacts.find(
			(contact) =>
				contact.time > (firstFreeze?.freezeTime ?? 0) &&
				contact.participants.some(
					(participant) => participant.type === 'body' && frozenIds.has(participant.bodyId)
				) &&
				contact.participants.some(
					(participant) =>
						participant.type === 'body' &&
						(participant.bodyId === 'joining-03' || !frozenIds.has(participant.bodyId))
				)
		);

		expect(firstFreeze).toBeDefined();
		expect(run.releases.find(({ bodyId }) => bodyId === 'joining-03')?.status).toBe('released');
		expect(laterContact || run.diagnostics.simulatedUntilTime > 5.5).toBeTruthy();
	}, 20_000);
});
