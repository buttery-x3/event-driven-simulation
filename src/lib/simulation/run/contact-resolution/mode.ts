import type { Vec2 } from '../../contracts';
import type { PostContactMode, ResolvedContactState, SupportReactionSolution } from './types';

export const PERCEPTUAL_REST_SPEED = 0.01;

export interface SupportedMotionEvidence {
	readonly velocities?: readonly Vec2[];
	readonly velocityComponents?: readonly number[];
	readonly constrainedAccelerations?: readonly Vec2[];
	readonly constrainedAccelerationComponents?: readonly number[];
	readonly tolerance: number;
}

export type SupportedMotionClassification = 'moving' | 'resting-qualified';

interface RestingModeRequest {
	readonly bodyIds: readonly string[];
	readonly motion: SupportedMotionEvidence;
	readonly support: () => SupportReactionSolution | null;
}

export interface PostContactModeRequest {
	readonly contacts: ResolvedContactState;
	readonly resting?: RestingModeRequest | null;
	readonly dynamicSupport?: {
		readonly contactId: string;
		readonly movingBodyId: string;
		readonly supportBodyId: string;
		readonly motion?: SupportedMotionEvidence;
		readonly stationaryDetail?: string;
	} | null;
	readonly preferredFixedContactId?: string | null;
	readonly unsupportedBodyContactId?: string | null;
	readonly unresolvedDetail?: string | null;
	readonly unresolvedWithoutRestingMode?: string | null;
}

export function classifySupportedMotion(
	evidence: SupportedMotionEvidence
): SupportedMotionClassification {
	if (evidence.velocities?.some((velocity) => Math.hypot(...velocity) > evidence.tolerance)) {
		return 'moving';
	}
	if (evidence.velocityComponents?.some((velocity) => Math.abs(velocity) > evidence.tolerance)) {
		return 'moving';
	}
	if (
		evidence.constrainedAccelerations?.some(
			(acceleration) => Math.hypot(...acceleration) > evidence.tolerance
		)
	) {
		return 'moving';
	}
	if (
		evidence.constrainedAccelerationComponents?.some(
			(acceleration) => Math.abs(acceleration) > evidence.tolerance
		)
	) {
		return 'moving';
	}
	return 'resting-qualified';
}

export function isRepresentedRestCandidate(velocities: readonly Vec2[]): boolean {
	return (
		velocities.length > 0 &&
		velocities.every((velocity) => Math.hypot(...velocity) <= PERCEPTUAL_REST_SPEED)
	);
}

export function selectPostContactMode(request: PostContactModeRequest): PostContactMode {
	if (request.unresolvedDetail) {
		return { type: 'unresolved', detail: request.unresolvedDetail };
	}
	const retained = new Set(
		request.contacts.contacts
			.filter(({ disposition }) => disposition === 'retained')
			.map(({ contact }) => contact.id)
	);
	if (
		request.resting &&
		(classifySupportedMotion(request.resting.motion) === 'resting-qualified' ||
			(request.resting.motion.velocities?.length === request.resting.bodyIds.length &&
				isRepresentedRestCandidate(request.resting.motion.velocities)))
	) {
		const support = request.resting.support();
		if (support) {
			return {
				type: 'resting-anchored',
				bodyIds: [...request.resting.bodyIds].sort(),
				support
			};
		}
	}
	if (request.unresolvedWithoutRestingMode) {
		return { type: 'unresolved', detail: request.unresolvedWithoutRestingMode };
	}
	if (request.dynamicSupport && retained.has(request.dynamicSupport.contactId)) {
		if (
			request.dynamicSupport.motion &&
			classifySupportedMotion(request.dynamicSupport.motion) === 'resting-qualified'
		) {
			return {
				type: 'unresolved',
				detail:
					request.dynamicSupport.stationaryDetail ??
					'Dynamic sustained support has no represented stationary continuation.'
			};
		}
		return {
			type: 'dynamic-sustained-support',
			contactId: request.dynamicSupport.contactId,
			movingBodyId: request.dynamicSupport.movingBodyId,
			supportBodyId: request.dynamicSupport.supportBodyId
		};
	}
	if (request.preferredFixedContactId && retained.has(request.preferredFixedContactId)) {
		return { type: 'fixed-sustained-contact', contactId: request.preferredFixedContactId };
	}
	if (request.unsupportedBodyContactId && retained.has(request.unsupportedBodyContactId)) {
		const contact = request.contacts.eventState.contacts.find(
			({ id }) => id === request.unsupportedBodyContactId
		);
		if (contact?.type === 'body-body') {
			return {
				type: 'unsupported',
				contactId: contact.id,
				bodyIds: [contact.firstBodyId, contact.secondBodyId]
			};
		}
	}
	return { type: 'free-flight' };
}
