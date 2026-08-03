import type { ContactManifoldMember, SimulationInput, SimulationRunRecord } from '../../contracts';
import {
	reportRunValidationFailure,
	type RunValidationContext,
	type RunValidationReference
} from '../results';

export function validateRecordIntegrity(context: RunValidationContext): void {
	if (!deepEqual(context.submittedInput, context.run.input)) {
		fail(
			context,
			'SUBMITTED_INPUT_MISMATCH',
			'The run input does not equal the immutable submitted input.',
			{ path: '$.input' }
		);
	}
	walkFinite(context, context.run, '$');
	validateReferences(context);
	validateCounts(context);
}

export function deepEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (typeof left !== typeof right || left === null || right === null) return false;
	if (typeof left !== 'object') return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => deepEqual(value, right[index]))
		);
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key) => Object.hasOwn(rightRecord, key) && deepEqual(leftRecord[key], rightRecord[key])
		)
	);
}

function walkFinite(context: RunValidationContext, value: unknown, path: string): void {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			fail(context, 'NON_FINITE_VALUE', 'Recorded numeric values must be finite.', { path });
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((entry, index) => walkFinite(context, entry, `${path}[${index}]`));
		return;
	}
	if (value && typeof value === 'object') {
		for (const [key, entry] of Object.entries(value)) walkFinite(context, entry, `${path}.${key}`);
	}
}

function validateReferences(context: RunValidationContext): void {
	const bodyIds = new Set(context.submittedInput.initialDynamicBodies.map(({ id }) => id));
	const colliderIds = new Set(context.submittedInput.scene.staticColliders.map(({ id }) => id));
	const regionIds = new Set(context.submittedInput.scene.terminationRegions.map(({ id }) => id));
	checkUniqueIds(
		context,
		context.submittedInput.initialDynamicBodies.map(({ id }) => id),
		'$.input.initialDynamicBodies'
	);
	checkUniqueIds(
		context,
		context.submittedInput.scene.staticColliders.map(({ id }) => id),
		'$.input.scene.staticColliders'
	);

	for (const [trajectoryIndex, trajectory] of context.run.trajectories.entries()) {
		checkReference(
			context,
			bodyIds,
			trajectory.bodyId,
			`$.trajectories[${trajectoryIndex}].bodyId`
		);
		for (const [segmentIndex, segment] of trajectory.segments.entries()) {
			const path = `$.trajectories[${trajectoryIndex}].segments[${segmentIndex}]`;
			checkReference(context, bodyIds, segment.bodyId, `${path}.bodyId`);
			if (segment.bodyId !== trajectory.bodyId) {
				fail(
					context,
					'UNRESOLVED_REFERENCE',
					'A segment must belong to its containing trajectory.',
					{
						path: `${path}.bodyId`,
						bodyId: segment.bodyId
					}
				);
			}
			if (segment.type === 'linear-contact' || segment.type === 'circular-contact') {
				checkReference(
					context,
					colliderIds,
					segment.supportingColliderId,
					`${path}.supportingColliderId`
				);
			}
		}
	}

	for (const [eventIndex, event] of context.run.events.entries()) {
		const path = `$.events[${eventIndex}]`;
		checkReference(context, bodyIds, event.bodyId, `${path}.bodyId`);
		checkReference(context, colliderIds, event.colliderId, `${path}.colliderId`);
		validateContactReferences(context, event.contacts, `${path}.contacts`, colliderIds);
	}

	for (const [searchIndex, search] of context.run.diagnostics.contactSearches.entries()) {
		const path = `$.diagnostics.contactSearches[${searchIndex}]`;
		if (search.selectedColliderId !== null) {
			checkReference(context, colliderIds, search.selectedColliderId, `${path}.selectedColliderId`);
		}
		for (const [index, colliderId] of (search.activeColliderIds ?? []).entries()) {
			checkReference(context, colliderIds, colliderId, `${path}.activeColliderIds[${index}]`);
		}
		for (const [candidateIndex, candidate] of search.candidates.entries()) {
			checkReference(
				context,
				colliderIds,
				candidate.colliderId,
				`${path}.candidates[${candidateIndex}].colliderId`
			);
		}
	}

	for (const [index, entry] of context.run.diagnostics.entries.entries()) {
		if (entry.bodyId !== null) {
			checkReference(context, bodyIds, entry.bodyId, `$.diagnostics.entries[${index}].bodyId`);
		}
	}
	validateTerminalReferences(context, colliderIds, regionIds);
}

