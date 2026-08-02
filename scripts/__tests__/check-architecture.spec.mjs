import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkArchitecture } from '../check-architecture.mjs';

const temporaryRoots = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe('simulation architecture checker', () => {
	it('accepts the repository simulation topology', () => {
		expect(checkArchitecture(process.cwd())).toEqual([]);
	});

	it('accepts a named internal subdomain without freezing its implementation filenames', () => {
		const root = createFixture({
			'src/lib/simulation/run/single-ball/sustained-contact/index.ts':
				"export { continueContact } from './continuation';",
			'src/lib/simulation/run/single-ball/sustained-contact/continuation.ts':
				'export function continueContact() {}'
		});

		expect(checkArchitecture(root)).toEqual([]);
	});

	it('accepts verification as a leaf consumer of public contract and motion APIs', () => {
		const root = createFixture({
			'src/lib/simulation/contracts/index.ts': 'export type Run = string;',
			'src/lib/simulation/motion/index.ts': 'export type Evaluator = string;',
			'src/lib/simulation/verification/index.ts': "export { validate } from './validate';",
			'src/lib/simulation/verification/validate.ts':
				"import type { Run } from '../contracts'; import type { Evaluator } from '../motion'; export function validate(run: Run): Evaluator { return run; }"
		});

		expect(checkArchitecture(root)).toEqual([]);
	});

	it.each([
		{
			name: 'root-level implementation',
			code: 'ROOT_IMPLEMENTATION',
			files: { 'src/lib/simulation/orphan.ts': 'export const orphan = true;' }
		},
		{
			name: 'undocumented subsystem',
			code: 'UNDOCUMENTED_SUBSYSTEM',
			files: { 'src/lib/simulation/engines/index.ts': 'export type Engine = string;' }
		},
		{
			name: 'cross-subsystem deep import',
			code: 'DEEP_IMPORT',
			files: {
				'src/lib/simulation/run/construct.ts':
					"import type { Candidate } from '../collision/private'; export type Run = Candidate;",
				'src/lib/simulation/collision/private.ts': 'export interface Candidate {}'
			}
		},
		{
			name: 'reversed dependency',
			code: 'DEPENDENCY_DIRECTION',
			files: {
				'src/lib/simulation/math/calculate.ts':
					"import type { Scene } from '../world'; export type Result = Scene;",
				'src/lib/simulation/world/index.ts': 'export type Scene = string;'
			}
		},
		{
			name: 'circular dependency',
			code: 'CIRCULAR_DEPENDENCY',
			files: {
				'src/lib/simulation/run/construct.ts':
					"import type { Fixture } from '../serialization'; export type Run = Fixture;",
				'src/lib/simulation/serialization/index.ts':
					"export type { Run } from '../run'; export type Fixture = string;",
				'src/lib/simulation/run/index.ts': "export type { Run } from './construct';"
			}
		},
		{
			name: 'directory file limit',
			code: 'DIRECTORY_FILE_LIMIT',
			files: Object.fromEntries(
				Array.from({ length: 9 }, (_, index) => [
					`src/lib/simulation/math/file-${index}.ts`,
					`export const value${index} = ${index};`
				])
			)
		},
		{
			name: 'entry-point implementation logic',
			code: 'INDEX_LOGIC',
			files: { 'src/lib/simulation/math/index.ts': 'export const value = 1;' }
		},
		{
			name: 'catch-all directory',
			code: 'CATCH_ALL_DIRECTORY',
			files: { 'src/lib/simulation/math/utils/numbers.ts': 'export const value = 1;' }
		}
	])('detects $name', ({ code, files }) => {
		const root = createFixture(files);
		expect(checkArchitecture(root).map((finding) => finding.code)).toContain(code);
	});
});

function createFixture(files) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flame-35-architecture-'));
	temporaryRoots.push(root);
	for (const [relativePath, contents] of Object.entries(files)) {
		const file = path.join(root, relativePath);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, contents);
	}
	return root;
}
