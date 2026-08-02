import type { ContactEvent, InitialDynamicCircleBodyState, Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { withManifoldEvidence } from '../diagnostics';
import type { AlternatingContactLimit } from '../manifold';
import type { RunAssembly } from '../run-assembly';
import { impactObservation, type ImpactResponse } from './response';

export function recordImpactEvidence(
	assembly: RunAssembly,
	body: InitialDynamicCircleBodyState,
	event: ContactEvent,
	candidates: readonly FixedWorldContactCandidate[],
	incomingVelocity: Vec2,
	response: ImpactResponse,
	retainedAfterImpact: readonly FixedWorldContactCandidate[],
	tolerance: number
): void {
	const diagnosticIndex = assembly.contactSearches.length - 1;
	const latestDiagnostic = assembly.contactSearches[diagnosticIndex];
	if (latestDiagnostic) {
		assembly.contactSearches[diagnosticIndex] = withManifoldEvidence(
			latestDiagnostic,
			incomingVelocity,
			response.outgoingVelocity,
			candidates,
			response.contacts,
			retainedAfterImpact,
			tolerance
		);
	}
	assembly.events.push(event);
	assembly.entries.push({
		severity: 'info',
		code: 'CONTACT_COMMITTED',
		message: `Committed ${response.contacts.length}-contact manifold (${response.contacts.map(({ colliderId }) => colliderId).join(', ')}).`,
		time: event.time,
		bodyId: body.id
	});
	if (response.releaseRetention) {
		const evidence = response.releaseRetention;
		assembly.entries.push({
			severity: 'info',
			code: 'SUB_TOLERANCE_RELEASE_RETAINED',
			message: `Retained ${evidence.colliderId} for sustained contact: maximum normal separation ${evidence.maximumNormalSeparation} m from outgoing speed ${evidence.outgoingNormalSpeed} m/s and pressing acceleration ${evidence.pressingNormalAcceleration} m/s² does not exceed contact-distance tolerance ${evidence.contactDistanceTolerance} m.`,
			time: event.time,
			bodyId: body.id
		});
	}
	assembly.impactHistory.push(impactObservation(candidates, event.time, response.contacts));
}

export function recordAlternatingLimitEvidence(
	assembly: RunAssembly,
	body: InitialDynamicCircleBodyState,
	time: number,
	acquisition: AlternatingContactLimit,
	supported: boolean,
	released: boolean
): void {
	const classification = supported
		? 'supported rest'
		: released
			? 'unsupported release'
			: 'unresolved pressing manifold';
	assembly.entries.push({
		severity: classification.startsWith('unresolved') ? 'warning' : 'info',
		code: 'ALTERNATING_CONTACT_LIMIT',
		message: `Detected contracting alternating contacts (${acquisition.sequenceColliderIds.join(', ')}) with intervals [${acquisition.intervals.join(', ')}] s. Acquired candidate accumulation manifold at [${acquisition.position.join(', ')}] m with contacts (${acquisition.candidates.map(({ colliderId }) => colliderId).join(', ')}), state distance ${acquisition.stateDistance} m, and support-feasibility classification: ${classification}.`,
		time,
		bodyId: body.id
	});
}
