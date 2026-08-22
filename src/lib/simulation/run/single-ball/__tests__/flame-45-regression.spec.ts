import { describe, expect, it } from 'vitest';
import forensicRunJson from '../../../../../../fixtures/regressions/flame-45-sub-tolerance-circle-release.json?raw';
import { evaluateMotionSegmentPosition } from '../../../motion';
import { parseSimulationRunFixture } from '../../../serialization/run-record';
import { validateSimulationRun } from '../../../verification';
import { constructSingleBallRun } from '../construct';

const releasedCircleId = 'peg-row-01-column-04';

describe('FLAME-45 sub-tolerance circle release regression', () => {
	it('retains the old tunnelling record as independently rejected forensic evidence', () => {
		const forensic = parseSimulationRunFixture(forensicRunJson);
		const validation = validateSimulationRun(forensic.input, forensic);

		expect(forensic).toMatchObject({ validity: 'valid', outcome: 'exited' });
		expect(validation.failures).toContainEqual(
			expect.objectContaining({
				category: 'collision-free-interval',
				code: 'EARLY_GEOMETRY_CROSSING',
				reference: expect.objectContaining({ colliderId: releasedCircleId })
			})
		);
	});

	it('converts the canonical sub-tolerance release into sustained circular contact', () => {
		const forensic = parseSimulationRunFixture(forensicRunJson);
		const corrected = constructSingleBallRun(forensic.input);
		const validation = validateSimulationRun(forensic.input, corrected);
		const retainedEntry = corrected.diagnostics.entries.find(
			({ code }) => code === 'FINITE_CONTACT_CAPTURE'
		);
		const capture = corrected.diagnostics.contactSearches.find(
			({ contactCapture }) => contactCapture?.selectedEndpoint === 'captured'
		)?.contactCapture;
		const retainedTransition = corrected.events.find(
			(event) =>
				event.type === 'contact-mode-transition' &&
				event.colliderId === releasedCircleId &&
				event.from === 'impact' &&
				event.to === 'sliding'
		);

		expect(corrected.terminalReason.type).not.toBe('zero-time-loop');
		expect(retainedTransition).toMatchObject({ from: 'impact', to: 'sliding' });
		if (capture) {
			expect(retainedEntry?.message).toContain('captured endpoint');
			expect(capture).toMatchObject({
				captureDistance: forensic.input.settings.contactCaptureDistance,
				selectedEndpoint: 'captured',
				meaningfulReboundVeto: false
			});
			expect(capture.retainedContactIds).toContain(`${releasedCircleId}:circle`);
			expect(
				capture.contacts.find(({ contactId }) => contactId === `${releasedCircleId}:circle`)
			).toMatchObject({ retained: true, withinCaptureDistance: true });
			expect(
				capture.contacts.find(({ contactId }) => contactId === `${releasedCircleId}:circle`)
					?.geometricNormalAcceleration
			).toBeGreaterThan(0);
			expect(retainedTransition).toMatchObject({ reason: 'impact-collapse' });
		} else {
			expect(retainedTransition).toMatchObject({ reason: 'collider-contact' });
		}
		expect(
			corrected.trajectories[0]!.segments.some(
				(segment) =>
					segment.type === 'circular-contact' && segment.supportingColliderId === releasedCircleId
			)
		).toBe(true);
		expect(validation.failures).toEqual([]);

		for (const segment of corrected.trajectories[0]!.segments) {
			if (segment.type !== 'free-flight') continue;
			for (let sample = 0; sample <= 64; sample += 1) {
				const time = segment.startTime + ((segment.endTime - segment.startTime) * sample) / 64;
				const position = evaluateMotionSegmentPosition(segment, time);
				const clearance = Math.hypot(position[0], position[1] - 5.75) - 0.23;
				expect(clearance).toBeGreaterThanOrEqual(
					-forensic.input.settings.tolerances.contactDistance
				);
			}
		}
	});

	it('keeps exact-centre and tiny mirrored launch offsets symmetric', () => {
		const forensic = parseSimulationRunFixture(forensicRunJson);
		const centre = constructSingleBallRun(withHorizontalPosition(forensic.input, 0));
		const left = constructSingleBallRun(withHorizontalPosition(forensic.input, -1e-9));
		const right = constructSingleBallRun(withHorizontalPosition(forensic.input, 1e-9));

		expect(centre.outcome).toBe('settled');
		expect(right.outcome).toBe(left.outcome);
		expect(right.terminalReason.type).toBe(left.terminalReason.type);
		expect(hasCircularSupport(left, releasedCircleId)).toBe(
			hasCircularSupport(right, releasedCircleId)
		);
		expect(validateSimulationRun(centre.input, centre).failures).toEqual([]);
		expect(validateSimulationRun(left.input, left).failures).toEqual([]);
		expect(validateSimulationRun(right.input, right).failures).toEqual([]);
	});
});

function hasCircularSupport(
	run: ReturnType<typeof constructSingleBallRun>,
	colliderId: string
): boolean {
	return run.trajectories[0]!.segments.some(
		(segment) => segment.type === 'circular-contact' && segment.supportingColliderId === colliderId
	);
}

function withHorizontalPosition(
	input: ReturnType<typeof parseSimulationRunFixture>['input'],
	x: number
) {
	const body = input.initialDynamicBodies[0]!;
	return {
		...input,
		initialDynamicBodies: [{ ...body, position: [x, body.position[1]] as const }]
	};
}
