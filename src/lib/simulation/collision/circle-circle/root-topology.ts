import { isolatePolynomialRoots, type IsolatedPolynomialRoot } from '../../math';

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
	if (before === 'separated' && after === 'overlapping') {
		return { topology: 'entering', before, after };
	}
	if (before === 'overlapping' && after === 'separated') {
		return { topology: 'exiting', before, after };
	}
	if (before === 'separated' && after === 'separated') {
		return { topology: 'grazing', before, after };
	}
	if (normalVelocity < -normalVelocityTolerance) {
		return { topology: 'entering', before, after };
	}
	if (normalVelocity > normalVelocityTolerance) {
		return { topology: 'exiting', before, after };
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

export function findToleranceContainedGrazingExit(
	roots: readonly IsolatedPolynomialRoot[],
	entryIndex: number,
	coefficients: readonly number[],
	normalizedEventTimeTolerance: number,
	polynomialResidualTolerance: number,
	maximumRefinementIterations: number,
	contactDistanceTolerance: number,
	surfaceSeparationAt: (normalizedTime: number) => number
): number | null {
	let clusterStartIndex: number | null = null;
	for (let index = entryIndex; index >= 0; index -= 1) {
		const beforeTime = roots[index]!.neighbourhood.before?.normalizedTime;
		if (beforeTime === undefined) continue;
		const separation = surfaceSeparationAt(beforeTime);
		if (!Number.isFinite(separation) || separation < -contactDistanceTolerance) return null;
		if (separation > contactDistanceTolerance) {
			clusterStartIndex = index;
			break;
		}
	}
	if (clusterStartIndex === null) {
		const initialSeparation = surfaceSeparationAt(0);
		if (!Number.isFinite(initialSeparation) || initialSeparation <= contactDistanceTolerance) {
			return null;
		}
		clusterStartIndex = 0;
	}

	const entryTime = roots[clusterStartIndex]!.normalizedTime;
	for (const root of roots.slice(entryIndex)) {
		const afterTime = root.neighbourhood.after?.normalizedTime;
		if (afterTime === undefined) continue;
		const separation = surfaceSeparationAt(afterTime);
		if (!Number.isFinite(separation) || separation < -contactDistanceTolerance) return null;
		if (separation <= contactDistanceTolerance) continue;
		return certifiesToleranceContainedPassage(
			coefficients,
			entryTime,
			root.normalizedTime,
			normalizedEventTimeTolerance,
			polynomialResidualTolerance,
			maximumRefinementIterations,
			contactDistanceTolerance,
			surfaceSeparationAt
		)
			? root.normalizedTime
			: null;
	}
	const finalSeparation = surfaceSeparationAt(1);
	const finalRoot = roots.at(-1);
	return finalRoot &&
		Number.isFinite(finalSeparation) &&
		finalSeparation > contactDistanceTolerance &&
		certifiesToleranceContainedPassage(
			coefficients,
			entryTime,
			finalRoot.normalizedTime,
			normalizedEventTimeTolerance,
			polynomialResidualTolerance,
			maximumRefinementIterations,
			contactDistanceTolerance,
			surfaceSeparationAt
		)
		? finalRoot.normalizedTime
		: null;
}

export function certifiesToleranceContainedPassage(
	coefficients: readonly number[],
	entryTime: number,
	exitTime: number | undefined,
	normalizedEventTimeTolerance: number,
	polynomialResidualTolerance: number,
	maximumRefinementIterations: number,
	contactDistanceTolerance: number,
	surfaceSeparationAt: (normalizedTime: number) => number
): boolean {
	if (exitTime === undefined || exitTime < entryTime) return false;
	if (exitTime === entryTime) {
		const separation = surfaceSeparationAt(entryTime);
		return Number.isFinite(separation) && separation >= -contactDistanceTolerance;
	}
	const derivative = coefficients.slice(1).map((coefficient, index) => coefficient * (index + 1));
	const critical = isolatePolynomialRoots(
		derivative,
		entryTime,
		exitTime,
		normalizedEventTimeTolerance,
		polynomialResidualTolerance,
		maximumRefinementIterations
	);
	if (critical.type === 'unresolved') return false;
	const minimumSeparation = Math.min(
		...[entryTime, exitTime, ...critical.roots.map(({ normalizedTime }) => normalizedTime)].map(
			surfaceSeparationAt
		)
	);
	return Number.isFinite(minimumSeparation) && minimumSeparation >= -contactDistanceTolerance;
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
