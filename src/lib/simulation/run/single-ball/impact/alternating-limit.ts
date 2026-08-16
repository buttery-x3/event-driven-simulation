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
import { recordAlternatingLimitEvidence, recordImpactEvidence } from './evidence';
import { resolveImpactResponse, type ImpactResponse } from './response';

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
		incomingVelocity
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
	recordAlternatingLimitEvidence(assembly, body, event.time, acquisition, false, true);
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
