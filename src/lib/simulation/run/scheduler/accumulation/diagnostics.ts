import type { AccumulationDiagnostic } from '../../../contracts';
import type { SchedulerState } from '../types';

export function recordAccumulationDiagnostic(
	state: SchedulerState,
	diagnostic: AccumulationDiagnostic,
	time: number
): void {
	const previous = state.accumulationDiagnostics.at(-1);
	if (
		previous?.status === diagnostic.status &&
		previous.finalClassification === diagnostic.finalClassification &&
		previous.sourceEventIds.join('\u0000') === diagnostic.sourceEventIds.join('\u0000')
	)
		return;
	state.accumulationDiagnostics.push(diagnostic);
	for (const bodyId of diagnostic.participantBodyIds) {
		const runtime = state.runtimes.get(bodyId);
		if (!runtime) continue;
		runtime.entries.push({
			severity: diagnostic.status === 'certified' ? 'info' : 'warning',
			code:
				diagnostic.status === 'certified'
					? diagnostic.finalClassification === 'pending'
						? 'ACCUMULATION_CERTIFIED'
						: 'ACCUMULATION_PROMOTED'
					: 'ACCUMULATION_REJECTED',
			message: diagnostic.reason,
			time,
			bodyId
		});
	}
}
