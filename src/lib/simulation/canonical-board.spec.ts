import { describe, expect, it } from 'vitest';
import { canonicalPegDimensions, canonicalPlinkoBoard } from './canonical-board';
import { validateSceneDefinition } from './scene-validation';

describe('canonical Plinko board', () => {
	it('constructs a staggered eight-row peg field with stable IDs', () => {
		const pegs = canonicalPlinkoBoard.staticColliders.filter(
			(collider) => collider.physicalShape.type === 'circle'
		);
		const rows = Array.from({ length: canonicalPegDimensions.rowCount }, (_, rowIndex) =>
			pegs.filter((peg) => peg.id.startsWith(`peg-row-${String(rowIndex + 1).padStart(2, '0')}`))
		);

		expect(pegs).toHaveLength(60);
		expect(rows.map((row) => row.length)).toEqual([7, 8, 7, 8, 7, 8, 7, 8]);
		expect(rows[0]?.map((peg) => ('centre' in peg ? peg.centre[0] : null))).toEqual([
			-1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8
		]);
		expect(rows[1]?.map((peg) => ('centre' in peg ? peg.centre[0] : null))).toEqual([
			-2.1, -1.5, -0.9, -0.3, 0.3, 0.9, 1.5, 2.1
		]);
		expect(new Set(pegs.map(({ id }) => id)).size).toBe(pegs.length);
	});

	it('includes physical boundaries and a completion region in board coordinates', () => {
		const boundaries = canonicalPlinkoBoard.staticColliders.filter(
			(collider) => collider.physicalShape.type === 'line-segment'
		);

		expect(boundaries.map(({ id }) => id)).toEqual([
			'boundary-left-wall',
			'boundary-right-wall',
			'boundary-left-entry-guide',
			'boundary-right-entry-guide',
			'boundary-left-exit-floor',
			'boundary-right-exit-floor'
		]);
		expect(canonicalPlinkoBoard.coordinateSystem).toEqual({
			origin: 'centre-bottom',
			horizontalAxis: 'right',
			verticalAxis: 'up',
			lengthUnit: 'metre'
		});
		expect(canonicalPlinkoBoard.terminationRegions).toEqual([
			{
				id: 'termination-centre-exit',
				type: 'axis-aligned-box',
				purpose: 'complete',
				minimum: [-0.5, -0.3],
				maximum: [0.5, 0.12]
			}
		]);
		expect(validateSceneDefinition(canonicalPlinkoBoard)).toMatchObject({ valid: true });
	});
});
