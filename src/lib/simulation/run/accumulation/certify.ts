import type { SimulationInput } from '../../contracts';
import { extractParticipantCluster } from './cluster';
import { decomposeLimitComponents } from './components';
import { reconstructLimitGeometry } from './limit-geometry';
import { certifyTemporalTail } from './temporal';
import type {
	AccumulationCertificationResult,
	AccumulationLimit,
	AccumulationPhysicalEvent
} from './types';

export interface CertifyAccumulationInput {
	readonly simulation: SimulationInput;
	readonly events: readonly AccumulationPhysicalEvent[];
	readonly currentBodies: readonly {
		readonly bodyId: string;
		readonly mass: number;
		readonly radius: number;
		readonly position: readonly [number, number];
		readonly velocity: readonly [number, number];
	}[];
	readonly minimumEvents?: number;
}

/**
 * Certify a contracting positive-time event sequence into an AccumulationLimit, or reject
 * with an explicit reason while leaving the valid event prefix untouched.
 */
export function certifyAccumulationLimit(
	input: CertifyAccumulationInput
): AccumulationCertificationResult {
	const eventTime = input.simulation.settings.tolerances.eventTime;
	const contactDistance = input.simulation.settings.tolerances.contactDistance;
	const events = [...input.events].sort((left, right) => left.time - right.time);
	const window = events.slice(-(input.minimumEvents ?? 8));
	const cluster = extractParticipantCluster(window);
	if (!cluster.stable) {
		return {
			type: 'rejected',
			reason: 'unstable-participant-cluster',
			detail: cluster.detail,
			temporal: null
		};
	}
	const temporal = certifyTemporalTail({
		events: window,
		eventTimeTolerance: eventTime,
		minimumEvents: input.minimumEvents ?? 5
	});
	if (temporal.type === 'rejected') {
		return {
			type: 'rejected',
			reason: 'uncertifiable-temporal-tail',
			detail: temporal.reason,
			temporal: null
		};
	}
	const maxRelativeNormalSpeed = Math.max(
		0,
		...window.map(({ maxRelativeNormalSpeed }) => maxRelativeNormalSpeed)
	);
	const currentBodies = input.currentBodies
		.filter(({ bodyId }) => cluster.bodyIds.includes(bodyId))
		.map((body) => ({
			bodyId: body.bodyId,
			mass: body.mass,
			radius: body.radius,
			position: [body.position[0], body.position[1]] as [number, number],
			velocity: [body.velocity[0], body.velocity[1]] as [number, number]
		}));
	if (currentBodies.length !== cluster.bodyIds.length) {
		return {
			type: 'rejected',
			reason: 'uncertifiable-limit-geometry',
			detail: 'Not every cluster body has a current certified state.',
			temporal: temporal.certificate
		};
	}
	const geometry = reconstructLimitGeometry({
		simulation: input.simulation,
		currentBodies,
		historicalFixedColliderIds: cluster.fixedColliderIds,
		currentTime: temporal.certificate.currentCertifiedTime,
		candidateLimitTime: temporal.certificate.candidateLimitTime,
		remainingTimeUpperBound: temporal.certificate.remainingTimeUpperBound
	});
	if (!geometry) {
		return {
			type: 'rejected',
			reason: 'uncertifiable-limit-geometry',
			detail: 'Limiting states or contacts could not be reconstructed without penetration.',
			temporal: temporal.certificate
		};
	}
	if (geometry.penetrations.length > 0) {
		return {
			type: 'rejected',
			reason: 'penetration-beyond-tolerance',
			detail: 'Proposed limiting state penetrates geometry beyond contact distance.',
			temporal: temporal.certificate
		};
	}
	if (geometry.bodyStates.some((body) => !body.position.every(Number.isFinite))) {
		return {
			type: 'rejected',
			reason: 'non-finite-limit-state',
			detail: 'Limiting body states must be finite.',
			temporal: temporal.certificate
		};
	}
	// Require state residuals compatible with the certified temporal tail.
	const residualBudget =
		Math.max(contactDistance, eventTime) +
		temporal.certificate.remainingTimeUpperBound *
			(1 + Math.max(...geometry.bodyStates.map((body) => Math.hypot(...body.velocity))));
	if (
		geometry.stateResiduals.some(({ positionDistance }) => positionDistance > residualBudget * 8)
	) {
		return {
			type: 'rejected',
			reason: 'state-residual-exceeds-tolerance',
			detail: 'Current-to-limit state distances exceed the certified residual budget.',
			temporal: temporal.certificate
		};
	}
	if (geometry.contacts.length === 0) {
		return {
			type: 'rejected',
			reason: 'empty-limit-contacts',
			detail: 'Limiting geometry produced no active contacts.',
			temporal: temporal.certificate
		};
	}
	const components = decomposeLimitComponents(
		cluster.bodyIds,
		geometry.contacts,
		temporal.certificate.currentCertifiedTime
	);
	const limit: AccumulationLimit = {
		sourceEventIds: temporal.certificate.sourceEventIds,
		participantBodyIds: cluster.bodyIds,
		candidateFixedColliderIds: cluster.fixedColliderIds,
		currentCertifiedTime: temporal.certificate.currentCertifiedTime,
		candidateLimitTime: temporal.certificate.candidateLimitTime,
		remainingTimeUpperBound: temporal.certificate.remainingTimeUpperBound,
		limitingBodyStates: geometry.bodyStates,
		activeLimitContacts: geometry.contacts,
		connectedComponents: components,
		temporalResiduals: {
			currentToLimitTime: temporal.certificate.remainingTimeUpperBound,
			remainingTimeUpperBound: temporal.certificate.remainingTimeUpperBound
		},
		stateResiduals: geometry.stateResiduals,
		geometricResiduals: geometry.contacts.map((contact) => ({
			contactId: contact.id,
			separation: contact.separation
		})),
		penetrationEvidence: geometry.penetrations,
		certificationMethod: temporal.certificate.method,
		temporal: temporal.certificate,
		fixedCandidates: geometry.fixedCandidates,
		maxRelativeNormalSpeed,
		path: 'general-accumulation'
	};
	return { type: 'certified', limit };
}
