import type { SimulationRunRecord } from '../../../contracts';
import { validateSimulationInputV7 } from '../../simulation-input/v7';
import { createUnknownDataAssertions, invalidRunRecordField } from '../../structural-validation';
import { validateMultiBodyHistoryShape } from './multi-body-shape';

const assertions = createUnknownDataAssertions(invalidRunRecordField);

export function validateRunRecordShapeV7(value: unknown): SimulationRunRecord {
	const run = assertions.requireRecord(value, '$');
	assertions.requireLiteral(run.contractVersion, 7, '$.contractVersion');
	const input = validateSimulationInputV7(run.input, '$.input', invalidRunRecordField);
	assertions.requireOneOf(run.validity, ['valid', 'invalid'], '$.validity');
	assertions.requireOneOf(
		run.outcome,
		[
			'exited',
			'escaped',
			'settled',
			'no-future-event',
			'time-limit',
			'event-limit',
			'unresolved',
			'invalid'
		],
		'$.outcome'
	);
	validateTerminalReason(run.terminalReason, '$.terminalReason');
	validateTrajectories(run.trajectories, '$.trajectories');
	validatePhysicalEvents(run.events, '$.events');
	validateMultiBodyHistoryShape(run);
	validateDiagnostics(run.diagnostics, '$.diagnostics');
	return { ...(value as SimulationRunRecord), input };
}

function validateTerminalReason(value: unknown, path: string): void {
	const reason = assertions.requireRecord(value, path);
	switch (reason.type) {
		case 'world-complete':
			assertions.requireFiniteNumber(reason.time, `${path}.time`);
			assertions.requireOneOf(
				reason.outcome,
				['exited', 'escaped', 'settled', 'no-future-event'],
				`${path}.outcome`
			);
			assertions.requireString(reason.detail, `${path}.detail`);
			return;
		case 'completion-region':
		case 'escape-region':
			assertions.requireString(reason.regionId, `${path}.regionId`);
			assertions.requireFiniteNumber(reason.time, `${path}.time`);
			return;
		case 'bounds-escape':
			assertions.requireOneOf(
				reason.boundary,
				['left', 'right', 'bottom', 'top'],
				`${path}.boundary`
			);
			assertions.requireFiniteNumber(reason.time, `${path}.time`);
			return;
		case 'no-future-event':
		case 'unresolved-collision-search':
		case 'numerical-failure':
			assertions.requireFiniteNumber(reason.time, `${path}.time`);
			assertions.requireString(reason.detail, `${path}.detail`);
			return;
		case 'unsupported-body-body-response':
			assertions.requireFiniteNumber(reason.time, `${path}.time`);
			assertions.requireString(reason.contactId, `${path}.contactId`);
			assertions.requireString(reason.detail, `${path}.detail`);
			if (assertions.requireArray(reason.bodyIds, `${path}.bodyIds`).length !== 2)
				invalidRunRecordField(`${path}.bodyIds`, 'must contain two body IDs');
			assertions
				.requireArray(reason.bodyIds, `${path}.bodyIds`)
				.forEach((bodyId, index) => assertions.requireString(bodyId, `${path}.bodyIds[${index}]`));
			return;
		case 'time-limit':
		case 'event-limit':
			assertions.requireFiniteNumber(reason.time, `${path}.time`);
			assertions.requireFiniteNumber(reason.limit, `${path}.limit`);
			return;
		case 'resting-contact':
			assertions.requireFiniteNumber(reason.time, `${path}.time`);
			assertions.requireString(reason.colliderId, `${path}.colliderId`);
			assertions.validateVec2(reason.position, `${path}.position`);
			assertions.validateVec2(reason.normal, `${path}.normal`);
			if (reason.contacts !== undefined)
				validateManifoldContacts(reason.contacts, `${path}.contacts`);
			if (reason.supportReactions !== undefined) {
				assertions
					.requireArray(reason.supportReactions, `${path}.supportReactions`)
					.forEach((entry, index) =>
						assertions.requireFiniteNumber(entry, `${path}.supportReactions[${index}]`)
					);
			}
			assertions.requireOneOf(
				reason.reason,
				['impact-collapse', 'zero-tangential-motion'],
				`${path}.reason`
			);
			return;
		case 'zero-time-loop':
			assertions.requireFiniteNumber(reason.time, `${path}.time`);
			assertions.requireString(reason.colliderId, `${path}.colliderId`);
			assertions.requireString(reason.detail, `${path}.detail`);
			return;
		case 'invalid-state':
			assertions.requireNullableFiniteNumber(reason.time, `${path}.time`);
			assertions.requireString(reason.detail, `${path}.detail`);
			return;
		default:
			invalidRunRecordField(`${path}.type`, 'must be a supported terminal reason');
	}
}

