export type FieldValidationFailure = (path: string, requirement: string) => never;

export function createUnknownDataAssertions(fail: FieldValidationFailure) {
	function requireRecord(value: unknown, path: string): Record<string, unknown> {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			fail(path, 'must be an object');
		}
		return value as Record<string, unknown>;
	}

	function requireArray(value: unknown, path: string): unknown[] {
		if (!Array.isArray(value)) fail(path, 'must be an array');
		return value;
	}

	function requireString(value: unknown, path: string): void {
		if (typeof value !== 'string') fail(path, 'must be a string');
	}

	function requireNullableString(value: unknown, path: string): void {
		if (value !== null) requireString(value, path);
	}

	function requireFiniteNumber(value: unknown, path: string): void {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			fail(path, 'must be a finite number');
		}
	}

	function requireNullableFiniteNumber(value: unknown, path: string): void {
		if (value !== null) requireFiniteNumber(value, path);
	}

	function requireInteger(value: unknown, path: string): void {
		if (typeof value !== 'number' || !Number.isInteger(value)) fail(path, 'must be an integer');
	}

	function requireLiteral<T extends string | number>(
		value: unknown,
		expected: T,
		path: string
	): void {
		if (value !== expected) fail(path, `must be ${JSON.stringify(expected)}`);
	}

	function requireOneOf<T extends string>(
		value: unknown,
		expected: readonly T[],
		path: string
	): void {
		if (typeof value !== 'string' || !expected.includes(value as T)) {
			fail(path, `must be one of ${expected.map((option) => JSON.stringify(option)).join(', ')}`);
		}
	}

	function validateVec2(value: unknown, path: string): void {
		const vector = requireArray(value, path);
		if (vector.length !== 2) fail(path, 'must contain exactly two numbers');
		requireFiniteNumber(vector[0], `${path}[0]`);
		requireFiniteNumber(vector[1], `${path}[1]`);
	}

	return {
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
	};
}