function validateTerminalReferences(
	context: RunValidationContext,
	colliderIds: ReadonlySet<string>,
	regionIds: ReadonlySet<string>
): void {
	const reason = context.run.terminalReason;
	if (reason.type === 'completion-region' || reason.type === 'escape-region') {
		checkReference(context, regionIds, reason.regionId, '$.terminalReason.regionId');
	}
	if (reason.type === 'resting-contact' || reason.type === 'zero-time-loop') {
		checkReference(context, colliderIds, reason.colliderId, '$.terminalReason.colliderId');
	}
	if (reason.type === 'resting-contact') {
		validateContactReferences(context, reason.contacts, '$.terminalReason.contacts', colliderIds);
	}
}

function validateContactReferences(
	context: RunValidationContext,
	contacts: readonly ContactManifoldMember[] | undefined,
	path: string,
	colliderIds: ReadonlySet<string>
): void {
	for (const [index, contact] of (contacts ?? []).entries()) {
		checkReference(context, colliderIds, contact.colliderId, `${path}[${index}].colliderId`);
		if (contact.feature.trim().length === 0) {
			fail(context, 'UNRESOLVED_REFERENCE', 'A contact feature reference must not be empty.', {
				path: `${path}[${index}].feature`,
				colliderId: contact.colliderId
			});
		}
	}
}

function validateCounts(context: RunValidationContext): void {
	const diagnostics = context.run.diagnostics;
	const expected = {
		eventCount: context.run.events.length,
		segmentCount: context.run.trajectories.reduce(
			(total, trajectory) => total + trajectory.segments.length,
			0
		),
		iterations: diagnostics.contactSearches.length,
		candidateCount: diagnostics.contactSearches.reduce(
			(total, search) => total + search.candidates.length,
			0
		)
	};
	for (const [field, value] of Object.entries(expected)) {
		if (diagnostics[field as keyof typeof expected] !== value) {
			fail(context, 'COUNT_MISMATCH', `Diagnostic ${field} must equal ${value}.`, {
				path: `$.diagnostics.${field}`
			});
		}
	}
}

function checkUniqueIds(context: RunValidationContext, ids: readonly string[], path: string): void {
	const seen = new Set<string>();
	for (const [index, id] of ids.entries()) {
		if (seen.has(id)) {
			fail(context, 'DUPLICATE_REFERENCE', `Duplicate identifier ${JSON.stringify(id)}.`, {
				path: `${path}[${index}].id`
			});
		}
		seen.add(id);
	}
}

function checkReference(
	context: RunValidationContext,
	knownIds: ReadonlySet<string>,
	id: string,
	path: string
): void {
	if (!knownIds.has(id)) {
		fail(context, 'UNRESOLVED_REFERENCE', `Reference ${JSON.stringify(id)} does not resolve.`, {
			path
		});
	}
}

function fail(
	context: RunValidationContext,
	code: Parameters<typeof reportRunValidationFailure>[2],
	message: string,
	reference: RunValidationReference
): void {
	reportRunValidationFailure(context, 'record-structure', code, message, reference);
}

export function terminalTime(run: SimulationRunRecord): number {
	return run.terminalReason.time ?? 0;
}

export function bodyFor(input: SimulationInput, bodyId: string) {
	return input.initialDynamicBodies.find(({ id }) => id === bodyId);
}
