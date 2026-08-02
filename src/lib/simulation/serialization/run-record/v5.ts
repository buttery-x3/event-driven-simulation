import type { SimulationRunRecord } from '../../contracts';
import { RunFixtureError } from './error';
import {
	getRunOutcome,
	getTerminalDiagnosticCode,
	isOutcomeConsistentWithValidity
} from '../../run';
import { validateSceneDefinition } from '../../world';

export function validateRunFixtureV5(value: unknown): SimulationRunRecord {
	const run = requireRecord(value, '$');

	requireLiteral(run.contractVersion, 5, '$.contractVersion');
	validateSimulationInputV5(run.input, '$.input');
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
	validateRunConsistency(run);

	return value as SimulationRunRecord;
}

export function validateSimulationInputV5(
	value: unknown,
	path = '$'
): SimulationRunRecord['input'] {
	const input = requireRecord(value, path);
	const sceneValidation = validateSceneDefinition(input.scene, `${path}.scene`);

	if (!sceneValidation.valid) {
		const diagnostic = sceneValidation.diagnostics[0]!;
		fail(diagnostic.path, `${diagnostic.code}: ${diagnostic.message}`);
	}

	requireArray(input.initialDynamicBodies, `${path}.initialDynamicBodies`).forEach(
		(body, index) => {
			const bodyPath = `${path}.initialDynamicBodies[${index}]`;
			const record = requireRecord(body, bodyPath);

			requireString(record.id, `${bodyPath}.id`);
			requireLiteral(record.motionAuthority, 'dynamic', `${bodyPath}.motionAuthority`);
			validateCirclePhysicalShape(record.physicalShape, `${bodyPath}.physicalShape`);
			validateVec2(record.position, `${bodyPath}.position`);
			validateVec2(record.velocity, `${bodyPath}.velocity`);
		}
	);

	const settings = requireRecord(input.settings, `${path}.settings`);
	validateVec2(settings.gravity, `${path}.settings.gravity`);
	requireFiniteNumber(settings.restitution, `${path}.settings.restitution`);
	requireInteger(settings.maximumEvents, `${path}.settings.maximumEvents`);
	requireFiniteNumber(settings.maximumSimulationTime, `${path}.settings.maximumSimulationTime`);

	const tolerances = requireRecord(settings.tolerances, `${path}.settings.tolerances`);
	requireFiniteNumber(tolerances.contactDistance, `${path}.settings.tolerances.contactDistance`);
	requireFiniteNumber(tolerances.eventTime, `${path}.settings.tolerances.eventTime`);

	if (settings.settlement !== undefined) {
		const settlement = requireRecord(settings.settlement, `${path}.settings.settlement`);
		requireFiniteNumber(
			settlement.maximumNormalSeparationSpeed,
			`${path}.settings.settlement.maximumNormalSeparationSpeed`
		);
		requireFiniteNumber(
			settlement.maximumTangentialSpeed,
			`${path}.settings.settlement.maximumTangentialSpeed`
		);
		requireFiniteNumber(settlement.contactDistance, `${path}.settings.settlement.contactDistance`);
		requireFiniteNumber(
			settlement.minimumPressingAcceleration,
			`${path}.settings.settlement.minimumPressingAcceleration`
		);
	}

	return value as SimulationRunRecord['input'];
}

function validateCirclePhysicalShape(value: unknown, path: string): void {
	const shape = requireRecord(value, path);

	requireLiteral(shape.type, 'circle', `${path}.type`);
	requireFiniteNumber(shape.radius, `${path}.radius`);
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
		case 'settled-supporting-surface':
			requireFiniteNumber(reason.time, `${path}.time`);
			requireString(reason.colliderId, `${path}.colliderId`);
			validateVec2(reason.position, `${path}.position`);
			requireFiniteNumber(reason.normalSeparationSpeed, `${path}.normalSeparationSpeed`);
			requireFiniteNumber(reason.tangentialSpeed, `${path}.tangentialSpeed`);
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
			fail(`${path}.type`, 'must be a supported terminal reason');
	}
}

