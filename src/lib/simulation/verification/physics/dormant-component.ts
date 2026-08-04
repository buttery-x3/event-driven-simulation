import type { Vec2 } from '../../contracts';
import { stateTolerance } from '../history';
import { reportRunValidationFailure, type RunValidationContext } from '../results';

export function validateDormantComponents(context: RunValidationContext): void {
	for (const [componentIndex, component] of context.run.contactComponents.entries()) {
		if (component.type !== 'resting-anchored') continue;
		const path = `$.contactComponents[${componentIndex}]`;
		const reactionByContact = new Map(
			component.retainedSupportReactions.map((reaction) => [
				reaction.contactId,
				reaction.impulsePerTime
			])
		);
		if (component.activeContactIds.some((id) => !reactionByContact.has(id))) {
			fail(
				context,
				'CONTACT_SET_MISMATCH',
				'A dormant component must record one sustained reaction for every active contact.',
				`${path}.retainedSupportReactions`
			);
			continue;
		}
		const forces = new Map<string, Vec2>();
		for (const bodyId of component.bodyIds) {
			const body = context.submittedInput.initialDynamicBodies.find(({ id }) => id === bodyId);
			if (!body) continue;
			forces.set(bodyId, [
				body.mass * context.submittedInput.settings.gravity[0],
				body.mass * context.submittedInput.settings.gravity[1]
			]);
		}
		for (const contactId of component.activeContactIds) {
			const contact = context.run.dynamicContacts.find(({ id }) => id === contactId);
			if (!contact) continue;
			const reaction = reactionByContact.get(contactId)!;
			if (reaction < -stateTolerance(context)) {
				fail(
					context,
					'ATTRACTIVE_SUPPORT_REACTION',
					'Dormant support reactions must be unilateral and non-negative.',
					`${path}.retainedSupportReactions`
				);
			}
			applyForce(forces, contact.participants[0], contact.normalFromFirstToSecond, -reaction);
			applyForce(forces, contact.participants[1], contact.normalFromFirstToSecond, reaction);
		}
		for (const [bodyId, force] of forces) {
			const body = context.submittedInput.initialDynamicBodies.find(({ id }) => id === bodyId);
			if (!body) continue;
			const scale = Math.max(1, body.mass * Math.hypot(...context.submittedInput.settings.gravity));
			if (Math.hypot(...force) > stateTolerance(context) * scale * 128) {
				fail(
					context,
					'INFEASIBLE_RESTING_SUPPORT',
					'Dormant contact reactions do not balance external force for this body.',
					`${path}.retainedSupportReactions`,
					bodyId
				);
			}
			validateStationaryCoverage(context, componentIndex, bodyId);
		}
	}
	validateSettledWorld(context);
}

function applyForce(
	forces: Map<string, Vec2>,
	participant:
		{ readonly type: 'body'; readonly bodyId: string } | { readonly type: 'fixed-collider' },
	normal: Vec2,
	scale: number
): void {
	if (participant.type !== 'body') return;
	const current = forces.get(participant.bodyId);
	if (!current) return;
	forces.set(participant.bodyId, [current[0] + normal[0] * scale, current[1] + normal[1] * scale]);
}

function validateStationaryCoverage(
	context: RunValidationContext,
	componentIndex: number,
	bodyId: string
): void {
	const component = context.run.contactComponents[componentIndex]!;
	const endTime = component.dissolvedAtTime ?? context.run.diagnostics.simulatedUntilTime;
	if (endTime <= component.createdAtTime + stateTolerance(context)) return;
	const segments = context.run.trajectories
		.find((trajectory) => trajectory.bodyId === bodyId)
		?.segments.filter(
			(segment) => segment.type === 'stationary' && segment.componentId === component.id
		);
	if (
		!segments?.some(
			(segment) =>
				segment.startTime <= component.createdAtTime + stateTolerance(context) &&
				segment.endTime >= endTime - stateTolerance(context)
		)
	) {
		fail(
			context,
			'INVALID_INTERVAL',
			'Dormant component membership must have replayable stationary trajectory coverage.',
			`$.trajectories`,
			bodyId
		);
	}
}

function validateSettledWorld(context: RunValidationContext): void {
	if (context.run.outcome !== 'settled') return;
	const invalid = context.run.bodyStates.find(
		(state) => !['resting', 'completed', 'escaped'].includes(state.lifecycle)
	);
	if (invalid || context.run.bodyStates.some((state) => state.lifecycle === 'scheduled')) {
		fail(
			context,
			'BODY_WORLD_OUTCOME_MISMATCH',
			'A settled world may contain only certified dormant or already-terminal bodies.',
			'$.bodyStates',
			invalid?.bodyId
		);
	}
}

function fail(
	context: RunValidationContext,
	code:
		| 'CONTACT_SET_MISMATCH'
		| 'ATTRACTIVE_SUPPORT_REACTION'
		| 'INFEASIBLE_RESTING_SUPPORT'
		| 'INVALID_INTERVAL'
		| 'BODY_WORLD_OUTCOME_MISMATCH',
	message: string,
	path: string,
	bodyId?: string
): void {
	reportRunValidationFailure(context, 'sustained-contact', code, message, { path, bodyId });
}
