import type { RunTerminalReason, Vec2 } from '../../../contracts';
import { dotVec2 } from '../../../math';
import { evaluateCircularContactState } from '../../../motion';
import type { SustainedContactRequest } from '../../single-ball/sustained-contact';
import { colliderCandidateAtState } from '../../single-ball/sustained-contact/geometry';
import { refreshBodyPrediction } from '../predictions';
import type { SchedulerState } from '../types';
import {
	evaluateDynamicSupportReaction,
	refreshDynamicSupportPrediction,
	selectDynamicSupportPrediction
} from './prediction';
import {
	activeDynamicSupportContactIds,
	createDynamicComponent,
	createRestingAnchor,
	dynamicSupportTransition,
	nextDynamicSupportRevision,
	recordDynamicSupportDiagnostic,
	recordDynamicSupportStep,
	releaseDynamicContact,
	retireDynamicSupportComponent,
	updateTerminalDynamicContact
} from './records';
import type {
	DynamicSupportCommitResult,
	DynamicSupportPrediction,
	DynamicSupportRuntime
} from './types';

export function commitDynamicSupportPrediction(
	state: SchedulerState,
	prediction: DynamicSupportPrediction
): DynamicSupportCommitResult {
	const support = state.dynamicSupports.get(prediction.supportId);
	if (!support)
		return numericalFailure(state.worldTime, 'Selected dynamic support no longer exists.');
	const moving = state.runtimes.get(support.movingBodyId)!;
	selectDynamicSupportPrediction(state, prediction);
	if (prediction.segment.endTime > prediction.segment.startTime) {
		moving.segments.push(prediction.segment);
	}
	const endState = evaluateCircularContactState(prediction.segment, prediction.segment.endTime);
	moving.committedTime = prediction.segment.endTime;
	moving.state = {
		...moving.state,
		time: prediction.segment.endTime,
		position: endState.position,
		velocity: endState.velocity
	};
	moving.revision += 1;
	recordDynamicSupportStep(state, prediction);

	switch (prediction.boundary.type) {
		case 'turning-point':
			recordDynamicSupportDiagnostic(
				state,
				support,
				prediction,
				'turning-point',
				[],
				activeDynamicSupportContactIds(state, support)
			);
			return reverseAtTurning(state, support, prediction, endState.position, endState.normal);
		case 'support-lost':
			recordDynamicSupportDiagnostic(
				state,
				support,
				prediction,
				'detached',
				[support.contactId],
				[]
			);
			releaseDynamicContact(state, support.contactId, prediction.segment.endTime);
			releaseSupport(state, support, prediction.segment.endTime, 'support-lost');
			activateMovingBody(state, support, endState.position, endState.velocity);
			return { type: 'continued' };
		case 'anchored-support-lost': {
			const releasedContactIds = prediction.boundary.releasedContactIds;
			recordDynamicSupportDiagnostic(
				state,
				support,
				prediction,
				'support-contact-released',
				releasedContactIds,
				activeDynamicSupportContactIds(state, support).filter(
					(id) => !releasedContactIds.includes(id)
				)
			);
			return commitAnchorLoss(state, support, prediction, endState.position);
		}
		case 'contact':
			recordDynamicSupportDiagnostic(
				state,
				support,
				prediction,
				'fixed-contact',
				[support.contactId],
				[]
			);
			return commitFixedContact(state, support, prediction, endState.position, endState.velocity);
		case 'terminal':
			recordDynamicSupportDiagnostic(
				state,
				support,
				prediction,
				'terminal',
				[],
				activeDynamicSupportContactIds(state, support)
			);
			moving.terminalReason = prediction.boundary.terminalReason;
			moving.events.push(
				dynamicSupportTransition(
					support,
					prediction.segment.endTime,
					endState.position,
					endState.normal,
					'free-flight',
					'terminal-region'
				)
			);
			return { type: 'terminal', reason: prediction.boundary.terminalReason };
		case 'unresolved': {
			recordDynamicSupportDiagnostic(
				state,
				support,
				prediction,
				'unresolved',
				[],
				activeDynamicSupportContactIds(state, support)
			);
			const reason: RunTerminalReason = {
				type: 'unresolved-collision-search',
				time: prediction.segment.endTime,
				detail: prediction.boundary.detail
			};
			moving.terminalReason = reason;
			return { type: 'terminal', reason };
		}
	}
}

function reverseAtTurning(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	prediction: DynamicSupportPrediction,
	position: Vec2,
	normal: Vec2
): DynamicSupportCommitResult {
	const tangent: Vec2 = [-normal[1], normal[0]];
	const acceleration = dotVec2(state.input.settings.gravity, tangent);
	if (Math.abs(acceleration) <= state.input.settings.tolerances.eventTime) {
		return numericalFailure(
			prediction.segment.endTime,
			'Dynamic support reached a turning point without a certified direction of departure.'
		);
	}
	support.time = prediction.segment.endTime;
	support.position = position;
	support.normal = normal;
	support.direction = acceleration > 0 ? 1 : -1;
	support.tangentialSpeed = 0;
	if (!refreshDynamicSupportPrediction(state, support)) {
		return numericalFailure(
			prediction.segment.endTime,
			'Dynamic support could not certify a future after its turning point.'
		);
	}
	return { type: 'continued' };
}

