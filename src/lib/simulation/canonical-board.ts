import type { SceneDefinition, StaticCircleCollider, StaticLineSegmentCollider } from './contracts';

export const canonicalBoardDimensions = {
	width: 5.4,
	height: 7
} as const;

export const canonicalPegDimensions = {
	radius: 0.09,
	horizontalSpacing: 0.6,
	verticalSpacing: 0.6,
	firstRowY: 5.75,
	rowCount: 8
} as const;

const pegField = Array.from(
	{ length: canonicalPegDimensions.rowCount },
	(_, rowIndex): readonly StaticCircleCollider[] => {
		const pegCount = rowIndex % 2 === 0 ? 7 : 8;
		const firstX = -((pegCount - 1) * canonicalPegDimensions.horizontalSpacing) / 2;
		const y = canonicalPegDimensions.firstRowY - rowIndex * canonicalPegDimensions.verticalSpacing;

		return Array.from({ length: pegCount }, (_, columnIndex) => ({
			id: `peg-row-${formatIndex(rowIndex)}-column-${formatIndex(columnIndex)}`,
			motionAuthority: 'static',
			physicalShape: { type: 'circle', radius: canonicalPegDimensions.radius },
			centre: [
				roundBoardCoordinate(firstX + columnIndex * canonicalPegDimensions.horizontalSpacing),
				roundBoardCoordinate(y)
			] as const
		}));
	}
).flat();

const boardBoundaries = [
	lineSegment('boundary-left-wall', [-2.55, 0.45], [-2.55, 6.25]),
	lineSegment('boundary-right-wall', [2.55, 0.45], [2.55, 6.25]),
	lineSegment('boundary-left-entry-guide', [-2.55, 6.25], [-2.05, 6.72]),
	lineSegment('boundary-right-entry-guide', [2.05, 6.72], [2.55, 6.25]),
	lineSegment('boundary-left-exit-floor', [-2.55, 0.45], [-0.5, 0.12]),
	lineSegment('boundary-right-exit-floor', [0.5, 0.12], [2.55, 0.45])
] as const;

export const canonicalPlinkoBoard = {
	id: 'canonical-plinko-board',
	coordinateSystem: {
		origin: 'centre-bottom',
		horizontalAxis: 'right',
		verticalAxis: 'up',
		lengthUnit: 'metre'
	},
	bounds: canonicalBoardDimensions,
	staticColliders: [...pegField, ...boardBoundaries],
	terminationRegions: [
		{
			id: 'termination-centre-exit',
			type: 'axis-aligned-box',
			purpose: 'complete',
			minimum: [-0.5, -0.3],
			maximum: [0.5, 0.12]
		}
	]
} as const satisfies SceneDefinition;

function lineSegment(
	id: string,
	start: StaticLineSegmentCollider['physicalShape']['start'],
	end: StaticLineSegmentCollider['physicalShape']['end']
): StaticLineSegmentCollider {
	return {
		id,
		motionAuthority: 'static',
		physicalShape: { type: 'line-segment', start, end }
	};
}

function formatIndex(index: number): string {
	return String(index + 1).padStart(2, '0');
}

function roundBoardCoordinate(value: number): number {
	return Number(value.toFixed(2));
}