function validateTrajectories(value: unknown, path: string): void {
	assertions.requireArray(value, path).forEach((trajectory, trajectoryIndex) => {
		const trajectoryPath = `${path}[${trajectoryIndex}]`;
		const record = assertions.requireRecord(trajectory, trajectoryPath);
		assertions.requireString(record.bodyId, `${trajectoryPath}.bodyId`);
		assertions
			.requireArray(record.segments, `${trajectoryPath}.segments`)
			.forEach((segment, segmentIndex) => {
				const segmentPath = `${trajectoryPath}.segments[${segmentIndex}]`;
				const item = assertions.requireRecord(segment, segmentPath);
				assertions.requireOneOf(
					item.type,
					['free-flight', 'linear-contact', 'circular-contact', 'stationary'],
					`${segmentPath}.type`
				);
				assertions.requireString(item.bodyId, `${segmentPath}.bodyId`);
				assertions.requireFiniteNumber(item.startTime, `${segmentPath}.startTime`);
				assertions.requireFiniteNumber(item.endTime, `${segmentPath}.endTime`);
				assertions.validateVec2(item.startPosition, `${segmentPath}.startPosition`);
				assertions.validateVec2(item.startVelocity, `${segmentPath}.startVelocity`);
				if (item.type === 'free-flight' || item.type === 'linear-contact') {
					assertions.validateVec2(item.acceleration, `${segmentPath}.acceleration`);
				}
				if (item.type === 'linear-contact') {
					assertions.requireString(
						item.supportingColliderId,
						`${segmentPath}.supportingColliderId`
					);
					assertions.validateVec2(item.contactNormal, `${segmentPath}.contactNormal`);
				}
				if (item.type === 'circular-contact') {
					assertions.requireString(
						item.supportingColliderId,
						`${segmentPath}.supportingColliderId`
					);
					if (item.supportingBodyId !== undefined)
						assertions.requireString(item.supportingBodyId, `${segmentPath}.supportingBodyId`);
					if (item.supportingComponentId !== undefined)
						assertions.requireString(
							item.supportingComponentId,
							`${segmentPath}.supportingComponentId`
						);
					assertions.validateVec2(item.centre, `${segmentPath}.centre`);
					for (const field of [
						'contactRadius',
						'startAngle',
						'endAngle',
						'startTangentialSpeed'
					] as const) {
						assertions.requireFiniteNumber(item[field], `${segmentPath}.${field}`);
					}
					if (item.direction !== -1 && item.direction !== 1)
						invalidRunRecordField(`${segmentPath}.direction`, 'must be -1 or 1');
					assertions.validateVec2(item.gravity, `${segmentPath}.gravity`);
				}
				if (item.type === 'stationary') {
					const startVelocity = assertions.requireArray(
						item.startVelocity,
						`${segmentPath}.startVelocity`
					);
					if (startVelocity[0] !== 0 || startVelocity[1] !== 0)
						invalidRunRecordField(`${segmentPath}.startVelocity`, 'must be [0, 0]');
					assertions.requireOneOf(
						item.reason,
						['resting-contact', 'dormant-component'],
						`${segmentPath}.reason`
					);
					assertions.requireNullableString(item.componentId, `${segmentPath}.componentId`);
				}
			});
	});
}

function validatePhysicalEvents(value: unknown, path: string): void {
	assertions.requireArray(value, path).forEach((event, index) => {
		const eventPath = `${path}[${index}]`;
		const record = assertions.requireRecord(event, eventPath);
		assertions.requireOneOf(
			record.type,
			['contact', 'contact-mode-transition'],
			`${eventPath}.type`
		);
		assertions.requireFiniteNumber(record.time, `${eventPath}.time`);
		assertions.requireString(record.bodyId, `${eventPath}.bodyId`);
		assertions.requireString(record.colliderId, `${eventPath}.colliderId`);
		if (record.supportingBodyId !== undefined)
			assertions.requireString(record.supportingBodyId, `${eventPath}.supportingBodyId`);
		assertions.validateVec2(record.position, `${eventPath}.position`);
		assertions.validateVec2(record.normal, `${eventPath}.normal`);
		if (record.contacts !== undefined)
			validateManifoldContacts(record.contacts, `${eventPath}.contacts`);
		if (record.preContactVelocity !== undefined)
			assertions.validateVec2(record.preContactVelocity, `${eventPath}.preContactVelocity`);
		if (record.postContactVelocity !== undefined)
			assertions.validateVec2(record.postContactVelocity, `${eventPath}.postContactVelocity`);
		if (record.type === 'contact-mode-transition') {
			assertions.requireOneOf(
				record.from,
				['free-flight', 'impact', 'resting', 'sliding'],
				`${eventPath}.from`
			);
			assertions.requireOneOf(
				record.to,
				['free-flight', 'impact', 'resting', 'sliding'],
				`${eventPath}.to`
			);
			assertions.requireString(record.reason, `${eventPath}.reason`);
		}
	});
}

