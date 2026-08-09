import type { ContactEvent, InitialDynamicCircleBodyState, Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { withManifoldEvidence } from '../diagnostics';
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
