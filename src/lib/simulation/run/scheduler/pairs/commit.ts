import type { RunTerminalReason } from '../../../contracts';
import type { SchedulerState } from '../types';
import { commitCoupledImpact } from './coupled-commit';
import { buildExactTimeComponent } from './component';
import type { PairSchedulerSelection } from './selection';

export type PairCommitResult =
	| { readonly type: 'continued' }
	| { readonly type: 'terminal'; readonly reason: RunTerminalReason };

export function commitBodyPairEvent(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>
): PairCommitResult {
	const component = buildExactTimeComponent(state, selection);
	if (!component) {
		return {
			type: 'terminal',
			reason: {
				type: 'numerical-failure',
				time: selection.time,
				detail: 'The exact-time dynamic contact component could not be reconstructed.'
			}
		};
	}
	return commitCoupledImpact(state, selection, component);
}
