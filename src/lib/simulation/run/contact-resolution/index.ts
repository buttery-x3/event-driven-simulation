export { classifyPostResponseContacts } from './classification';
export { fixedContactId, singleBodyFixedContactState } from './exact-state';
export {
	REPRESENTED_MOTION_SPEED,
	admissibleConstrainedVelocities,
	classifySupportedMotion,
	isRepresentedRestCandidate,
	isSubResolutionNormalMotion,
	isSubResolutionPostNormalMotion,
	selectPostContactMode,
	type PostContactModeRequest,
	type SupportedMotionClassification,
	type SupportedMotionEvidence
} from './mode';
export { certifySupportEquilibrium } from './support-equilibrium';
export type {
	ExactContact,
	ExactContactBodyState,
	ExactTimeContactState,
	PostContactMode,
	PostResponseContactEvidence,
	ResolvedContactRole,
	ResolvedContactState,
	SupportReactionSolution
} from './types';
