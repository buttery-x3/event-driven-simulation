import type {
	ContactModeTransitionEvent,
	RunContactSearchDiagnostic,
	Vec2
} from '../../../contracts';
import type { SupportedMotionEvidence } from '../../contact-resolution';
import { resolveSustainedBoundaryMode } from './mode';
import type { SustainedContactRequest, SustainedContactResult } from './types';

export function restingContactResult(
	request: SustainedContactRequest,
	motion: SupportedMotionEvidence = {
		velocities: [[0, 0]],
		tolerance: request.input.settings.tolerances.eventTime
	}
): SustainedContactResult {
	const resolution = resolveSustainedBoundaryMode(
		request,
		request.time,
		request.position,
		request.outgoingVelocity,
		request.normal,
		'retained',
		motion
	);
	if (resolution.mode.type !== 'resting-anchored') {
		return unresolvedContactResult(
			request,
			'The stationary fixed contact did not receive a resting-anchored mode decision.'
		);
	}
	return {
		segments: [],
		events: [entryTransition(request, 'resting')],
		contactSearches: [],
		terminalReason: {
			type: 'resting-contact',
			time: request.time,
			colliderId: request.colliderId,
			position: request.position,
			normal: request.normal,
			contacts: request.manifoldContacts,
			reason:
				request.entryReason === 'impact-collapse' ? 'impact-collapse' : 'zero-tangential-motion'
		},
		nextState: null
	};
}

export function detachedContactResult(
	request: SustainedContactRequest,
	velocity: Vec2
): SustainedContactResult {
	const resolution = resolveSustainedBoundaryMode(
		request,
		request.time,
		request.position,
		velocity,
		request.normal,
		'released',
		null
	);
	if (resolution.mode.type !== 'free-flight') {
		return unresolvedContactResult(
			request,
			'The released fixed contact did not receive a free-flight mode decision.'
		);
	}
	return {
		segments: [],
		events: [entryTransition(request, 'free-flight', 'support-lost')],
		contactSearches: [],
		terminalReason: null,
		nextState: {
			time: request.time,
			position: request.position,
			velocity,
			releasedContactColliderId: request.colliderId,
			releasedContactColliderIds: [request.colliderId],
			retainedSupportCandidates: [],
			pendingContactCandidates: [],
			acceptInitialContact: false
		}
	};
}

export function unresolvedContactResult(
	request: SustainedContactRequest,
	detail: string,
	contactSearches: readonly RunContactSearchDiagnostic[] = []
): SustainedContactResult {
	return {
		segments: [],
		events: [
			entryTransition(request, 'sliding'),
			slidingTransition(
				request,
				'free-flight',
				'unresolved',
				request.time,
				request.position,
				request.normal
			)
		],
		contactSearches,
		terminalReason: { type: 'unresolved-collision-search', time: request.time, detail },
		nextState: null
	};
}

export function entryTransition(
	request: SustainedContactRequest,
	to: 'resting' | 'sliding' | 'free-flight',
	reason: ContactModeTransitionEvent['reason'] = to === 'free-flight'
		? 'support-lost'
		: 'impact-collapse'
): ContactModeTransitionEvent {
	return transition(
		request,
		request.entryFrom,
		to,
		to === 'free-flight' ? reason : request.entryReason,
		request.time,
		request.position,
		request.normal
	);
}

export function slidingTransition(
	request: SustainedContactRequest,
	to: ContactModeTransitionEvent['to'],
	reason: ContactModeTransitionEvent['reason'],
	time: number,
	position: Vec2,
	normal: Vec2
): ContactModeTransitionEvent {
	return transition(request, 'sliding', to, reason, time, position, normal);
}

function transition(
	request: SustainedContactRequest,
	from: ContactModeTransitionEvent['from'],
	to: ContactModeTransitionEvent['to'],
	reason: ContactModeTransitionEvent['reason'],
	time: number,
	position: Vec2,
	normal: Vec2
): ContactModeTransitionEvent {
	return {
		type: 'contact-mode-transition',
		time,
		bodyId: request.body.id,
		colliderId: request.colliderId,
		from,
		to,
		reason,
		position,
		normal,
		contacts: request.manifoldContacts
	};
}
