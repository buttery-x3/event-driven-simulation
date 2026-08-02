import { describe, expect, it } from 'vitest';
import { canonicalPlinkoBoard } from '../canonical-board';
import {
	assertValidSceneDefinition,
	SceneValidationError,
	validateSceneDefinition
} from '../scene-validation';

describe('scene validation', () => {
	it('rejects unsupported geometry, duplicate IDs and invalid dimensions with typed diagnostics', () => {
		const malformed = structuredClone(canonicalPlinkoBoard) as unknown as {
			bounds: { width: number };
			staticColliders: Array<{
				id: string;
				physicalShape: { type: string; radius?: number };
			}>;
			terminationRegions: Array<{ id: string; maximum: [number, number] }>;
		};
		malformed.bounds.width = 0;
		malformed.staticColliders[0]!.physicalShape = { type: 'triangle' };
		malformed.staticColliders[1]!.id = malformed.staticColliders[0]!.id;
		malformed.terminationRegions[0]!.maximum = [-0.5, 0.12];

		const result = validateSceneDefinition(malformed);

		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'INVALID_DIMENSION',
					path: '$.bounds.width'
				}),
				expect.objectContaining({
					code: 'UNSUPPORTED_GEOMETRY',
					path: '$.staticColliders[0].physicalShape.type'
				}),
				expect.objectContaining({
					code: 'DUPLICATE_ENTITY_ID',
					path: '$.staticColliders[1].id'
				}),
				expect.objectContaining({
					code: 'INVALID_DIMENSION',
					path: '$.terminationRegions[0].maximum[0]'
				})
			])
		);
	});

	it('throws a typed aggregate error when assertion is required before simulation', () => {
		const malformed = {
			...canonicalPlinkoBoard,
			bounds: { ...canonicalPlinkoBoard.bounds, height: Number.NaN }
		};

		expect(() => assertValidSceneDefinition(malformed)).toThrowError(
			expect.objectContaining<Partial<SceneValidationError>>({
				code: 'INVALID_SCENE_DEFINITION',
				diagnostics: [
					expect.objectContaining({
						code: 'INVALID_DIMENSION',
						path: '$.bounds.height'
					})
				]
			})
		);
	});
});
