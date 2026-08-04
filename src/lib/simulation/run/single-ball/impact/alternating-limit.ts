import type {
	ContactEvent,
	InitialDynamicCircleBodyState,
	SimulationInput,
	Vec2
} from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { withManifoldEvidence } from '../diagnostics';
import type { AlternatingContactLimit } from '../manifold';
import type { RunAssembly } from '../run-assembly';
import { recordImpactEvidence } from './evidence';
import { resolveImpactResponse, type ImpactResponse } from './response';

/**
 * Legacy FLAME-46 alternating-limit release path retained until general accumulation reaches
 * full behavioural parity on boundary cases.
 */
export function commitAlternatingLimitRelease(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	event: ContactEvent,
	incomingVelocity: Vec2,
	observedCandidates: readonly FixedWorldContactCandidate[],
	manifoldCandidates: readonly FixedWorldContactCandidate[],
	manifoldResponse: ImpactResponse,
	acquisition: AlternatingContactLimit,
	assembly: RunAssembly
): boolean {
	const observedResponse = resolveImpactResponse(
		input,
		event.time,
		observedCandidates,
		incomingVelocity,
		assembly.impactHistory
	);
	if (!observedResponse) return false;

	recordImpactEvidence(
		assembly,
		body,
		{
			...event,
			contacts: observedResponse.contacts,
			preContactVelocity: incomingVelocity,
			postContactVelocity: observedResponse.outgoingVelocity
		},
		observedCandidates,
		incomingVelocity,
		observedResponse,
		[],
		input.settings.tolerances.eventTime
	);
	annotateAccumulationManifold(
		assembly,
		incomingVelocity,
		manifoldCandidates,
		manifoldResponse,
		input.settings.tolerances.eventTime
	);
	assembly.events.push({
		type: 'contact-mode-transition',
		time: event.time,
		bodyId: body.id,
		colliderId: event.colliderId,
		from: 'impact',
		to: 'free-flight',
		reason: 'impact-collapse',
		position: event.position,
		normal: event.normal,
		contacts: manifoldResponse.contacts
	});
	assembly.entries.push({
		severity: 'info',
		code: 'CONTACT_MODE_TRANSITION',
		message: 'impact -> free-flight on acquired manifold: impact-collapse.',
		time: event.time,
		bodyId: body.id
	});
	assembly.entries.push({
		severity: 'info',
		code: 'ALTERNATING_CONTACT_LIMIT',
		message: `Detected contracting alternating contacts (${acquisition.sequenceColliderIds.join(', ')}) with intervals [${acquisition.intervals.join(', ')}] s. Acquired candidate accumulation manifold at [${acquisition.position.join(', ')}] m with contacts (${acquisition.candidates.map(({ colliderId }) => colliderId).join(', ')}), state distance ${acquisition.stateDistance} m, and support-feasibility classification: unsupported release.`,
		time: event.time,
		bodyId: body.id
	});
	assembly.entries.push({
		severity: 'info',
		code: 'ACCUMULATION_LEGACY_PATH',
		message:
			'Used legacy FLAME-46 alternating-contact path; general accumulation did not certify this candidate.',
		time: event.time,
		bodyId: body.id
	});
	return true;
}

function annotateAccumulationManifold(
	assembly: RunAssembly,
	incomingVelocity: Vec2,
	candidates: readonly FixedWorldContactCandidate[],
	response: ImpactResponse,
	tolerance: number
): void {
	const diagnosticIndex = assembly.contactSearches.length - 1;
	const diagnostic = assembly.contactSearches[diagnosticIndex];
	if (!diagnostic) return;
	assembly.contactSearches[diagnosticIndex] = withManifoldEvidence(
		diagnostic,
		incomingVelocity,
		response.outgoingVelocity,
		candidates,
		response.contacts,
		[],
		tolerance
	);
}
