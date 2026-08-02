import type { SimulationRunRecord } from '../../contracts';
import { validateSimulationInputV6 } from '../simulation-input/v6';
import { createUnknownDataAssertions, invalidRunRecordField } from '../structural-validation';

const {
	requireArray,
	requireFiniteNumber,
	requireInteger,
	requireLiteral,
	requireNullableFiniteNumber,
	requireNullableString,
	requireOneOf,
	requireRecord,
	requireString,
	validateVec2
} = createUnknownDataAssertions(invalidRunRecordField);

export function validateRunRecordShapeV6(value: unknown): SimulationRunRecord {
	const run = requireRecord(value, '$');

	requireLiteral(run.contractVersion, 6, '$.contractVersion');
	validateSimulationInputV6(run.input, '$.input', invalidRunRecordField);
	requireOneOf(run.validity, ['valid', 'invalid'], '$.validity');
	requireOneOf(
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
	validateEvents(run.events, '$.events');
	validateDiagnostics(run.diagnostics, '$.diagnostics');

	return value as SimulationRunRecord;
}

function validateTerminalReason(value: unknown, path: string): void {
	const reason = requireRecord(value, path);

	switch (reason.type) {
		case 'completion-region':
		case 'escape-region':
			requireString(reason.regionId, `${path}.regionId`);
			requireFiniteNumber(reason.time, `${path}.time`);
			return;
		case 'bounds-escape':
			requireOneOf(reason.boundary, ['left', 'right', 'bottom', 'top'], `${path}.boundary`);
			requireFiniteNumber(reason.time, `${path}.time`);
			return;
		case 'no-future-event':
		case 'unresolved-collision-search':
		case 'numerical-failure':
			requireFiniteNumber(reason.time, `${path}.time`);
			requireString(reason.detail, `${path}.detail`);
			return;
		case 'time-limit':
		case 'event-limit':
			requireFiniteNumber(reason.time, `${path}.time`);
			requireFiniteNumber(reason.limit, `${path}.limit`);
			return;
		case 'resting-contact':
			requireFiniteNumber(reason.time, `${path}.time`);
			requireString(reason.colliderId, `${path}.colliderId`);
			validateVec2(reason.position, `${path}.position`);
			validateVec2(reason.normal, `${path}.normal`);
			requireOneOf(reason.reason, ['impact-collapse', 'zero-tangential-motion'], `${path}.reason`);
			return;
		case 'zero-time-loop':
			requireFiniteNumber(reason.time, `${path}.time`);
			requireString(reason.colliderId, `${path}.colliderId`);
			requireString(reason.detail, `${path}.detail`);
			return;
		case 'invalid-state':
			requireNullableFiniteNumber(reason.time, `${path}.time`);
			requireString(reason.detail, `${path}.detail`);
			return;
		default:
			invalidRunRecordField(`${path}.type`, 'must be a supported terminal reason');
	}
}

function validateTrajectories(value: unknown, path: string): void {
	requireArray(value, path).forEach((trajectory, trajectoryIndex) => {
		const trajectoryPath = `${path}[${trajectoryIndex}]`;
		const record = requireRecord(trajectory, trajectoryPath);

		requireString(record.bodyId, `${trajectoryPath}.bodyId`);
		requireArray(record.segments, `${trajectoryPath}.segments`).forEach((segment, segmentIndex) => {
			const segmentPath = `${trajectoryPath}.segments[${segmentIndex}]`;
			const segmentRecord = requireRecord(segment, segmentPath);

			requireOneOf(
				segmentRecord.type,
				['free-flight', 'linear-contact', 'circular-contact'],
				`${segmentPath}.type`
			);
			requireString(segmentRecord.bodyId, `${segmentPath}.bodyId`);
			requireFiniteNumber(segmentRecord.startTime, `${segmentPath}.startTime`);
			requireFiniteNumber(segmentRecord.endTime, `${segmentPath}.endTime`);
			validateVec2(segmentRecord.startPosition, `${segmentPath}.startPosition`);
			validateVec2(segmentRecord.startVelocity, `${segmentPath}.startVelocity`);
			if (segmentRecord.type === 'free-flight' || segmentRecord.type === 'linear-contact') {
				validateVec2(segmentRecord.acceleration, `${segmentPath}.acceleration`);
			}
			if (segmentRecord.type === 'linear-contact') {
				requireString(segmentRecord.supportingColliderId, `${segmentPath}.supportingColliderId`);
				validateVec2(segmentRecord.contactNormal, `${segmentPath}.contactNormal`);
			}
			if (segmentRecord.type === 'circular-contact') {
				requireString(segmentRecord.supportingColliderId, `${segmentPath}.supportingColliderId`);
				validateVec2(segmentRecord.centre, `${segmentPath}.centre`);
				requireFiniteNumber(segmentRecord.contactRadius, `${segmentPath}.contactRadius`);
				requireFiniteNumber(segmentRecord.startAngle, `${segmentPath}.startAngle`);
				requireFiniteNumber(segmentRecord.endAngle, `${segmentPath}.endAngle`);
				if (segmentRecord.direction !== -1 && segmentRecord.direction !== 1) {
					invalidRunRecordField(`${segmentPath}.direction`, 'must be -1 or 1');
				}
				requireFiniteNumber(
					segmentRecord.startTangentialSpeed,
					`${segmentPath}.startTangentialSpeed`
				);
				validateVec2(segmentRecord.gravity, `${segmentPath}.gravity`);
			}
		});
	});
}

function validateEvents(value: unknown, path: string): void {
	requireArray(value, path).forEach((event, index) => {
		const eventPath = `${path}[${index}]`;
		const record = requireRecord(event, eventPath);

		requireOneOf(record.type, ['contact', 'contact-mode-transition'], `${eventPath}.type`);
		requireFiniteNumber(record.time, `${eventPath}.time`);
		requireString(record.bodyId, `${eventPath}.bodyId`);
		requireString(record.colliderId, `${eventPath}.colliderId`);
		validateVec2(record.position, `${eventPath}.position`);
		validateVec2(record.normal, `${eventPath}.normal`);
		if (record.type === 'contact-mode-transition') {
			requireOneOf(
				record.from,
				['free-flight', 'impact', 'resting', 'sliding'],
				`${eventPath}.from`
			);
			requireOneOf(record.to, ['free-flight', 'impact', 'resting', 'sliding'], `${eventPath}.to`);
			requireOneOf(
				record.reason,
				[
					'impact-collapse',
					'supported-initial-state',
					'resting',
					'sliding',
					'endpoint-reached',
					'support-lost',
					'collider-contact',
					'terminal-region',
					'unresolved'
				],
				`${eventPath}.reason`
			);
		}
	});
}

function validateDiagnostics(value: unknown, path: string): void {
	const diagnostics = requireRecord(value, path);

	requireInteger(diagnostics.iterations, `${path}.iterations`);
	requireFiniteNumber(diagnostics.simulatedUntilTime, `${path}.simulatedUntilTime`);
	requireInteger(diagnostics.eventCount, `${path}.eventCount`);
	requireInteger(diagnostics.candidateCount, `${path}.candidateCount`);
	requireInteger(diagnostics.segmentCount, `${path}.segmentCount`);
	requireFiniteNumber(
		diagnostics.simulationWallTimeMilliseconds,
		`${path}.simulationWallTimeMilliseconds`
	);
	requireArray(diagnostics.contactSearches, `${path}.contactSearches`).forEach(
		(search, searchIndex) => {
			const searchPath = `${path}.contactSearches[${searchIndex}]`;
			const record = requireRecord(search, searchPath);
			const interval = requireArray(record.searchInterval, `${searchPath}.searchInterval`);
			if (interval.length !== 2) {
				invalidRunRecordField(`${searchPath}.searchInterval`, 'must contain two times');
			}
			requireFiniteNumber(interval[0], `${searchPath}.searchInterval[0]`);
			requireFiniteNumber(interval[1], `${searchPath}.searchInterval[1]`);
			if (record.eventTimeTolerance !== undefined) {
				requireFiniteNumber(record.eventTimeTolerance, `${searchPath}.eventTimeTolerance`);
			}
			requireOneOf(
				record.outcome,
				['contact', 'no-event', 'unresolved', 'invalid-input'],
				`${searchPath}.outcome`
			);
			requireNullableString(record.reason, `${searchPath}.reason`);
			requireNullableString(record.selectedColliderId, `${searchPath}.selectedColliderId`);
			requireArray(record.candidates, `${searchPath}.candidates`).forEach(
				(candidate, candidateIndex) => {
					const candidatePath = `${searchPath}.candidates[${candidateIndex}]`;
					const candidateRecord = requireRecord(candidate, candidatePath);
					requireString(candidateRecord.colliderId, `${candidatePath}.colliderId`);
					requireString(candidateRecord.feature, `${candidatePath}.feature`);
					requireFiniteNumber(candidateRecord.time, `${candidatePath}.time`);
					requireString(candidateRecord.classification, `${candidatePath}.classification`);
					if (candidateRecord.timeDelta !== undefined) {
						requireFiniteNumber(candidateRecord.timeDelta, `${candidatePath}.timeDelta`);
					}
					for (const field of [
						'position',
						'contactPoint',
						'normal',
						'preContactVelocity',
						'postContactVelocity'
					] as const) {
						if (candidateRecord[field] !== undefined) {
							validateVec2(candidateRecord[field], `${candidatePath}.${field}`);
						}
					}
					if (candidateRecord.normalVelocity !== undefined) {
						requireFiniteNumber(candidateRecord.normalVelocity, `${candidatePath}.normalVelocity`);
					}
					if (
						candidateRecord.nearSimultaneous !== undefined &&
						typeof candidateRecord.nearSimultaneous !== 'boolean'
					) {
						invalidRunRecordField(`${candidatePath}.nearSimultaneous`, 'must be a boolean');
					}
				}
			);
		}
	);
	requireArray(diagnostics.entries, `${path}.entries`).forEach((entry, index) => {
		const entryPath = `${path}.entries[${index}]`;
		const record = requireRecord(entry, entryPath);

		requireOneOf(record.severity, ['info', 'warning', 'error'], `${entryPath}.severity`);
		requireString(record.code, `${entryPath}.code`);
		requireString(record.message, `${entryPath}.message`);
		requireNullableFiniteNumber(record.time, `${entryPath}.time`);
		requireNullableString(record.bodyId, `${entryPath}.bodyId`);
	});
}