function validateRunConsistency(run: Record<string, unknown>): void {
	const record = run as unknown as SimulationRunRecord;
	const expectedOutcome = getRunOutcome(record.terminalReason);
	if (record.outcome !== expectedOutcome) {
		fail(
			'$.outcome',
			`must be ${JSON.stringify(expectedOutcome)} for terminal reason ${JSON.stringify(record.terminalReason.type)}`
		);
	}
	if (!isOutcomeConsistentWithValidity(record.outcome, record.validity)) {
		fail('$.validity', `must agree with terminal outcome ${JSON.stringify(record.outcome)}`);
	}
	if (record.diagnostics.eventCount !== record.events.length) {
		fail('$.diagnostics.eventCount', 'must equal the recorded event count');
	}
	if (record.diagnostics.iterations !== record.diagnostics.contactSearches.length) {
		fail('$.diagnostics.iterations', 'must equal the recorded contact-search count');
	}
	const candidateCount = record.diagnostics.contactSearches.reduce(
		(total, search) => total + search.candidates.length,
		0
	);
	if (record.diagnostics.candidateCount !== candidateCount) {
		fail('$.diagnostics.candidateCount', 'must equal the recorded candidate count');
	}
	const segmentCount = record.trajectories.reduce(
		(total, trajectory) => total + trajectory.segments.length,
		0
	);
	if (record.diagnostics.segmentCount !== segmentCount) {
		fail('$.diagnostics.segmentCount', 'must equal the recorded trajectory segment count');
	}
	if (
		record.terminalReason.time !== null &&
		record.diagnostics.simulatedUntilTime !== record.terminalReason.time
	) {
		fail('$.diagnostics.simulatedUntilTime', 'must equal the terminal-reason time');
	}
	if (record.terminalReason.time === null && record.diagnostics.simulatedUntilTime !== 0) {
		fail('$.diagnostics.simulatedUntilTime', 'must be zero when terminal time is unavailable');
	}
	const finalSegmentTime = record.trajectories
		.flatMap(({ segments }) => segments)
		.reduce<number | null>(
			(latest, segment) => (latest === null ? segment.endTime : Math.max(latest, segment.endTime)),
			null
		);
	if (finalSegmentTime !== null && finalSegmentTime !== record.diagnostics.simulatedUntilTime) {
		fail('$.trajectories', 'must end at the simulated-until time');
	}
	if (record.events.some(({ time }) => time > record.diagnostics.simulatedUntilTime)) {
		fail('$.events', 'must not contain an event after the simulated-until time');
	}
	const terminalEntry = record.diagnostics.entries.at(-1);
	if (!terminalEntry || terminalEntry.code !== getTerminalDiagnosticCode(record.outcome)) {
		fail(
			'$.diagnostics.entries',
			`must end with ${getTerminalDiagnosticCode(record.outcome)} for the terminal outcome`
		);
	}
	validateTerminalReference(record);
}

