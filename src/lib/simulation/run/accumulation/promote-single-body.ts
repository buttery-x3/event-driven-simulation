import type {
	ContactEvent,
	ContactManifoldMember,
	InitialDynamicCircleBodyState,
	SimulationInput,
	Vec2
} from '../../contracts';
import type { FixedWorldContactCandidate } from '../../collision';
import { resolveCoupledImpact } from '../dynamic-impact';
import { solveSupportReactions } from '../single-ball/manifold';
import type { AccumulationLimit } from './types';

export interface PromotedSingleBodyImpact {
	readonly outgoingVelocity: Vec2;
	readonly contacts: readonly ContactManifoldMember[];
	readonly activeCandidates: readonly FixedWorldContactCandidate[];
	readonly impactSolveId: string;
	readonly linealityContactIds: readonly string[];
	readonly supportReactions: readonly number[] | null;
	readonly impactDiagnostic: NonNullable<
		Extract<ReturnType<typeof resolveCoupledImpact>, { type: 'response' }>['response']
	>['diagnostic'];
}

/**
 * Hand a certified single-body limiting component to FLAME-53, then classify support with the
 * ordinary non-negative reaction solve (FLAME-54 single-body support evidence).
 */
export function promoteSingleBodyAccumulation(
	input: SimulationInput,
	body: InitialDynamicCircleBodyState,
	limit: AccumulationLimit
): PromotedSingleBodyImpact | null {
	const candidates = limit.fixedCandidates;
	if (candidates.length === 0) return null;
	const limitBody = limit.limitingBodyStates.find(({ bodyId }) => bodyId === body.id);
	if (!limitBody) return null;
	const tolerance = Math.max(input.settings.tolerances.contactDistance, Number.EPSILON * 256);
	const contacts = candidates.map((candidate, index) => ({
		type: 'body-fixed' as const,
		id: `accumulation-fixed:${candidate.colliderId}:${candidate.feature}:${index}`,
		bodyId: body.id,
		colliderId: candidate.colliderId,
		normal: candidate.normal
	}));
	// Accumulation promotion removes the collapsing normal chatter at the finite limit. Use the
	// ordinary FLAME-53 operator at zero restitution for the inelastic limiting response; the
	// configured positive restitution still governs every ordinary positive-time impact event.
	const result = resolveCoupledImpact({
		bodies: [{ id: body.id, mass: body.mass, velocity: limitBody.velocity }],
		contacts,
		restitution: 0,
		tolerances: {
			numerical: tolerance,
			absoluteNormalVelocityFloor: Math.max(tolerance, Number.EPSILON * 512),
			relativeViolationEpsilon: Math.max(Number.EPSILON * 512, tolerance * 1e-3),
			maximumReflections: Math.max(128, contacts.length * contacts.length * 32)
		}
	});
	if (result.type !== 'response') return null;
	const response = result.response;
	const outgoing =
		response.bodyVelocities.find(({ bodyId }) => bodyId === body.id)?.velocity ?? null;
	if (!outgoing || !outgoing.every(Number.isFinite)) return null;
	const manifoldContacts: ContactManifoldMember[] = candidates.map((candidate, index) => {
		const contactResult = response.contacts[index];
		return {
			colliderId: candidate.colliderId,
			feature: candidate.feature,
			contactPoint: candidate.contactPoint,
			normal: candidate.normal,
			preImpactNormalVelocity: contactResult?.preImpactNormalVelocity ?? candidate.normalVelocity,
			postImpactNormalVelocity: contactResult?.postImpactNormalVelocity ?? 0,
			impulse: contactResult?.impulse ?? 0
		};
	});
	const support = solveSupportReactions(
		candidates,
		input.settings.gravity,
		input.settings.tolerances.eventTime
	);
	return {
		outgoingVelocity: outgoing,
		contacts: manifoldContacts,
		activeCandidates: candidates,
		impactSolveId:
			response.diagnostic.componentId ?? limit.connectedComponents[0]?.id ?? 'accumulation',
		linealityContactIds: response.diagnostic.linealityContactIds,
		supportReactions: support?.reactions ?? null,
		impactDiagnostic: {
			...response.diagnostic,
			componentId:
				response.diagnostic.componentId ??
				`accumulation-impact:${limit.currentCertifiedTime}:${body.id}`
		}
	};
}

export function accumulationReleaseEvent(
	event: ContactEvent,
	promoted: PromotedSingleBodyImpact
): ContactEvent {
	return {
		...event,
		position: promoted.activeCandidates[0]?.position ?? event.position,
		contacts: promoted.contacts,
		preContactVelocity: event.preContactVelocity,
		postContactVelocity: promoted.outgoingVelocity
	};
}
