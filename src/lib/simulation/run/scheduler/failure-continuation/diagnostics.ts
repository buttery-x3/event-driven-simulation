import type { DiagnosticEntry, FailureContinuationDiagnostic } from '../../../contracts';
import type { FreezeRequest, FrozenBodyRecord } from './types';

export function toFailureContinuationDiagnostic(
	request: FreezeRequest,
	frozen: readonly FrozenBodyRecord[]
): FailureContinuationDiagnostic {
	const byId = new Map(frozen.map((record) => [record.bodyId, record]));
	const affectedBodyIds = [...request.affectedBodyIds].sort();
	return {
		freezeTime: request.freezeTime,
		originalFailure: request.originalFailure,
		affectedBodyIds,
		positions: affectedBodyIds.flatMap((bodyId) => {
			const record = byId.get(bodyId);
			return record ? [{ bodyId, position: record.position }] : [];
		}),
		velocitiesBeforeFreeze: affectedBodyIds.flatMap((bodyId) => {
			const record = byId.get(bodyId);
			return record ? [{ bodyId, velocity: record.velocityBeforeFreeze }] : [];
		}),
		triggeringPairOrContactId: request.triggeringPairOrContactId,
		action: 'freeze-and-continue'
	};
}

export function failureContinuationEntries(
	diagnostic: FailureContinuationDiagnostic
): readonly DiagnosticEntry[] {
	const failure = diagnostic.originalFailure;
	const bodies = diagnostic.affectedBodyIds.join(', ');
	return [
		{
			severity: 'error',
			code: `RUN_${failure.type.replaceAll('-', '_').toUpperCase()}`,
			message: `failure: ${failure.type}${detailOf(failure)}`,
			time: diagnostic.freezeTime,
			bodyId: diagnostic.affectedBodyIds[0] ?? null
		},
		{
			severity: 'warning',
			code: 'RUN_FAILURE_CONTINUATION',
			message: `recovery: freeze-and-continue · bodies ${bodies}`,
			time: diagnostic.freezeTime,
			bodyId: diagnostic.affectedBodyIds[0] ?? null
		}
	];
}

function detailOf(failure: FailureContinuationDiagnostic['originalFailure']): string {
	return 'detail' in failure ? ` · ${failure.detail}` : '';
}
