import { describe, expect, it } from 'vitest';
import { canonicalPlinkoScenarios } from '$lib/simulation/scenario-catalogue';
import {
	changeVelocityEntryMode,
	convertSpeedAndAngleToVelocity,
	createLaunchDraft,
	executeLaunchSubmission,
	prepareLaunchSubmission
} from './launch-controls';

const angledScenario = canonicalPlinkoScenarios.find(({ id }) => id === 'angled-launch')!;

describe('workbench launch controls', () => {
	it('converts user-facing speed and angle deterministically into velocity', () => {
		expect(convertSpeedAndAngleToVelocity(2, 0)).toEqual([2, 0]);
		expect(convertSpeedAndAngleToVelocity(2, 90)).toEqual([0, 2]);
		expect(convertSpeedAndAngleToVelocity(2, -90)).toEqual([0, -2]);
		const diagonal = convertSpeedAndAngleToVelocity(Math.SQRT2, 45);
		expect(diagonal[0]).toBeCloseTo(1, 14);
		expect(diagonal[1]).toBeCloseTo(1, 14);
	});

	it('keeps the authoritative vector aligned when changing entry modes', () => {
		const speedDraft = {
			...createLaunchDraft(angledScenario.input),
			speed: '2',
			angleDegrees: '-90'
		};
		const componentDraft = changeVelocityEntryMode(speedDraft, 'components');
		expect(componentDraft).toMatchObject({
			velocityMode: 'components',
			velocityX: '0',
			velocityY: '-2'
		});

		expect(changeVelocityEntryMode(componentDraft, 'speed-angle')).toMatchObject({
			velocityMode: 'speed-angle',
			speed: '2',
			angleDegrees: '-90'
		});
	});

	it('reports typed field errors before creating a submission', () => {
		const draft = {
			...createLaunchDraft(angledScenario.input),
			positionX: '',
			speed: '-1'
		};
		const result = prepareLaunchSubmission(angledScenario.input, draft);

		expect(result).toEqual({
			valid: false,
			errors: [
				{
					field: 'positionX',
					code: 'REQUIRED',
					message: 'Initial position X is required.'
				},
				{
					field: 'speed',
					code: 'NEGATIVE_SPEED',
					message: 'Launch speed must be zero or greater.'
				}
			]
		});
	});

	it('snapshots an immutable submitted input independently of later draft and scenario changes', () => {
		const draft = {
			...createLaunchDraft(angledScenario.input),
			positionX: '-1.25',
			velocityMode: 'components' as const,
			velocityX: '2.5',
			velocityY: '-0.75'
		};
		const baseInput = JSON.parse(
			JSON.stringify(angledScenario.input)
		) as typeof angledScenario.input;
		const result = prepareLaunchSubmission(baseInput, draft);
		expect(result.valid).toBe(true);
		if (!result.valid) return;

		const submittedJson = JSON.stringify(result.input);
		const mutableDraft = draft as { positionX: string };
		mutableDraft.positionX = '0';
		(baseInput.initialDynamicBodies[0]!.position as unknown as [number, number])[0] = -99;

		expect(JSON.stringify(result.input)).toBe(submittedJson);
		expect(result.input.initialDynamicBodies[0]).toMatchObject({
			position: [-1.25, 6.5],
			velocity: [2.5, -0.75]
		});
		expect(Object.isFrozen(result.input)).toBe(true);
		expect(Object.isFrozen(result.input.initialDynamicBodies[0])).toBe(true);
	});

	it('keeps submission and completed run state separate from the editable draft', () => {
		const draft = createLaunchDraft(angledScenario.input);
		const submission = prepareLaunchSubmission(angledScenario.input, draft);
		expect(submission.valid).toBe(true);
		if (!submission.valid) return;

		const calculation = executeLaunchSubmission(submission.input);
		const updatedDraft = { ...draft, positionX: '0' };

		expect(updatedDraft.positionX).not.toBe(
			calculation.submittedInput.initialDynamicBodies[0]!.position[0].toString()
		);
		expect(calculation.submittedInput).toBe(submission.input);
		expect(calculation.run.input).toBe(calculation.submittedInput);
		expect(calculation.run.events).not.toBe(calculation.submittedInput);
	});
});
