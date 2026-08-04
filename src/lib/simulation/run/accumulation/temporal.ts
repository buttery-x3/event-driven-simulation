import type { SimulationInput } from '../../contracts';
import { extractParticipantCluster } from './cluster';
import type {
	AccumulationPhysicalEvent,
	AccumulationTemporalCertificate,
	AccumulationCertificationMethod
} from './types';

export interface TemporalCertificationInput {
	readonly events: readonly AccumulationPhysicalEvent[];
	readonly eventTimeTolerance: number;
	readonly minimumEvents?: number;
}

/**
 * Lightweight candidate check used to distinguish a contracting cascade from a zero-time loop
 * before the complete limiting geometry is ready to promote.
 */
export function isAccumulationSequenceCandidate(
	simulation: SimulationInput,
	events: readonly AccumulationPhysicalEvent[],
	minimumEvents = 5
): boolean {
	const window = [...events].sort((left, right) => left.time - right.time).slice(-minimumEvents);
	const cluster = extractParticipantCluster(window);
	if (!cluster.stable) return false;
	const temporal = certifyTemporalTail({
		events: window,
		eventTimeTolerance: simulation.settings.tolerances.eventTime,
		minimumEvents
	});
	return temporal.type === 'certified';
}

/**
 * Certify a finite upper bound on the unresolved temporal tail from positive event intervals.
 * Geometric contraction: when recent ratios are bounded by r < 1, the remaining sum is at most
 * lastInterval * r / (1 - r).
 */
export function certifyTemporalTail(
	input: TemporalCertificationInput
):
	| { readonly type: 'certified'; readonly certificate: AccumulationTemporalCertificate }
	| { readonly type: 'rejected'; readonly reason: string } {
	const minimumEvents = input.minimumEvents ?? 5;
	const events = [...input.events].sort((left, right) => left.time - right.time);
	if (events.length < minimumEvents) {
		return { type: 'rejected', reason: `Need at least ${minimumEvents} positive-time events.` };
	}
	const times = events.map(({ time }) => time);
	const intervals = times.slice(1).map((time, index) => time - times[index]!);
	if (intervals.some((interval) => !(interval > input.eventTimeTolerance))) {
		return {
			type: 'rejected',
			reason: 'All accumulation source intervals must be strictly positive physical intervals.'
		};
	}
	const ratios = intervals.slice(1).map((interval, index) => interval / intervals[index]!);
	const recentRatios = ratios.slice(-3);
	const contractionRatioBound = Math.max(...recentRatios);
	if (!(contractionRatioBound < 1 - input.eventTimeTolerance)) {
		return {
			type: 'rejected',
			reason: 'Recent interval ratios are not certifiably contracting below unity.'
		};
	}
	// Require at least two strict contractions in the recent window, not merely "small" intervals.
	const strictContractions = recentRatios.filter((ratio) => ratio < 1 - input.eventTimeTolerance);
	if (strictContractions.length < 2) {
		return {
			type: 'rejected',
			reason: 'Insufficient strict interval contractions for a finite-tail certificate.'
		};
	}
	const lastInterval = intervals[intervals.length - 1]!;
	const remainingTimeUpperBound =
		(lastInterval * contractionRatioBound) / (1 - contractionRatioBound);
	if (!(Number.isFinite(remainingTimeUpperBound) && remainingTimeUpperBound >= 0)) {
		return { type: 'rejected', reason: 'Temporal tail bound is not finite and non-negative.' };
	}
	// Overall span must also shrink: last interval below the first observed interval.
	if (!(lastInterval < intervals[0]!)) {
		return {
			type: 'rejected',
			reason: 'Latest interval does not lie below the earliest interval in the window.'
		};
	}
	const currentCertifiedTime = times[times.length - 1]!;
	const method: AccumulationCertificationMethod = 'geometric-interval-contraction';
	return {
		type: 'certified',
		certificate: {
			method,
			sourceEventIds: events.map(({ eventId }) => eventId),
			eventTimes: times,
			intervals,
			contractionRatios: ratios,
			currentCertifiedTime,
			candidateLimitTime: currentCertifiedTime + remainingTimeUpperBound,
			remainingTimeUpperBound,
			contractionRatioBound
		}
	};
}
