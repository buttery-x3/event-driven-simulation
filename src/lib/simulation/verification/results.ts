import type { SimulationInput, SimulationRunRecord } from '../contracts';

export const runValidationCategories = [
	'record-structure',
	'multi-body-structure',
	'temporal-continuity',
	'contact-geometry',
	'collision-free-interval',
	'impact-manifold',
	'sustained-contact',
	'terminal-outcome',
	'serialization-consistency'
] as const;

export type RunValidationCategory = (typeof runValidationCategories)[number];

export type RunValidationFailureCode =
	| 'NON_FINITE_VALUE'
	| 'NON_FINITE_MULTIBODY_DATA'
	| 'DUPLICATE_BODY_ID'
	| 'INVALID_BODY_MASS'
	| 'INVALID_RELEASE_TIME'
	| 'UNRESOLVED_BODY_REFERENCE'
	| 'TRAJECTORY_OUTSIDE_BODY_LIFETIME'
	| 'OVERLAPPING_RELEASE_STATE'
	| 'BODY_WORLD_OUTCOME_MISMATCH'
	| 'INVALID_CONTACT_PARTICIPANT'
	| 'MALFORMED_COMPONENT_MEMBERSHIP'
	| 'SUBMITTED_INPUT_MISMATCH'
	| 'UNRESOLVED_REFERENCE'
	| 'DUPLICATE_REFERENCE'
	| 'COUNT_MISMATCH'
	| 'NON_MONOTONIC_TIME'
	| 'INVALID_INTERVAL'
	| 'DISCONTINUOUS_POSITION'
	| 'UNDECLARED_VELOCITY_CHANGE'
	| 'EVENT_STATE_MISMATCH'
	| 'PREFIX_AFTER_TERMINAL'
	| 'CONTACT_OFF_BOUNDARY'
	| 'CONTACT_NORMAL_MISMATCH'
	| 'CONSTRAINED_PATH_DRIFT'
	| 'EARLY_GEOMETRY_CROSSING'
	| 'NEGATIVE_IMPULSE'
	| 'PENETRATING_POST_IMPACT_VELOCITY'
	| 'IMPACT_EVIDENCE_MISMATCH'
	| 'NON_TANGENTIAL_CONSTRAINED_MOTION'
	| 'ATTRACTIVE_SUPPORT_REACTION'
	| 'INVALID_TURNING_POINT'
	| 'CONTACT_SET_MISMATCH'
	| 'OUTCOME_REASON_MISMATCH'
	| 'TERMINAL_BOUNDARY_MISMATCH'
	| 'LIMIT_MISMATCH'
	| 'INFEASIBLE_RESTING_SUPPORT'
	| 'INVALID_VALID_PREFIX'
	| 'SERIALIZATION_CHANGED_RECORD';

export interface RunValidationReference {
	readonly path: string;
	readonly time?: number;
	readonly bodyId?: string;
	readonly colliderId?: string;
}

export interface RunValidationFailure {
	readonly category: RunValidationCategory;
	readonly code: RunValidationFailureCode;
	readonly message: string;
	readonly reference: RunValidationReference;
}

export interface RunValidationResult {
	readonly valid: boolean;
	readonly checkedCategories: readonly RunValidationCategory[];
	readonly failures: readonly RunValidationFailure[];
}

export interface RunValidationContext {
	readonly submittedInput: SimulationInput;
	readonly run: SimulationRunRecord;
	readonly failures: RunValidationFailure[];
}

export function reportRunValidationFailure(
	context: RunValidationContext,
	category: RunValidationCategory,
	code: RunValidationFailureCode,
	message: string,
	reference: RunValidationReference
): void {
	context.failures.push({ category, code, message, reference });
}
