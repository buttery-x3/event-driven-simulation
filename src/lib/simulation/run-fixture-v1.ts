import type { SimulationRunRecord } from './contracts';
import { RunFixtureError } from './run-fixture-error';

export function validateRunFixtureV1(value: unknown): SimulationRunRecord {
	const run = requireRecord(value, '$');

	requireLiteral(run.contractVersion, 1, '$.contractVersion');
	validateSimulationInput(run.input, '$.input');
	validateRunStatus(run.status, '$.status');
	validateTrajectories(run.trajectories, '$.trajectories');
	validateEvents(run.events, '$.events');
	validateDiagnostics(run.diagnostics, '$.diagnostics');

	return value as SimulationRunRecord;
}

function validateSimulationInput(value: unknown, path: string): void {
	const input = requireRecord(value, path);
	const scene = requireRecord(input.scene, `${path}.scene`);

	requireString(scene.id, `${path}.scene.id`);
	requireArray(scene.fixedCircles, `${path}.scene.fixedCircles`).forEach((circle, index) => {
		const circlePath = `${path}.scene.fixedCircles[${index}]`;
		const record = requireRecord(circle, circlePath);

		requireString(record.id, `${circlePath}.id`);
		validateVec2(record.centre, `${circlePath}.centre`);
		requireFiniteNumber(record.radius, `${circlePath}.radius`);
	});

	requireArray(input.initialBodies, `${path}.initialBodies`).forEach((body, index) => {
		const bodyPath = `${path}.initialBodies[${index}]`;
		const record = requireRecord(body, bodyPath);

		requireString(record.id, `${bodyPath}.id`);
		validateVec2(record.position, `${bodyPath}.position`);
		validateVec2(record.velocity, `${bodyPath}.velocity`);
		requireFiniteNumber(record.radius, `${bodyPath}.radius`);
	});

	const settings = requireRecord(input.settings, `${path}.settings`);
	validateVec2(settings.gravity, `${path}.settings.gravity`);
	requireFiniteNumber(settings.restitution, `${path}.settings.restitution`);
	requireInteger(settings.maximumEvents, `${path}.settings.maximumEvents`);
	requireFiniteNumber(settings.maximumSimulationTime, `${path}.settings.maximumSimulationTime`);

	const tolerances = requireRecord(settings.tolerances, `${path}.settings.tolerances`);
	requireFiniteNumber(tolerances.contactDistance, `${path}.settings.tolerances.contactDistance`);
	requireFiniteNumber(tolerances.eventTime, `${path}.settings.tolerances.eventTime`);
}

function validateRunStatus(value: unknown, path: string): void {
	const status = requireRecord(value, path);

	switch (status.type) {
		case 'complete':
			return;
		case 'unresolved':
		case 'iteration-limited':
		case 'invalid':
			requireString(status.reason, `${path}.reason`);
			return;
		default:
			fail(`${path}.type`, 'must be a supported run status');
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
