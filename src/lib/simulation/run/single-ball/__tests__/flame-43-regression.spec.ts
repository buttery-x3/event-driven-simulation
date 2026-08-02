import { describe, expect, it } from 'vitest';
import turningPointRunJson from '../../../../../../fixtures/regressions/flame-43-circular-turning-point.json?raw';
import { dotVec2 } from '../../../math';
import { evaluateMotionSegmentPosition, evaluateMotionSegmentVelocity } from '../../../motion';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { constructSingleBallRun } from '../construct';

describe('FLAME-43 circular turning-point regression', () => {
	it('preserves the certified prefix and reverses through an exact continuous segment boundary', () => {
		const fixture = parseSimulationRunFixture(turningPointRunJson);
		expect(fixture).toMatchObject({
			validity: 'valid',
			outcome: 'escaped',
			terminalReason: { type: 'bounds-escape', boundary: 'bottom' }
		});

		const segments = fixture.trajectories[0]!.segments;
		const freeFlightPrefix = segments[0]!;
		const circular = segments.filter((segment) => segment.type === 'circular-contact');
		expect(freeFlightPrefix.endTime).toBeCloseTo(0.007467817083602716, 14);
		expect(circular).toHaveLength(2);
		const uphill = circular[0]!;
		const downhill = circular[1]!;
		expect(uphill).toMatchObject({
			direction: -1,
			startAngle: 1.9989487619448874,
			startTangentialSpeed: 0.0690993851087908
		});
		expect(downhill).toMatchObject({ direction: 1, startTangentialSpeed: 0 });
		expect(uphill.endTime).toBe(downhill.startTime);
		expect(uphill.endAngle).toBe(downhill.startAngle);

		const turningPosition = evaluateMotionSegmentPosition(uphill, uphill.endTime);
		const turningVelocity = evaluateMotionSegmentVelocity(uphill, uphill.endTime);
		expect(turningPosition).toEqual(downhill.startPosition);
		expect(turningVelocity[0]).toBeCloseTo(0, 12);
		expect(turningVelocity[1]).toBeCloseTo(0, 12);
		expect(downhill.startVelocity).toEqual([0, 0]);
		const turningNormal = [Math.cos(downhill.startAngle), Math.sin(downhill.startAngle)] as const;
		expect(-dotVec2(downhill.gravity, turningNormal)).toBeGreaterThan(0);

		const afterTurningTime = downhill.startTime + (downhill.endTime - downhill.startTime) / 10;
		const afterTurningVelocity = evaluateMotionSegmentVelocity(downhill, afterTurningTime);
		const downhillTangent = [-turningNormal[1], turningNormal[0]] as const;
		expect(dotVec2(afterTurningVelocity, downhillTangent)).toBeGreaterThan(0);
	});

	it('reconstructs the complete fixture without an unresolved or zero-time terminal result', () => {
		const fixture = parseSimulationRunFixture(turningPointRunJson);
		const rerun = constructSingleBallRun(fixture.input);

		expect(rerun.outcome).toBe('escaped');
		expect(rerun.terminalReason.type).not.toMatch(/unresolved|zero-time-loop/);
		expect(rerun.trajectories).toEqual(fixture.trajectories);
		expect(rerun.events).toEqual(fixture.events);
		expect(parseSimulationRunFixture(JSON.stringify(rerun))).toEqual(rerun);
	});
});
