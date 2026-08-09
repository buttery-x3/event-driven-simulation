import { createUnknownDataAssertions, invalidRunRecordField } from '../../structural-validation';

const assertions = createUnknownDataAssertions(invalidRunRecordField);

export function validateAccumulationDiagnostic(value: unknown, path: string): void {
	const diagnostic = assertions.requireRecord(value, path);
	assertions.requireOneOf(diagnostic.status, ['certified', 'rejected'], `${path}.status`);
	assertions.requireString(diagnostic.reason, `${path}.reason`);
	assertions.requireLiteral(diagnostic.mechanism, 'general-accumulation', `${path}.mechanism`);
	for (const field of [
		'sourceEventIds',
		'participantBodyIds',
		'candidateFixedColliderIds',
		'downstreamImpactComponentIds',
		'downstreamSupportComponentIds'
	] as const) {
		assertions
			.requireArray(diagnostic[field], `${path}.${field}`)
			.forEach((id, index) => assertions.requireString(id, `${path}.${field}[${index}]`));
	}
	assertions.requireOneOf(
		diagnostic.finalClassification,
		['pending', 'separation', 'release', 'rest', 'sustained', 'unresolved'],
		`${path}.finalClassification`
	);
	if (diagnostic.limit === null) return;
	validateAccumulationLimit(diagnostic.limit, `${path}.limit`);
}

function validateAccumulationLimit(value: unknown, path: string): void {
	const limit = assertions.requireRecord(value, path);
	assertions.requireString(limit.id, `${path}.id`);
	for (const field of [
		'sourceEventIds',
		'participantBodyIds',
		'candidateFixedColliderIds'
	] as const) {
		assertions
			.requireArray(limit[field], `${path}.${field}`)
			.forEach((id, index) => assertions.requireString(id, `${path}.${field}[${index}]`));
	}
	for (const field of [
		'currentCertifiedTime',
		'candidateLimitTime',
		'remainingTimeUpperBound'
	] as const)
		assertions.requireFiniteNumber(limit[field], `${path}.${field}`);
	assertions.requireLiteral(
		limit.certificationMethod,
		'monotone-geometric-interval-envelope',
		`${path}.certificationMethod`
	);
	assertions.requireOneOf(
		limit.acquisitionTime,
		['current-certified-time', 'mathematical-limit'],
		`${path}.acquisitionTime`
	);
	assertions
		.requireArray(limit.limitingBodyStates, `${path}.limitingBodyStates`)
		.forEach((entry, index) => {
			const itemPath = `${path}.limitingBodyStates[${index}]`;
			const item = assertions.requireRecord(entry, itemPath);
			assertions.requireString(item.bodyId, `${itemPath}.bodyId`);
			assertions.validateVec2(item.position, `${itemPath}.position`);
			assertions.validateVec2(item.velocity, `${itemPath}.velocity`);
		});
	assertions
		.requireArray(limit.activeLimitContacts, `${path}.activeLimitContacts`)
		.forEach((entry, index) => {
			const itemPath = `${path}.activeLimitContacts[${index}]`;
			const item = assertions.requireRecord(entry, itemPath);
			assertions.requireString(item.id, `${itemPath}.id`);
			assertions.requireOneOf(item.type, ['body-fixed', 'body-body'], `${itemPath}.type`);
			assertions.validateVec2(item.contactPoint, `${itemPath}.contactPoint`);
			assertions.requireFiniteNumber(item.separation, `${itemPath}.separation`);
			if (item.type === 'body-fixed') {
				assertions.requireString(item.bodyId, `${itemPath}.bodyId`);
				assertions.requireString(item.colliderId, `${itemPath}.colliderId`);
				assertions.requireString(item.feature, `${itemPath}.feature`);
				assertions.validateVec2(item.normal, `${itemPath}.normal`);
			} else {
				assertions.requireString(item.firstBodyId, `${itemPath}.firstBodyId`);
				assertions.requireString(item.secondBodyId, `${itemPath}.secondBodyId`);
				assertions.validateVec2(
					item.normalFromFirstToSecond,
					`${itemPath}.normalFromFirstToSecond`
				);
			}
		});
	assertions
		.requireArray(limit.connectedComponents, `${path}.connectedComponents`)
		.forEach((entry, index) => {
			const itemPath = `${path}.connectedComponents[${index}]`;
			const item = assertions.requireRecord(entry, itemPath);
			assertions.requireString(item.id, `${itemPath}.id`);
			validateStringArray(item.bodyIds, `${itemPath}.bodyIds`);
			validateStringArray(item.fixedColliderIds, `${itemPath}.fixedColliderIds`);
			validateStringArray(item.contactIds, `${itemPath}.contactIds`);
		});
	assertions
		.requireArray(limit.stateResiduals, `${path}.stateResiduals`)
		.forEach((entry, index) => {
			const itemPath = `${path}.stateResiduals[${index}]`;
			const item = assertions.requireRecord(entry, itemPath);
			assertions.requireString(item.bodyId, `${itemPath}.bodyId`);
			for (const field of [
				'currentToLimitPositionDistance',
				'positionTailUpperBound',
				'positionResolution',
				'currentToLimitVelocityDistance',
				'velocityTailUpperBound',
				'velocityResolution'
			] as const)
				assertions.requireFiniteNumber(item[field], `${itemPath}.${field}`);
		});
	assertions
		.requireArray(limit.geometricResiduals, `${path}.geometricResiduals`)
		.forEach((entry, index) => {
			const itemPath = `${path}.geometricResiduals[${index}]`;
			const item = assertions.requireRecord(entry, itemPath);
			assertions.requireString(item.contactId, `${itemPath}.contactId`);
			assertions.requireFiniteNumber(item.separation, `${itemPath}.separation`);
			if (typeof item.activeAtLimit !== 'boolean') {
				invalidRunRecordField(`${itemPath}.activeAtLimit`, 'must be a boolean');
			}
		});
	const temporal = assertions.requireRecord(limit.temporalResiduals, `${path}.temporalResiduals`);
	for (const field of ['sourceEventTimes', 'positiveIntervals', 'contractionRatios'] as const)
		assertions
			.requireArray(temporal[field], `${path}.temporalResiduals.${field}`)
			.forEach((entry, index) =>
				assertions.requireFiniteNumber(entry, `${path}.temporalResiduals.${field}[${index}]`)
			);
	for (const field of [
		'certifiedRatioUpperBound',
		'latestInterval',
		'geometricTailEstimate',
		'eventTimeResolution'
	] as const)
		assertions.requireFiniteNumber(temporal[field], `${path}.temporalResiduals.${field}`);
	const penetration = assertions.requireRecord(
		limit.penetrationEvidence,
		`${path}.penetrationEvidence`
	);
	assertions.requireFiniteNumber(
		penetration.maximumPenetration,
		`${path}.penetrationEvidence.maximumPenetration`
	);
	assertions.requireFiniteNumber(
		penetration.contactDistanceTolerance,
		`${path}.penetrationEvidence.contactDistanceTolerance`
	);
	assertions.requireInteger(
		penetration.testedPairCount,
		`${path}.penetrationEvidence.testedPairCount`
	);
}

function validateStringArray(value: unknown, path: string): void {
	assertions
		.requireArray(value, path)
		.forEach((entry, index) => assertions.requireString(entry, `${path}[${index}]`));
}
