import type { AccumulationDiagnostic, AccumulationLimit, SimulationInput } from '../../contracts';
import { reconstructLimitGeometry } from './geometry';
import {
	estimateLimitingBodyStates,
	projectLimitingVelocities,
	updatePositionResiduals
} from './state-estimation';
import { certifyTemporalTail } from './temporal-certification';
import type {
	AccumulationCertificationResult,
	AccumulationObservation,
	AccumulationObservedContact
} from './types';

const maximumSourceEvents = 8;

export function certifyAccumulationLimit(
	input: SimulationInput,
	history: readonly AccumulationObservation[]
): AccumulationCertificationResult {
	const connectedSource = connectedRecentSource(history);
	const temporalSelection = selectTemporalSource(
		connectedSource,
		input.settings.tolerances.eventTime
	);
	const source = temporalSelection.source;
	const participantBodyIds = [
		...new Set(source.flatMap(({ participantBodyIds: ids }) => ids))
	].sort();
	const candidateFixedColliderIds = [
		...new Set(source.flatMap(({ candidateFixedColliderIds: ids }) => ids))
	].sort();
	const sourceEventIds = source.map(({ id }) => id);
	const rejected = (reason: string): AccumulationCertificationResult => ({
		type: 'rejected',
		diagnostic: diagnostic(
			null,
			sourceEventIds,
			participantBodyIds,
			candidateFixedColliderIds,
			'rejected',
			reason
		)
	});
	if (connectedSource.length < 5)
		return rejected('The connected candidate has fewer than five physical events.');
	if (typeof temporalSelection.temporal === 'string') return rejected(temporalSelection.temporal);
	const temporal = temporalSelection.temporal;
	if (!normalSpeedsConverge(source))
		return rejected('Relative normal impact speeds do not converge inside the candidate cluster.');
	const positionResolution = Math.max(
		input.settings.tolerances.contactDistance,
		Number.EPSILON * 256
	);
	const gravityMagnitude = Math.hypot(...input.settings.gravity);
	const velocityResolution = Math.max(
		input.settings.tolerances.eventTime,
		Math.sqrt(2 * gravityMagnitude * positionResolution) * 0.05,
		Number.EPSILON * 512
	);
	const state = estimateLimitingBodyStates(
		source,
		participantBodyIds,
		temporal,
		positionResolution,
		velocityResolution
	);
	if (typeof state === 'string') return rejected(state);
	const candidateContacts = uniqueCandidateContacts(source);
	if (candidateContacts.length === 0)
		return rejected('The connected candidate contains no contact geometry to reconstruct.');
	if (candidateContacts.length === 1 && participantBodyIds.length === 1)
		return rejected(
			'The bounded acquisition family requires either changing contact edges or a multi-body participant cluster.'
		);
	const geometry = reconstructLimitGeometry(
		input,
		state.estimates,
		candidateContacts,
		repeatedCandidateContacts(source)
	);
	if (typeof geometry === 'string') return rejected(geometry);
	const kinematic = projectLimitingVelocities(
		geometry.estimates,
		geometry.activeContacts,
		state.residuals,
		positionResolution
	);
	if (typeof kinematic === 'string') return rejected(kinematic);
	if (maximumLimitNormalSpeed(kinematic.estimates, geometry.activeContacts) > velocityResolution)
		return rejected(
			'The reconstructed limiting velocity has not converged within the declared normal-velocity resolution.'
		);
	const stateResiduals = updatePositionResiduals(kinematic.residuals, kinematic.estimates);
	if (typeof stateResiduals === 'string') return rejected(stateResiduals);
	const currentCertifiedTime = source.at(-1)!.time;
	const limit: AccumulationLimit = {
		id: `accumulation-limit:${currentCertifiedTime}:${participantBodyIds.join('+')}`,
		sourceEventIds,
		participantBodyIds,
		candidateFixedColliderIds,
		currentCertifiedTime,
		candidateLimitTime: temporal.candidateLimitTime,
		remainingTimeUpperBound: temporal.remainingTimeUpperBound,
		limitingBodyStates: kinematic.estimates.map(({ bodyId, position, velocity }) => ({
			bodyId,
			position,
			velocity
		})),
		activeLimitContacts: geometry.activeContacts,
		connectedComponents: geometry.connectedComponents,
		temporalResiduals: {
			sourceEventTimes: temporal.eventTimes,
			positiveIntervals: temporal.intervals,
			contractionRatios: temporal.ratios,
			certifiedRatioUpperBound: temporal.ratioUpperBound,
			latestInterval: temporal.intervals.at(-1)!,
			geometricTailEstimate: temporal.estimatedRemainingTime,
			eventTimeResolution: input.settings.tolerances.eventTime
		},
		stateResiduals,
		geometricResiduals: geometry.residuals,
		penetrationEvidence: geometry.penetrationEvidence,
		certificationMethod: 'monotone-geometric-interval-envelope',
		acquisitionTime: 'mathematical-limit'
	};
	return {
		type: 'certified',
		limit,
		diagnostic: diagnostic(
			limit,
			sourceEventIds,
			participantBodyIds,
			candidateFixedColliderIds,
			'certified',
			`Certified a finite temporal tail no greater than ${limit.remainingTimeUpperBound}.`
		)
	};
}

