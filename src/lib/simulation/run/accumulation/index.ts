export { certifyAccumulationLimit, type CertifyAccumulationInput } from './certify';
export { physicalEventsFromImpactHistory } from './from-impact-history';
export { toAccumulationBody } from './limit-geometry';
export {
	promoteSingleBodyAccumulation,
	type PromotedSingleBodyImpact
} from './promote-single-body';
export { certifyTemporalTail, isAccumulationSequenceCandidate } from './temporal';
export { extractParticipantCluster } from './cluster';
export { decomposeLimitComponents } from './components';
export type {
	AccumulationBodyState,
	AccumulationCertificationMethod,
	AccumulationCertificationResult,
	AccumulationConnectedComponent,
	AccumulationLimit,
	AccumulationLimitContact,
	AccumulationPhysicalEvent,
	AccumulationRejectionReason,
	AccumulationTemporalCertificate
} from './types';