function commitAnchorLoss(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	prediction: DynamicSupportPrediction,
	position: Vec2
): DynamicSupportCommitResult {
	const released = new Set(
		prediction.boundary.type === 'anchored-support-lost'
			? prediction.boundary.releasedContactIds
			: []
	);
	for (const contactId of released)
		releaseDynamicContact(state, contactId, prediction.segment.endTime, 'support-reaction-zero');
	retireDynamicSupportComponent(state, support.componentId, prediction.segment.endTime);
	support.anchoredContacts = support.anchoredContacts.filter(({ id }) => !released.has(id));
	support.time = prediction.segment.endTime;
	support.position = position;
	support.normal = prediction.endReaction.normal;
	support.tangentialSpeed = prediction.endReaction.tangentialSpeed;
	const reaction = evaluateDynamicSupportReaction(
		state,
		support,
		prediction.seed,
		prediction.boundary.angle
	);
	if (reaction.support && reaction.bodyBodyReaction > supportTolerance(state)) {
		const revision = nextDynamicSupportRevision(state, support);
		support.componentId = `${support.id}:r${revision}`;
		createDynamicComponent(state, support, reaction, revision);
		if (refreshDynamicSupportPrediction(state, support)) return { type: 'continued' };
	}
	state.dynamicSupports.delete(support.id);
	state.dynamicSupportPredictions.delete(support.id);
	updateTerminalDynamicContact(state, support, prediction, position);
	return {
		type: 'terminal',
		reason: {
			type: 'unsupported-body-body-response',
			time: prediction.segment.endTime,
			bodyIds: [support.movingBodyId, support.supportBodyId],
			contactId: support.contactId,
			detail:
				'Anchored support was lost at the certified reaction boundary; continued contact would require a freely moving constrained cluster.'
		}
	};
}

function commitFixedContact(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	prediction: DynamicSupportPrediction,
	position: Vec2,
	velocity: Vec2
): DynamicSupportCommitResult {
	if (prediction.boundary.type !== 'contact')
		return numericalFailure(state.worldTime, 'Missing fixed-contact boundary.');
	const request: SustainedContactRequest = {
		input: state.input,
		body: state.runtimes.get(support.movingBodyId)!.body,
		colliderId: support.supportBodyId,
		time: prediction.segment.endTime,
		position,
		normal: prediction.endReaction.normal,
		outgoingVelocity: velocity,
		entryFrom: 'impact',
		entryReason: 'collider-contact'
	};
	const candidate = colliderCandidateAtState(
		request,
		prediction.boundary.colliderId,
		prediction.segment.endTime,
		position,
		velocity
	);
	if (!candidate)
		return numericalFailure(
			state.worldTime,
			'Dynamic support could not reconstruct its fixed-contact boundary.'
		);
	releaseDynamicContact(state, support.contactId, prediction.segment.endTime);
	releaseSupport(state, support, prediction.segment.endTime, 'collider-contact');
	const moving = state.runtimes.get(support.movingBodyId)!;
	moving.state = {
		...moving.state,
		time: prediction.segment.endTime,
		position,
		velocity,
		pendingContactCandidates: [candidate],
		acceptInitialContact: true,
		releasedContactColliderId: null,
		releasedContactColliderIds: []
	};
	refreshBodyPrediction(state, moving);
	return { type: 'continued' };
}

function activateMovingBody(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	position: Vec2,
	velocity: Vec2
): void {
	const moving = state.runtimes.get(support.movingBodyId)!;
	moving.state = {
		...moving.state,
		time: state.worldTime,
		position,
		velocity,
		pendingContactCandidates: [],
		retainedSupportCandidates: [],
		acceptInitialContact: false
	};
	moving.events.push(
		dynamicSupportTransition(
			support,
			state.worldTime,
			position,
			support.normal,
			'free-flight',
			'support-lost'
		)
	);
	refreshBodyPrediction(state, moving);
}

function releaseSupport(
	state: SchedulerState,
	support: DynamicSupportRuntime,
	time: number,
	reason: 'support-lost' | 'collider-contact'
): void {
	state.releasedDynamicPairs.add(pairKey(support.movingBodyId, support.supportBodyId));
	retireDynamicSupportComponent(state, support.componentId, time);
	createRestingAnchor(state, support, time);
	state.dynamicSupports.delete(support.id);
	state.dynamicSupportPredictions.delete(support.id);
	const moving = state.runtimes.get(support.movingBodyId)!;
	moving.events.push(
		dynamicSupportTransition(
			support,
			time,
			moving.state.position,
			support.normal,
			reason === 'collider-contact' ? 'impact' : 'free-flight',
			reason
		)
	);
}

function pairKey(firstBodyId: string, secondBodyId: string): string {
	return [firstBodyId, secondBodyId].sort().join('\u0000');
}

function supportTolerance(state: SchedulerState): number {
	return Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256);
}

function numericalFailure(time: number, detail: string): DynamicSupportCommitResult {
	return { type: 'terminal', reason: { type: 'numerical-failure', time, detail } };
}