function validateDiagnostics(value: unknown, path: string): void {
	const diagnostics = assertions.requireRecord(value, path);
	for (const field of ['iterations', 'eventCount', 'candidateCount', 'segmentCount'] as const) {
		assertions.requireInteger(diagnostics[field], `${path}.${field}`);
	}
	for (const field of ['simulatedUntilTime', 'simulationWallTimeMilliseconds'] as const) {
		assertions.requireFiniteNumber(diagnostics[field], `${path}.${field}`);
	}
	assertions.requireArray(diagnostics.contactSearches, `${path}.contactSearches`);
	assertions.requireArray(diagnostics.entries, `${path}.entries`);
	assertions
		.requireArray(diagnostics.bodyEventHorizons, `${path}.bodyEventHorizons`)
		.forEach((entry, index) => {
			const itemPath = `${path}.bodyEventHorizons[${index}]`;
			const item = assertions.requireRecord(entry, itemPath);
			assertions.requireString(item.bodyId, `${itemPath}.bodyId`);
			validateInterval(item.interval, `${itemPath}.interval`);
			validateRevision(item.revision, `${itemPath}.revision`);
			assertions.requireOneOf(
				item.eventType,
				[
					'release',
					'fixed-contact',
					'body-contact',
					'motion-transition',
					'termination',
					'none',
					'unresolved'
				],
				`${itemPath}.eventType`
			);
			if (item.decision !== undefined)
				assertions.requireOneOf(
					item.decision,
					['selected', 'retained', 'invalidated', 'discarded-stale'],
					`${itemPath}.decision`
				);
			if (item.reason !== undefined) assertions.requireString(item.reason, `${itemPath}.reason`);
			if (item.decisionWorldTime !== undefined)
				assertions.requireFiniteNumber(item.decisionWorldTime, `${itemPath}.decisionWorldTime`);
		});
	assertions
		.requireArray(diagnostics.pairPredictions, `${path}.pairPredictions`)
		.forEach((entry, index) => {
			const itemPath = `${path}.pairPredictions[${index}]`;
			const item = assertions.requireRecord(entry, itemPath);
			assertions.requireString(item.id, `${itemPath}.id`);
			const ids = assertions.requireArray(item.bodyIds, `${itemPath}.bodyIds`);
			if (ids.length !== 2)
				invalidRunRecordField(`${itemPath}.bodyIds`, 'must contain two body IDs');
			ids.forEach((id, bodyIndex) =>
				assertions.requireString(id, `${itemPath}.bodyIds[${bodyIndex}]`)
			);
			assertions.requireNullableFiniteNumber(item.predictedTime, `${itemPath}.predictedTime`);
			validateInterval(item.validInterval, `${itemPath}.validInterval`);
			const revisions = assertions.requireArray(item.revisions, `${itemPath}.revisions`);
			if (revisions.length !== 2)
				invalidRunRecordField(`${itemPath}.revisions`, 'must contain two revisions');
			revisions.forEach((revision, revisionIndex) =>
				validateRevision(revision, `${itemPath}.revisions[${revisionIndex}]`)
			);
			assertions.requireOneOf(
				item.decision,
				['selected', 'retained', 'invalidated', 'discarded-stale'],
				`${itemPath}.decision`
			);
			assertions.requireString(item.reason, `${itemPath}.reason`);
			if (item.decisionWorldTime !== undefined)
				assertions.requireFiniteNumber(item.decisionWorldTime, `${itemPath}.decisionWorldTime`);
			if (item.retainedThroughWorldTimes !== undefined)
				assertions
					.requireArray(item.retainedThroughWorldTimes, `${itemPath}.retainedThroughWorldTimes`)
					.forEach((time, timeIndex) =>
						assertions.requireFiniteNumber(
							time,
							`${itemPath}.retainedThroughWorldTimes[${timeIndex}]`
						)
					);
		});
	if (diagnostics.schedulerSteps !== undefined) {
		assertions
			.requireArray(diagnostics.schedulerSteps, `${path}.schedulerSteps`)
			.forEach((entry, index) => {
				const itemPath = `${path}.schedulerSteps[${index}]`;
				const item = assertions.requireRecord(entry, itemPath);
				assertions.requireFiniteNumber(item.worldTime, `${itemPath}.worldTime`);
				assertions.requireString(item.bodyId, `${itemPath}.bodyId`);
				assertions.requireInteger(item.revision, `${itemPath}.revision`);
				assertions.requireOneOf(
					item.eventType,
					[
						'release',
						'fixed-contact',
						'body-contact',
						'motion-transition',
						'termination',
						'none',
						'unresolved'
					],
					`${itemPath}.eventType`
				);
				assertions
					.requireArray(item.retainedBodyIds, `${itemPath}.retainedBodyIds`)
					.forEach((bodyId, bodyIndex) =>
						assertions.requireString(bodyId, `${itemPath}.retainedBodyIds[${bodyIndex}]`)
					);
			});
	}
	if (diagnostics.dynamicSupports !== undefined) {
		assertions
			.requireArray(diagnostics.dynamicSupports, `${path}.dynamicSupports`)
			.forEach((entry, index) => {
				const itemPath = `${path}.dynamicSupports[${index}]`;
				const item = assertions.requireRecord(entry, itemPath);
				for (const field of [
					'id',
					'contactId',
					'movingBodyId',
					'supportBodyId',
					'anchoredComponentId'
				] as const)
					assertions.requireString(item[field], `${itemPath}.${field}`);
				validateInterval(item.interval, `${itemPath}.interval`);
				for (const field of [
					'startNormal',
					'endNormal',
					'startLoadOnSupport',
					'endLoadOnSupport'
				] as const)
					assertions.validateVec2(item[field], `${itemPath}.${field}`);
				for (const field of [
					'startTangentialSpeed',
					'endTangentialSpeed',
					'startBodyBodyReaction',
					'endBodyBodyReaction'
				] as const)
					assertions.requireFiniteNumber(item[field], `${itemPath}.${field}`);
				for (const field of [
					'anchoredBodyIds',
					'retainedContactIds',
					'releasedContactIds'
				] as const)
					assertions
						.requireArray(item[field], `${itemPath}.${field}`)
						.forEach((id, idIndex) =>
							assertions.requireString(id, `${itemPath}.${field}[${idIndex}]`)
						);
				for (const field of ['fixedSupportReactionsAtStart', 'fixedSupportReactionsAtEnd'] as const)
					assertions
						.requireArray(item[field], `${itemPath}.${field}`)
						.forEach((reactionEntry, reactionIndex) => {
							const reactionPath = `${itemPath}.${field}[${reactionIndex}]`;
							const reaction = assertions.requireRecord(reactionEntry, reactionPath);
							assertions.requireString(reaction.contactId, `${reactionPath}.contactId`);
							assertions.requireFiniteNumber(reaction.reaction, `${reactionPath}.reaction`);
						});
				assertions.requireOneOf(
					item.outcome,
					[
						'retained',
						'turning-point',
						'detached',
						'support-contact-released',
						'fixed-contact',
						'terminal',
						'interrupted',
						'unresolved'
					],
					`${itemPath}.outcome`
				);
			});
	}
}