function selectTemporalSource(
	connected: readonly AccumulationObservation[],
	eventTimeResolution: number
): {
	readonly source: readonly AccumulationObservation[];
	readonly temporal: ReturnType<typeof certifyTemporalTail>;
} {
	let latestRejection: string = 'The connected candidate has fewer than five physical events.';
	for (let start = 0; start <= connected.length - 5; start += 1) {
		const source = connected.slice(start);
		const temporal = certifyTemporalTail(source, eventTimeResolution);
		if (typeof temporal !== 'string') return { source, temporal };
		latestRejection = temporal;
	}
	return { source: connected.slice(-5), temporal: latestRejection };
}

function maximumLimitNormalSpeed(
	bodies: readonly { readonly bodyId: string; readonly velocity: readonly [number, number] }[],
	contacts: readonly AccumulationLimit['activeLimitContacts'][number][]
): number {
	return Math.max(
		0,
		...contacts.map((contact) => {
			if (contact.type === 'body-fixed') {
				const velocity = bodies.find(({ bodyId }) => bodyId === contact.bodyId)!.velocity;
				return Math.abs(velocity[0] * contact.normal[0] + velocity[1] * contact.normal[1]);
			}
			const first = bodies.find(({ bodyId }) => bodyId === contact.firstBodyId)!.velocity;
			const second = bodies.find(({ bodyId }) => bodyId === contact.secondBodyId)!.velocity;
			return Math.abs(
				(second[0] - first[0]) * contact.normalFromFirstToSecond[0] +
					(second[1] - first[1]) * contact.normalFromFirstToSecond[1]
			);
		})
	);
}

function connectedRecentSource(
	history: readonly AccumulationObservation[]
): readonly AccumulationObservation[] {
	const latest = history.at(-1);
	if (!latest) return [];
	const selected = [latest];
	const bodyIds = new Set(latest.participantBodyIds);
	let previousTime = latest.time;
	for (
		let index = history.length - 2;
		index >= 0 && selected.length < maximumSourceEvents;
		index -= 1
	) {
		const observation = history[index]!;
		if (!(observation.time < previousTime)) continue;
		if (!observation.participantBodyIds.some((bodyId) => bodyIds.has(bodyId))) continue;
		selected.push(observation);
		for (const bodyId of observation.participantBodyIds) bodyIds.add(bodyId);
		previousTime = observation.time;
	}
	return selected.reverse();
}

function normalSpeedsConverge(observations: readonly AccumulationObservation[]): boolean {
	const speeds = observations.map(({ maximumRelativeNormalSpeed }) => maximumRelativeNormalSpeed);
	if (speeds.some((speed) => speed < 0 || !Number.isFinite(speed))) return false;
	const recent = speeds.slice(-4);
	return (
		recent.at(-1)! <= recent[0]! &&
		recent.slice(1).filter((speed, index) => speed < recent[index]!).length >= 2
	);
}

function uniqueCandidateContacts(
	observations: readonly AccumulationObservation[]
): readonly AccumulationObservedContact[] {
	const contacts = new Map<string, AccumulationObservedContact>();
	for (const observation of observations) {
		for (const contact of observation.contacts) contacts.set(contactKey(contact), contact);
	}
	return [...contacts.values()].sort((left, right) =>
		contactKey(left).localeCompare(contactKey(right))
	);
}

function repeatedCandidateContacts(
	observations: readonly AccumulationObservation[]
): readonly AccumulationObservedContact[] {
	const contacts = new Map<
		string,
		{ readonly contact: AccumulationObservedContact; count: number }
	>();
	for (const observation of observations) {
		for (const contact of observation.contacts) {
			const key = contactKey(contact);
			const existing = contacts.get(key);
			if (existing) existing.count += 1;
			else contacts.set(key, { contact, count: 1 });
		}
	}
	return [...contacts.values()]
		.filter(({ count }) => count >= 2)
		.map(({ contact }) => contact)
		.sort((left, right) => contactKey(left).localeCompare(contactKey(right)));
}

function contactKey(contact: AccumulationObservedContact): string {
	return contact.type === 'body-fixed'
		? `fixed:${contact.bodyId}:${contact.colliderId}`
		: `body:${[contact.firstBodyId, contact.secondBodyId].sort().join(':')}`;
}

function diagnostic(
	limit: AccumulationLimit | null,
	sourceEventIds: readonly string[],
	participantBodyIds: readonly string[],
	candidateFixedColliderIds: readonly string[],
	status: AccumulationDiagnostic['status'],
	reason: string
): AccumulationDiagnostic {
	return {
		limit,
		sourceEventIds,
		participantBodyIds,
		candidateFixedColliderIds,
		status,
		reason,
		downstreamImpactComponentIds: [],
		downstreamSupportComponentIds: [],
		finalClassification: status === 'certified' ? 'pending' : 'unresolved',
		mechanism: 'general-accumulation'
	};
}
