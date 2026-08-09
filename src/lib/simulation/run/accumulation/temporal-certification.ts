import type { AccumulationObservation, TemporalCertification } from './types';

const minimumObservationCount = 5;
const maximumEnvelopeRatio = 0.95;
const maximumRatioSpread = 0.3;

export const unsupportedObservedRatioReason =
	'Observed contraction ratios are finite-prefix evidence only; no supported analytic accumulation family certifies that future event intervals remain below the observed ratio.';

export function certifyTemporalTail(
	observations: readonly AccumulationObservation[],
	eventTimeResolution: number
): TemporalCertification | string {
	void eventTimeResolution;
	if (observations.length < minimumObservationCount)
		return `At least ${minimumObservationCount} connected physical events are required.`;
	const eventTimes = observations.map(({ time }) => time);
	const intervals = eventTimes.slice(1).map((time, index) => time - eventTimes[index]!);
	if (intervals.some((interval) => !(interval > 0) || !Number.isFinite(interval)))
		return 'Every accumulation source interval must be finite and strictly positive.';
	if (intervals.some((interval, index) => index > 0 && interval >= intervals[index - 1]!))
		return 'The recent physical-event intervals do not form a strictly contracting envelope.';
	const ratios = intervals.slice(1).map((interval, index) => interval / intervals[index]!);
	if (ratios.some((ratio) => !(ratio > 0) || !Number.isFinite(ratio)))
		return 'The interval contraction ratios are not finite and positive.';
	const observedMaximum = Math.max(...ratios);
	const observedMinimum = Math.min(...ratios);
	if (observedMaximum > maximumEnvelopeRatio)
		return 'The observed contraction has no supported ratio bounded away from one.';
	if (observedMaximum - observedMinimum > maximumRatioSpread)
		return 'The observed contraction ratios do not fit the supported stable envelope.';
	return unsupportedObservedRatioReason;
}
