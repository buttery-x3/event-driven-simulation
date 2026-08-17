import type { InitialDynamicCircleBodyState, Vec2 } from '../../contracts';
import type { FixedWorldContactCandidate } from '../../collision';
import type { ExactTimeContactState } from './types';

export function singleBodyFixedContactState(
	body: InitialDynamicCircleBodyState,
	time: number,
	position: Vec2,
	velocity: Vec2,
	candidates: readonly FixedWorldContactCandidate[],
	id = `fixed-contact:${time}:${body.id}`
): ExactTimeContactState {
	return {
		id,
		time,
		bodies: [
			{
				id: body.id,
				mass: body.mass,
				radius: body.physicalShape.radius,
				position,
				velocity
			}
		],
		contacts: candidates.map((candidate) => ({
			type: 'body-fixed',
			id: fixedContactId(candidate),
			bodyId: body.id,
			colliderId: candidate.colliderId,
			normal: candidate.normal,
			contactPoint: candidate.contactPoint,
			candidate
		}))
	};
}

export function fixedContactId(candidate: FixedWorldContactCandidate): string {
	return `${candidate.colliderId}:${candidate.feature}`;
}
