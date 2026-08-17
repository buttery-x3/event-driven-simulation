import { createUnknownDataAssertions, invalidRunRecordField } from '../../structural-validation';

const assertions = createUnknownDataAssertions(invalidRunRecordField);

export function validateConstrainedImpactSolveShape(value: unknown, path: string): void {
	const solve = assertions.requireRecord(value, path);
	assertions.requireLiteral(solve.kind, 'support-preserving-elastic', `${path}.kind`);
	assertions.requireString(solve.componentId, `${path}.componentId`);
	assertions.requireOneOf(solve.mode, ['support-preserving', 'anchored-fallback'], `${path}.mode`);
	for (const field of ['bodyIds', 'masses', 'preImpactVelocity', 'finalVelocity'] as const) {
		assertions.requireArray(solve[field], `${path}.${field}`).forEach((entry, index) => {
			if (field === 'bodyIds') assertions.requireString(entry, `${path}.${field}[${index}]`);
			else assertions.requireFiniteNumber(entry, `${path}.${field}[${index}]`);
		});
	}
	assertions.requireArray(solve.contacts, `${path}.contacts`).forEach((entry, index) => {
		const itemPath = `${path}.contacts[${index}]`;
		const contact = assertions.requireRecord(entry, itemPath);
		assertions.requireString(contact.contactId, `${itemPath}.contactId`);
		assertions.requireOneOf(contact.role, ['support-constraint', 'impact'], `${itemPath}.role`);
		assertions.requireFiniteNumber(
			contact.preImpactNormalVelocity,
			`${itemPath}.preImpactNormalVelocity`
		);
		assertions.requireFiniteNumber(
			contact.postImpactNormalVelocity,
			`${itemPath}.postImpactNormalVelocity`
		);
	});
	for (const field of ['impactImpulses', 'supportReactions'] as const) {
		assertions.requireArray(solve[field], `${path}.${field}`).forEach((entry, index) => {
			const itemPath = `${path}.${field}[${index}]`;
			const item = assertions.requireRecord(entry, itemPath);
			assertions.requireString(item.contactId, `${itemPath}.contactId`);
			assertions.requireFiniteNumber(
				field === 'impactImpulses' ? item.impulse : item.multiplier,
				`${itemPath}.${field === 'impactImpulses' ? 'impulse' : 'multiplier'}`
			);
		});
	}
	assertions.requireArray(solve.lockReactions, `${path}.lockReactions`).forEach((entry, index) => {
		const itemPath = `${path}.lockReactions[${index}]`;
		const item = assertions.requireRecord(entry, itemPath);
		assertions.requireString(item.componentId, `${itemPath}.componentId`);
		assertions.requireString(item.bodyId, `${itemPath}.bodyId`);
		assertions.requireOneOf(item.axis, ['x', 'y'], `${itemPath}.axis`);
		assertions.requireFiniteNumber(item.multiplier, `${itemPath}.multiplier`);
	});
	const certificationPath = `${path}.certification`;
	const certification = assertions.requireRecord(solve.certification, certificationPath);
	for (const field of [
		'impactSpeed',
		'maximumPreSupportViolation',
		'maximumPostSupportViolation',
		'maximumPostImpactViolation',
		'incomingProjectionCorrectionNorm',
		'kineticEnergyBefore',
		'kineticEnergyAfter',
		'energyError',
		'momentumResidualNorm'
	] as const) {
		assertions.requireFiniteNumber(certification[field], `${certificationPath}.${field}`);
	}
	assertions.requireInteger(certification.reflectionCount, `${certificationPath}.reflectionCount`);
}
