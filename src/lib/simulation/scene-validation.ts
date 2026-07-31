import type { SceneDefinition, StaticCircleCollider, StaticCollider, Vec2 } from './contracts';

export type SceneValidationDiagnosticCode =
	| 'DUPLICATE_ENTITY_ID'
	| 'INVALID_COORDINATE'
	| 'INVALID_DIMENSION'
	| 'INVALID_ENTITY_ID'
	| 'INVALID_SCENE_STRUCTURE'
	| 'UNSUPPORTED_GEOMETRY';

export interface SceneValidationDiagnostic {
	readonly code: SceneValidationDiagnosticCode;
	readonly path: string;
	readonly message: string;
}

export type SceneValidationResult =
	| { readonly valid: true; readonly scene: SceneDefinition; readonly diagnostics: readonly [] }
	| {
			readonly valid: false;
			readonly scene: null;
			readonly diagnostics: readonly SceneValidationDiagnostic[];
	  };

export class SceneValidationError extends Error {
	public readonly name = 'SceneValidationError';
	public readonly code = 'INVALID_SCENE_DEFINITION';

	public constructor(public readonly diagnostics: readonly SceneValidationDiagnostic[]) {
		super(
			diagnostics.length === 1
				? diagnostics[0]!.message
				: `Scene definition has ${diagnostics.length} validation errors.`
		);
	}
}

export function validateSceneDefinition(value: unknown, rootPath = '$'): SceneValidationResult {
	const diagnostics: SceneValidationDiagnostic[] = [];
	const scene = readRecord(value, rootPath, diagnostics);

	if (!scene) return invalid(diagnostics);

	requireEntityId(scene.id, `${rootPath}.id`, diagnostics);
	validateCoordinateSystem(scene.coordinateSystem, `${rootPath}.coordinateSystem`, diagnostics);
	validateBounds(scene.bounds, `${rootPath}.bounds`, diagnostics);

	const colliders = readArray(scene.staticColliders, `${rootPath}.staticColliders`, diagnostics);
	const terminationRegions = readArray(
		scene.terminationRegions,
		`${rootPath}.terminationRegions`,
		diagnostics
	);
	const ids = new Map<string, string>();

	colliders?.forEach((collider, index) => {
		const path = `${rootPath}.staticColliders[${index}]`;
		const record = readRecord(collider, path, diagnostics);

		if (!record) return;
		recordEntityId(record.id, `${path}.id`, ids, diagnostics);
		requireLiteral(record.motionAuthority, 'static', `${path}.motionAuthority`, diagnostics);
		validateCollider(record, path, diagnostics);
	});

	terminationRegions?.forEach((region, index) => {
		const path = `${rootPath}.terminationRegions[${index}]`;
		const record = readRecord(region, path, diagnostics);

		if (!record) return;
		recordEntityId(record.id, `${path}.id`, ids, diagnostics);
		validateTerminationRegion(record, path, diagnostics);
	});

	return diagnostics.length === 0
		? {
				valid: true,
				scene: value as SceneDefinition,
				diagnostics: []
			}
		: invalid(diagnostics);
}

export function assertValidSceneDefinition(
	value: unknown,
	rootPath = '$'
): asserts value is SceneDefinition {
	const result = validateSceneDefinition(value, rootPath);

	if (!result.valid) {
		throw new SceneValidationError(result.diagnostics);
	}
}

function validateCoordinateSystem(
	value: unknown,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): void {
	const coordinateSystem = readRecord(value, path, diagnostics);

	if (!coordinateSystem) return;
	requireLiteral(coordinateSystem.origin, 'centre-bottom', `${path}.origin`, diagnostics);
	requireLiteral(coordinateSystem.horizontalAxis, 'right', `${path}.horizontalAxis`, diagnostics);
	requireLiteral(coordinateSystem.verticalAxis, 'up', `${path}.verticalAxis`, diagnostics);
	requireLiteral(coordinateSystem.lengthUnit, 'metre', `${path}.lengthUnit`, diagnostics);
}

function validateBounds(
	value: unknown,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): void {
	const bounds = readRecord(value, path, diagnostics);

	if (!bounds) return;
	requirePositiveDimension(bounds.width, `${path}.width`, diagnostics);
	requirePositiveDimension(bounds.height, `${path}.height`, diagnostics);
}

function validateCollider(
	collider: Record<string, unknown>,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): void {
	const shapePath = `${path}.physicalShape`;
	const shape = readRecord(collider.physicalShape, shapePath, diagnostics);

	if (!shape) return;

	switch (shape.type) {
		case 'circle':
			requirePositiveDimension(shape.radius, `${shapePath}.radius`, diagnostics);
			requireVec2(collider.centre, `${path}.centre`, diagnostics);
			return;
		case 'line-segment': {
			const start = requireVec2(shape.start, `${shapePath}.start`, diagnostics);
			const end = requireVec2(shape.end, `${shapePath}.end`, diagnostics);

			if (start && end && start[0] === end[0] && start[1] === end[1]) {
				addDiagnostic(
					diagnostics,
					'INVALID_DIMENSION',
					shapePath,
					'Line-segment collider must have non-zero length.'
				);
			}
			if (collider.surfaceRole !== undefined) {
				requireLiteral(collider.surfaceRole, 'supporting-flat', `${path}.surfaceRole`, diagnostics);
				if (start && end && start[1] !== end[1]) {
					addDiagnostic(
						diagnostics,
						'INVALID_SCENE_STRUCTURE',
						`${path}.surfaceRole`,
						'A supporting-flat surface must be horizontal in board coordinates.'
					);
				}
			}
			return;
		}
		default:
			addDiagnostic(
				diagnostics,
				'UNSUPPORTED_GEOMETRY',
				`${shapePath}.type`,
				`Unsupported physical geometry ${JSON.stringify(shape.type)}.`
			);
	}
}

