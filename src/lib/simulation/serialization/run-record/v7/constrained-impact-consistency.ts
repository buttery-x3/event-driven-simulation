import type { SimulationRunRecord } from '../../../contracts';
import { invalidRunRecordField } from '../../structural-validation';

export function validateConstrainedImpactConsistency(record: SimulationRunRecord): void {
	const bodyById = new Map(record.input.initialDynamicBodies.map((body) => [body.id, body]));
	const contactById = new Map(record.dynamicContacts.map((contact) => [contact.id, contact]));
	const componentById = new Map(
		record.contactComponents.map((component) => [component.id, component])
	);
	for (const [index, solve] of (record.diagnostics.constrainedImpactSolves ?? []).entries()) {
		const path = `$.diagnostics.constrainedImpactSolves[${index}]`;
		const component = componentById.get(solve.componentId);
		if (!component || component.type !== 'exact-time-impact') {
			invalidRunRecordField(`${path}.componentId`, 'must identify an exact-time impact component');
		}
		if (new Set(solve.bodyIds).size !== solve.bodyIds.length) {
			invalidRunRecordField(`${path}.bodyIds`, 'must not contain duplicate body IDs');
		}
		if (
			solve.masses.length !== solve.bodyIds.length * 2 ||
			solve.preImpactVelocity.length !== solve.masses.length ||
			solve.finalVelocity.length !== solve.masses.length
		) {
			invalidRunRecordField(path, 'must contain two velocity and mass coordinates per body');
		}
		for (const [bodyIndex, bodyId] of solve.bodyIds.entries()) {
			const body = bodyById.get(bodyId);
			if (!body || !component.bodyIds.includes(bodyId)) {
				invalidRunRecordField(`${path}.bodyIds[${bodyIndex}]`, 'must identify a component body');
			}
			if (
				solve.masses[bodyIndex * 2] !== body.mass ||
				solve.masses[bodyIndex * 2 + 1] !== body.mass
			) {
				invalidRunRecordField(
					`${path}.masses`,
					'must repeat each declared body mass by coordinate'
				);
			}
		}
		const contactIds = solve.contacts.map(({ contactId }) => contactId);
		if (
			new Set(contactIds).size !== contactIds.length ||
			contactIds.length !== component.activeContactIds.length ||
			contactIds.some(
				(contactId) =>
					!component.activeContactIds.includes(contactId) || !contactById.has(contactId)
			)
		) {
			invalidRunRecordField(
				`${path}.contacts`,
				'must partition every exact-time component contact'
			);
		}
		const impactIds = solve.contacts
			.filter(({ role }) => role === 'impact')
			.map(({ contactId }) => contactId);
		const supportIds = solve.contacts
			.filter(({ role }) => role === 'support-constraint')
			.map(({ contactId }) => contactId);
		if (
			!solve.contacts.some(({ contactId, role, preImpactNormalVelocity }) => {
				const contact = contactById.get(contactId);
				return (
					role === 'impact' &&
					preImpactNormalVelocity < 0 &&
					contact?.participants.every(({ type }) => type === 'body')
				);
			})
		) {
			invalidRunRecordField(
				`${path}.contacts`,
				'must contain a genuinely incoming body-body impact'
			);
		}
		validateReactionContactIds(
			solve.impactImpulses,
			impactIds,
			`${path}.impactImpulses`,
			'impulse'
		);
		validateReactionContactIds(
			solve.supportReactions,
			supportIds,
			`${path}.supportReactions`,
			'multiplier'
		);
		if (solve.impactImpulses.some(({ impulse }) => impulse < 0)) {
			invalidRunRecordField(`${path}.impactImpulses`, 'must contain only non-negative impulses');
		}
		validateLockReactions(solve, componentById, path);
	}
}

function validateReactionContactIds(
	reactions: readonly { readonly contactId: string }[],
	expectedIds: readonly string[],
	path: string,
	valueField: 'impulse' | 'multiplier'
): void {
	const ids = reactions.map(({ contactId }) => contactId);
	if (
		new Set(ids).size !== ids.length ||
		ids.length !== expectedIds.length ||
		ids.some((id) => !expectedIds.includes(id))
	) {
		invalidRunRecordField(path, `must contain one ${valueField} for each matching contact role`);
	}
}

function validateLockReactions(
	solve: NonNullable<SimulationRunRecord['diagnostics']['constrainedImpactSolves']>[number],
	componentById: ReadonlyMap<string, SimulationRunRecord['contactComponents'][number]>,
	path: string
): void {
	if (solve.mode === 'support-preserving' && solve.lockReactions.length > 0) {
		invalidRunRecordField(`${path}.lockReactions`, 'must be empty for support-preserving response');
	}
	if (solve.mode === 'anchored-fallback' && solve.lockReactions.length === 0) {
		invalidRunRecordField(
			`${path}.lockReactions`,
			'must declare at least one complete resting component for anchored fallback'
		);
	}
	const keys = solve.lockReactions.map(
		(reaction) => `${reaction.componentId}\u0000${reaction.bodyId}\u0000${reaction.axis}`
	);
	if (new Set(keys).size !== keys.length) {
		invalidRunRecordField(`${path}.lockReactions`, 'must not duplicate a locked coordinate');
	}
	const lockedComponentIds = [
		...new Set(solve.lockReactions.map(({ componentId }) => componentId))
	];
	for (const componentId of lockedComponentIds) {
		const component = componentById.get(componentId);
		if (!component || component.type !== 'resting-anchored') {
			invalidRunRecordField(
				`${path}.lockReactions`,
				'must identify complete resting-anchored components'
			);
		}
		if (
			solve.lockReactions.some(
				(reaction) =>
					reaction.componentId === componentId &&
					(!component.bodyIds.includes(reaction.bodyId) || !solve.bodyIds.includes(reaction.bodyId))
			)
		) {
			invalidRunRecordField(
				`${path}.lockReactions`,
				'must lock only bodies belonging to both the resting and impact components'
			);
		}
		for (const bodyId of component.bodyIds) {
			for (const axis of ['x', 'y'] as const) {
				if (
					!solve.lockReactions.some(
						(reaction) =>
							reaction.componentId === componentId &&
							reaction.bodyId === bodyId &&
							reaction.axis === axis
					)
				) {
					invalidRunRecordField(
						`${path}.lockReactions`,
						'must lock every coordinate of each declared resting component'
					);
				}
			}
		}
	}
}
