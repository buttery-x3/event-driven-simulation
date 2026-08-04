import type { ContactEvent, InitialDynamicCircleBodyState, Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import type { AccumulationLimit } from '../../accumulation';
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

export function recordAccumulationEvidence(
	assembly: RunAssembly,
	body: InitialDynamicCircleBodyState,
	time: number,
	limit: AccumulationLimit,
	resolution: {
		readonly supported: boolean;
		readonly released: boolean;
		readonly impactSolveId: string;
		readonly linealityContactIds: readonly string[];
		readonly outgoingVelocity: Vec2;
	}
): void {
	const classification = resolution.supported
		? 'supported rest'
		: resolution.released
			? 'unsupported release'
			: 'unresolved pressing manifold';
	const contactIds = limit.activeLimitContacts
		.map(({ colliderId, secondBodyId, id }) => colliderId ?? secondBodyId ?? id)
		.join(', ');
	assembly.entries.push({
		severity: classification.startsWith('unresolved') ? 'warning' : 'info',
		code: 'ACCUMULATION_CERTIFIED',
		message: `Certified contracting physical-event accumulation (${limit.certificationMethod}) for bodies [${limit.participantBodyIds.join(', ')}] with intervals [${limit.temporal.intervals.join(', ')}] s, remaining-time upper bound ${limit.remainingTimeUpperBound} s, candidate limit time ${limit.candidateLimitTime} s, limit contacts (${contactIds}), max relative normal speed ${limit.maxRelativeNormalSpeed} m/s, path=${limit.path}.`,
		time,
		bodyId: body.id
	});
	assembly.entries.push({
		severity: classification.startsWith('unresolved') ? 'warning' : 'info',
		code: 'ACCUMULATION_PROMOTED',
		message: `Promoted limiting contact component through FLAME-53 impact solve ${resolution.impactSolveId} (lineality contacts: ${resolution.linealityContactIds.join(', ') || 'none'}); outgoing velocity [${resolution.outgoingVelocity.join(', ')}] m/s; support classification: ${classification}.`,
		time,
		bodyId: body.id
	});
	// Preserve the historical diagnostic code so FLAME-46 regression fixtures remain inspectable
	// during and after migration to the general accumulation path.
	assembly.entries.push({
		severity: classification.startsWith('unresolved') ? 'warning' : 'info',
		code: 'ALTERNATING_CONTACT_LIMIT',
		message: `Detected contracting alternating contacts (${limit.candidateFixedColliderIds.join(', ')}) with intervals [${limit.temporal.intervals.join(', ')}] s. Acquired candidate accumulation manifold at [${limit.limitingBodyStates[0]?.position.join(', ') ?? 'n/a'}] m with contacts (${contactIds}), state distance ${limit.stateResiduals[0]?.positionDistance ?? 0} m, and support-feasibility classification: ${classification}.`,
		time,
		bodyId: body.id
	});
}