function validateTerminationRegion(
	region: Record<string, unknown>,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): void {
	requireLiteral(
		region.type,
		'axis-aligned-box',
		`${path}.type`,
		diagnostics,
		'UNSUPPORTED_GEOMETRY'
	);
	requireOneOf(region.purpose, ['complete', 'escape'], `${path}.purpose`, diagnostics);
	const minimum = requireVec2(region.minimum, `${path}.minimum`, diagnostics);
	const maximum = requireVec2(region.maximum, `${path}.maximum`, diagnostics);

	if (!minimum || !maximum) return;

	if (maximum[0] <= minimum[0]) {
		addDiagnostic(
			diagnostics,
			'INVALID_DIMENSION',
			`${path}.maximum[0]`,
			'Termination region width must be positive.'
		);
	}

	if (maximum[1] <= minimum[1]) {
		addDiagnostic(
			diagnostics,
			'INVALID_DIMENSION',
			`${path}.maximum[1]`,
			'Termination region height must be positive.'
		);
	}
}

function recordEntityId(
	value: unknown,
	path: string,
	ids: Map<string, string>,
	diagnostics: SceneValidationDiagnostic[]
): void {
	if (!requireEntityId(value, path, diagnostics)) return;

	const previousPath = ids.get(value);
	if (previousPath) {
		addDiagnostic(
			diagnostics,
			'DUPLICATE_ENTITY_ID',
			path,
			`Entity ID ${JSON.stringify(value)} duplicates ${previousPath}.`
		);
		return;
	}

	ids.set(value, path);
}

function requireEntityId(
	value: unknown,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): value is string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		addDiagnostic(diagnostics, 'INVALID_ENTITY_ID', path, 'Entity ID must be a non-empty string.');
		return false;
	}

	return true;
}

function requirePositiveDimension(
	value: unknown,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): value is number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		addDiagnostic(
			diagnostics,
			'INVALID_DIMENSION',
			path,
			'Physical dimension must be a positive finite number.'
		);
		return false;
	}

	return true;
}

function requireVec2(
	value: unknown,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): Vec2 | null {
	if (!Array.isArray(value) || value.length !== 2) {
		addDiagnostic(
			diagnostics,
			'INVALID_COORDINATE',
			path,
			'Coordinate must contain exactly two finite numbers.'
		);
		return null;
	}

	if (
		typeof value[0] !== 'number' ||
		!Number.isFinite(value[0]) ||
		typeof value[1] !== 'number' ||
		!Number.isFinite(value[1])
	) {
		addDiagnostic(
			diagnostics,
			'INVALID_COORDINATE',
			path,
			'Coordinate must contain exactly two finite numbers.'
		);
		return null;
	}

	return value as unknown as Vec2;
}

function requireLiteral(
	value: unknown,
	expected: string,
	path: string,
	diagnostics: SceneValidationDiagnostic[],
	code: SceneValidationDiagnosticCode = 'INVALID_SCENE_STRUCTURE'
): void {
	if (value !== expected) {
		addDiagnostic(diagnostics, code, path, `Value must be ${JSON.stringify(expected)}.`);
	}
}

function requireOneOf(
	value: unknown,
	expected: readonly string[],
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): void {
	if (typeof value !== 'string' || !expected.includes(value)) {
		addDiagnostic(
			diagnostics,
			'INVALID_SCENE_STRUCTURE',
			path,
			`Value must be one of ${expected.map((item) => JSON.stringify(item)).join(', ')}.`
		);
	}
}

function readRecord(
	value: unknown,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): Record<string, unknown> | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		addDiagnostic(diagnostics, 'INVALID_SCENE_STRUCTURE', path, 'Value must be an object.');
		return null;
	}

	return value as Record<string, unknown>;
}

function readArray(
	value: unknown,
	path: string,
	diagnostics: SceneValidationDiagnostic[]
): unknown[] | null {
	if (!Array.isArray(value)) {
		addDiagnostic(diagnostics, 'INVALID_SCENE_STRUCTURE', path, 'Value must be an array.');
		return null;
	}

	return value;
}

function invalid(
	diagnostics: readonly SceneValidationDiagnostic[]
): Extract<SceneValidationResult, { valid: false }> {
	return { valid: false, scene: null, diagnostics };
}

function addDiagnostic(
	diagnostics: SceneValidationDiagnostic[],
	code: SceneValidationDiagnosticCode,
	path: string,
	message: string
): void {
	diagnostics.push({ code, path, message });
}

export function isStaticCircleCollider(collider: StaticCollider): collider is StaticCircleCollider {
	return collider.physicalShape.type === 'circle';
}