function validateTerminalReference(record: SimulationRunRecord): void {
	const reason = record.terminalReason;
	if (reason.type === 'completion-region' || reason.type === 'escape-region') {
		const region = record.input.scene.terminationRegions.find(({ id }) => id === reason.regionId);
		const expectedPurpose = reason.type === 'completion-region' ? 'complete' : 'escape';
		if (!region || region.purpose !== expectedPurpose) {
			fail(
				'$.terminalReason.regionId',
				`must identify a ${expectedPurpose} termination region in the input scene`
			);
		}
	}
	if (reason.type === 'settled-supporting-surface') {
		const policy = record.input.settings.settlement;
		if (!policy) {
			fail('$.input.settings.settlement', 'must be present for a settled outcome');
		}
		const collider = record.input.scene.staticColliders.find(({ id }) => id === reason.colliderId);
		if (
			!collider ||
			collider.physicalShape.type !== 'line-segment' ||
			!('surfaceRole' in collider) ||
			collider.surfaceRole !== 'supporting-flat'
		) {
			fail('$.terminalReason.colliderId', 'must identify a declared supporting-flat line segment');
		}
		if (
			reason.normalSeparationSpeed < 0 ||
			reason.normalSeparationSpeed > policy.maximumNormalSeparationSpeed ||
			reason.tangentialSpeed < 0 ||
			reason.tangentialSpeed > policy.maximumTangentialSpeed
		) {
			fail('$.terminalReason', 'must satisfy the configured settlement speed thresholds');
		}
		const lastEvent = record.events.at(-1);
		if (
			!lastEvent ||
			lastEvent.colliderId !== reason.colliderId ||
			lastEvent.time !== reason.time ||
			lastEvent.position[0] !== reason.position[0] ||
			lastEvent.position[1] !== reason.position[1]
		) {
			fail(
				'$.terminalReason',
				'must agree with the final recorded contact on its supporting surface'
			);
		}
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

			requireString(segmentRecord.bodyId, `${segmentPath}.bodyId`);
			requireFiniteNumber(segmentRecord.startTime, `${segmentPath}.startTime`);
			requireFiniteNumber(segmentRecord.endTime, `${segmentPath}.endTime`);
			validateVec2(segmentRecord.startPosition, `${segmentPath}.startPosition`);
			validateVec2(segmentRecord.startVelocity, `${segmentPath}.startVelocity`);
			validateVec2(segmentRecord.acceleration, `${segmentPath}.acceleration`);
		});
	});
}

function validateEvents(value: unknown, path: string): void {
	requireArray(value, path).forEach((event, index) => {
		const eventPath = `${path}[${index}]`;
		const record = requireRecord(event, eventPath);

		requireLiteral(record.type, 'contact', `${eventPath}.type`);
		requireFiniteNumber(record.time, `${eventPath}.time`);
		requireString(record.bodyId, `${eventPath}.bodyId`);
		requireString(record.colliderId, `${eventPath}.colliderId`);
		validateVec2(record.position, `${eventPath}.position`);
		validateVec2(record.normal, `${eventPath}.normal`);
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
			if (interval.length !== 2) fail(`${searchPath}.searchInterval`, 'must contain two times');
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
						fail(`${candidatePath}.nearSimultaneous`, 'must be a boolean');
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

function validateVec2(value: unknown, path: string): void {
	const vector = requireArray(value, path);

	if (vector.length !== 2) {
		fail(path, 'must contain exactly two numbers');
	}

	requireFiniteNumber(vector[0], `${path}[0]`);
	requireFiniteNumber(vector[1], `${path}[1]`);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail(path, 'must be an object');
	}

	return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) {
		fail(path, 'must be an array');
	}

	return value;
}

function requireString(value: unknown, path: string): void {
	if (typeof value !== 'string') {
		fail(path, 'must be a string');
	}
}

function requireNullableString(value: unknown, path: string): void {
	if (value !== null) {
		requireString(value, path);
	}
}

function requireFiniteNumber(value: unknown, path: string): void {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		fail(path, 'must be a finite number');
	}
}

function requireNullableFiniteNumber(value: unknown, path: string): void {
	if (value !== null) {
		requireFiniteNumber(value, path);
	}
}

function requireInteger(value: unknown, path: string): void {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		fail(path, 'must be an integer');
	}
}

function requireLiteral<T extends string | number>(
	value: unknown,
	expected: T,
	path: string
): asserts value is T {
	if (value !== expected) {
		fail(path, `must be ${JSON.stringify(expected)}`);
	}
}

function requireOneOf<T extends string>(
	value: unknown,
	expected: readonly T[],
	path: string
): asserts value is T {
	if (typeof value !== 'string' || !expected.includes(value as T)) {
		fail(path, `must be one of ${expected.map((option) => JSON.stringify(option)).join(', ')}`);
	}
}

function fail(path: string, requirement: string): never {
	throw new RunFixtureError(
		'INVALID_RUN_RECORD',
		`Saved run fixture field ${path} ${requirement}.`,
		path
	);
}
