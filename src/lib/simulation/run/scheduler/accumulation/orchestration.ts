import type { AccumulationDiagnostic } from '../../../contracts';
import { certifyAccumulationLimit, type AccumulationObservation } from '../../accumulation';
import type { LocalBodyPrediction } from '../../single-ball/local-events';
import type { SchedulerState } from '../types';
import type { ExactTimeComponent } from '../pairs/component';
import type { PairCommitResult } from '../pairs/commit';
import { recordAccumulationDiagnostic } from './diagnostics';
import { localAccumulationObservation, pairAccumulationObservation } from './observations';
import { promoteAccumulationLimit } from './promotion';

export function tryPromoteLocalAccumulation(
	state: SchedulerState,
	prediction: Extract<LocalBodyPrediction, { readonly kind: 'contact' }>
): PairCommitResult | null {
	const observation = localAccumulationObservation(state, prediction);
	return observation ? observeAndPromote(state, observation) : null;
}

export function tryPromotePairAccumulation(
	state: SchedulerState,
	component: ExactTimeComponent
): PairCommitResult | null {
	return observeAndPromote(state, pairAccumulationObservation(state, component));
}

function observeAndPromote(
	state: SchedulerState,
	observation: AccumulationObservation
): PairCommitResult | null {
	state.accumulationHistory.push(observation);
	const certification = certifyAccumulationLimit(state.input, state.accumulationHistory);
	if (certification.type === 'rejected') {
		if (certification.diagnostic.sourceEventIds.length >= 5)
			recordAccumulationDiagnostic(state, certification.diagnostic, observation.time);
		return null;
	}
	recordAccumulationDiagnostic(state, certification.diagnostic, observation.time);
	const externalEventTime = earliestExternalEventTime(
		state,
		new Set(certification.limit.participantBodyIds)
	);
	if (
		externalEventTime <
		certification.limit.currentCertifiedTime + certification.limit.remainingTimeUpperBound
	) {
		recordAccumulationDiagnostic(
			state,
			rejected(
				certification.diagnostic,
				`External event at ${externalEventTime} precedes the candidate limit-time bound.`
			),
			observation.time
		);
		return null;
	}
	if (!(certification.limit.candidateLimitTime > certification.limit.currentCertifiedTime)) {
		recordAccumulationDiagnostic(
			state,
			rejected(
				certification.diagnostic,
				'The candidate mathematical limit time is not later than the certified event.'
			),
			observation.time
		);
		return null;
	}
	const promotion = promoteAccumulationLimit(state, certification.limit, observation);
	if (!promotion) {
		recordAccumulationDiagnostic(
			state,
			rejected(
				certification.diagnostic,
				'The certified limit could not be adapted to the current scheduler state.'
			),
			observation.time
		);
		return null;
	}
	recordAccumulationDiagnostic(
		state,
		{
			...certification.diagnostic,
			downstreamImpactComponentIds: promotion.impactComponentIds,
			downstreamSupportComponentIds: promotion.supportComponentIds,
			finalClassification: promotion.classification
		},
		observation.time
	);
	return promotion.result;
}

function earliestExternalEventTime(
	state: SchedulerState,
	participantBodyIds: ReadonlySet<string>
): number {
	return Math.min(
		state.input.settings.maximumSimulationTime,
		state.scheduled[0]?.releaseTime ?? Number.POSITIVE_INFINITY,
		...[...state.predictions.values()]
			.filter(({ bodyId }) => !participantBodyIds.has(bodyId))
			.map(({ time }) => time),
		...state.pairPredictions
			.filter(
				({ decision, predictedTime, bodyIds }) =>
					decision === 'retained' &&
					predictedTime !== null &&
					bodyIds.some((bodyId) => !participantBodyIds.has(bodyId))
			)
			.map(({ predictedTime }) => predictedTime!)
	);
}

function rejected(diagnostic: AccumulationDiagnostic, reason: string): AccumulationDiagnostic {
	return {
		...diagnostic,
		limit: null,
		status: 'rejected',
		reason,
		finalClassification: 'unresolved'
	};
}
