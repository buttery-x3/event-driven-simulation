import { createUnknownDataAssertions, invalidRunRecordField } from '../../structural-validation';

const assertions = createUnknownDataAssertions(invalidRunRecordField);

export function validatePhysicalAuthority(value: unknown, path: string): void {
	if (typeof value === 'string') {
		assertions.requireLiteral(value, 'certified', path);
		return;
	}
	const record = assertions.requireRecord(value, path);
	assertions.requireLiteral(record.type, 'approximate-after', `${path}.type`);
	assertions.requireFiniteNumber(record.time, `${path}.time`);
}

export function validateFailureContinuations(
	value: unknown,
	path: string,
	validateReason: (reason: unknown, reasonPath: string) => void
): void {
	assertions.requireArray(value, path).forEach((entry, index) => {
		const itemPath = `${path}[${index}]`;
		const item = assertions.requireRecord(entry, itemPath);
		assertions.requireFiniteNumber(item.freezeTime, `${itemPath}.freezeTime`);
		validateReason(item.originalFailure, `${itemPath}.originalFailure`);
		assertions
			.requireArray(item.affectedBodyIds, `${itemPath}.affectedBodyIds`)
			.forEach((bodyId, bodyIndex) =>
				assertions.requireString(bodyId, `${itemPath}.affectedBodyIds[${bodyIndex}]`)
			);
		validateBodyVectors(item.positions, `${itemPath}.positions`, 'position');
		validateBodyVectors(
			item.velocitiesBeforeFreeze,
			`${itemPath}.velocitiesBeforeFreeze`,
			'velocity'
		);
		if (item.representedModes !== undefined) {
			assertions
				.requireArray(item.representedModes, `${itemPath}.representedModes`)
				.forEach((mode, modeIndex) =>
					assertions.requireString(mode, `${itemPath}.representedModes[${modeIndex}]`)
				);
		}
		if (item.supportComponentIds !== undefined) {
			assertions
				.requireArray(item.supportComponentIds, `${itemPath}.supportComponentIds`)
				.forEach((id, idIndex) =>
					assertions.requireString(id, `${itemPath}.supportComponentIds[${idIndex}]`)
				);
		}
		if (item.triggeringPairOrContactId !== undefined) {
			assertions.requireString(
				item.triggeringPairOrContactId,
				`${itemPath}.triggeringPairOrContactId`
			);
		}
		assertions.requireLiteral(item.action, 'freeze-and-continue', `${itemPath}.action`);
	});
}

function validateBodyVectors(
	value: unknown,
	path: string,
	vectorField: 'position' | 'velocity'
): void {
	assertions.requireArray(value, path).forEach((entry, index) => {
		const itemPath = `${path}[${index}]`;
		const item = assertions.requireRecord(entry, itemPath);
		assertions.requireString(item.bodyId, `${itemPath}.bodyId`);
		assertions.validateVec2(item[vectorField], `${itemPath}.${vectorField}`);
	});
}
