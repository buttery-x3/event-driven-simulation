import type { Vec2 } from '../../../contracts';
import {
	certifySupportEquilibrium,
	classifyPostResponseContacts,
	fixedContactId,
	selectPostContactMode,
	singleBodyFixedContactState,
	type PostContactMode,
	type ResolvedContactState,
	type SupportedMotionEvidence
} from '../../contact-resolution';
import { supportCandidate } from './geometry';
import type { SustainedContactRequest } from './types';

export interface SustainedBoundaryResolution {
	readonly mode: PostContactMode;
	readonly contacts: ResolvedContactState | null;
	readonly candidate: ReturnType<typeof supportCandidate>;
}

export function resolveSustainedBoundaryMode(
	request: SustainedContactRequest,
	time: number,
	position: Vec2,
	velocity: Vec2,
	normal: Vec2,
	disposition: 'retained' | 'released',
	motion: SupportedMotionEvidence | null,
	unresolvedDetail: string | null = null
): SustainedBoundaryResolution {
	const candidate = supportCandidate(request, time, position, velocity, normal);
	if (!candidate) {
		return {
			mode: unresolvedDetail
				? { type: 'unresolved', detail: unresolvedDetail }
				: { type: 'free-flight' },
			contacts: null,
			candidate: null
		};
	}
	const eventState = singleBodyFixedContactState(
		request.body,
		time,
		position,
		velocity,
		[candidate],
		`sustained-boundary:${time}:${request.body.id}:${request.colliderId}`
	);
	const normalVelocity = velocity[0] * normal[0] + velocity[1] * normal[1];
	const contacts = classifyPostResponseContacts(
		eventState,
		[
			{
				contactId: fixedContactId(candidate),
				preResponseNormalVelocity: normalVelocity,
				postResponseNormalVelocity: normalVelocity,
				impulse: 0,
				retentionEligible: disposition === 'retained'
			}
		],
		request.input.settings.tolerances.eventTime
	)!;
	return {
		mode: selectPostContactMode({
			contacts,
			resting:
				motion && disposition === 'retained'
					? {
							bodyIds: [request.body.id],
							motion,
							support: () =>
								certifySupportEquilibrium(
									eventState.bodies,
									eventState.contacts,
									request.input.settings.gravity,
									request.input.settings.tolerances.eventTime
								)
						}
					: null,
			preferredFixedContactId: fixedContactId(candidate),
			unresolvedDetail
		}),
		contacts,
		candidate
	};
}
