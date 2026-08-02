import { describe, expect, it } from 'vitest';
import { canonicalPlinkoScenarios } from '$lib/simulation/world';
import { createSimulationInputDraft } from './simulation-input-draft';
import { changeVelocityEntryMode, convertSpeedAndAngleToVelocity } from './velocity-entry';

const angledScenario = canonicalPlinkoScenarios.find(({ id }) => id === 'angled-launch')!;

describe('velocity entry', () => {
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
			...createSimulationInputDraft(angledScenario.input),
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
});
