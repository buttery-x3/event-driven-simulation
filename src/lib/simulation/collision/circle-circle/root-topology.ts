import type { IsolatedPolynomialRoot } from '../../math';

export type CircleCircleRootRegion = 'separated' | 'overlapping' | 'ambiguous';

export type CircleCircleRootTopology =
	'entering' | 'exiting' | 'grazing' | 'initial-contact' | 'indeterminate';

export interface CircleCircleRootTopologyEvidence {
	readonly topology: CircleCircleRootTopology;
	readonly before: CircleCircleRootRegion | null;
	readonly after: CircleCircleRootRegion | null;
}

export function classifyCircleCircleRootTopology(
	root: IsolatedPolynomialRoot,
	normalVelocity: number,
	normalVelocityTolerance: number,
	contactDistanceTolerance: number,
	surfaceSeparationAt: (normalizedTime: number) => number
): CircleCircleRootTopologyEvidence {
	const before = classifySample(
		root.neighbourhood.before?.normalizedTime ?? null,
		contactDistanceTolerance,
		surfaceSeparationAt
	);
	const after = classifySample(
		root.neighbourhood.after?.normalizedTime ?? null,
		contactDistanceTolerance,
		surfaceSeparationAt
	);

	if (before === null) return { topology: 'initial-contact', before, after };
	if (normalVelocity < -normalVelocityTolerance) {
		return { topology: 'entering', before, after };
	}
	if (normalVelocity > normalVelocityTolerance) {
		return { topology: 'exiting', before, after };
	}
	if (before === 'separated' && after === 'overlapping') {
		return { topology: 'entering', before, after };
	}
	if (before === 'overlapping' && after === 'separated') {
		return { topology: 'exiting', before, after };
	}
	if (before === 'separated' && after === 'separated') {
		return { topology: 'grazing', before, after };
	}
	return { topology: 'indeterminate', before, after };
}

export function initialContactMotion(
	evidence: CircleCircleRootTopologyEvidence,
	normalVelocity: number,
	normalVelocityTolerance: number
): Exclude<CircleCircleRootTopology, 'initial-contact'> {
	if (normalVelocity < -normalVelocityTolerance) return 'entering';
	if (normalVelocity > normalVelocityTolerance) return 'exiting';
	if (evidence.after === 'overlapping') return 'entering';
	if (evidence.after === 'separated') return 'grazing';
	return 'indeterminate';
}

function classifySample(
	normalizedTime: number | null,
	tolerance: number,
	surfaceSeparationAt: (normalizedTime: number) => number
): CircleCircleRootRegion | null {
	if (normalizedTime === null) return null;
	const separation = surfaceSeparationAt(normalizedTime);
	if (!Number.isFinite(separation) || Math.abs(separation) <= tolerance) return 'ambiguous';
	return separation > 0 ? 'separated' : 'overlapping';
}