function validateInterval(value: unknown, path: string): void {
	const interval = assertions.requireArray(value, path);
	if (interval.length !== 2) invalidRunRecordField(path, 'must contain two times');
	assertions.requireFiniteNumber(interval[0], `${path}[0]`);
	assertions.requireFiniteNumber(interval[1], `${path}[1]`);
}

function validateRevision(value: unknown, path: string): void {
	const revision = assertions.requireRecord(value, path);
	assertions.requireString(revision.bodyId, `${path}.bodyId`);
	assertions.requireInteger(revision.revision, `${path}.revision`);
}

function validateManifoldContacts(value: unknown, path: string): void {
	assertions.requireArray(value, path).forEach((contact, index) => {
		const itemPath = `${path}[${index}]`;
		const item = assertions.requireRecord(contact, itemPath);
		assertions.requireString(item.colliderId, `${itemPath}.colliderId`);
		assertions.requireString(item.feature, `${itemPath}.feature`);
		assertions.validateVec2(item.contactPoint, `${itemPath}.contactPoint`);
		assertions.validateVec2(item.normal, `${itemPath}.normal`);
		for (const field of [
			'preImpactNormalVelocity',
			'postImpactNormalVelocity',
			'impulse'
		] as const) {
			assertions.requireFiniteNumber(item[field], `${itemPath}.${field}`);
		}
	});
}
