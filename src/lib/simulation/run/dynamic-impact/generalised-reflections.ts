import type { Vec2 } from '../../contracts';
import { addScaled, dot, gramMatrix, weightedNorm } from './linear-algebra';
import { detectLineality, projectEqualityCompatible } from './lineality';
import { solveNonnegativeLeastSquares, solveNonnegativeQuadratic } from './nonnegative-qp';
import type {
	CoupledImpactContact,
	CoupledImpactDiagnostic,
	CoupledImpactInput,
	CoupledImpactResult,
	ReflectionDiagnostic
} from './types';

interface PreparedProblem {
	readonly bodyIndex: ReadonlyMap<string, number>;
	readonly masses: readonly number[];
	readonly inverseMasses: readonly number[];
	readonly velocity: readonly number[];
	readonly momentum: readonly number[];
	readonly gradients: readonly (readonly number[])[];
}

interface ElasticEndpoint {
	readonly velocity: readonly number[];
	readonly projectedVelocity: readonly number[];
	readonly projectedGradients: readonly (readonly number[])[];
	readonly removedIndices: readonly number[];
	readonly linealityIndices: readonly number[];
	readonly equalityBasis: readonly (readonly number[])[];
	readonly threshold: number;
	readonly reflections: readonly ReflectionDiagnostic[];
}

export function resolveCoupledImpact(input: CoupledImpactInput): CoupledImpactResult {
	const invalid = validate(input);
	if (invalid) return { type: 'rejected', reason: invalid };
	const problem = prepare(input);
	const tolerance = effectiveTolerance(input);
	const inelastic = solveInelastic(problem, tolerance);
	if (!inelastic) return { type: 'rejected', reason: 'The maximum-dissipation endpoint could not be certified.' };
	const elastic = solveElastic(input, problem, tolerance);
	if (typeof elastic === 'string') {
		return {
			type: 'rejected',
			reason: elastic,
			diagnostic: failureDiagnostic(input, problem, inelastic, elastic)
		};
	}
	const finalVelocity = inelastic.map(
		(value, index) => (1 - input.restitution) * value + input.restitution * elastic.velocity[index]!
	);
	const feasibilityTolerance = tolerance * Math.max(1, weightedNorm(finalVelocity, problem.masses)) * 64;
	if (normalVelocities(problem.gradients, finalVelocity).some((value) => value < -feasibilityTolerance))
		return { type: 'rejected', reason: 'The energetic-restitution endpoint is infeasible.' };
	const momentumDelta = finalVelocity.map(
		(value, index) => problem.masses[index]! * (value - problem.velocity[index]!)
	);
	const impulses = solveNonnegativeLeastSquares(problem.gradients, momentumDelta, tolerance);
	if (!impulses || impulses.residualNorm > feasibilityTolerance)
		return { type: 'rejected', reason: 'The final momentum change has no certified non-negative impulse representation.' };
	const diagnostic = completeDiagnostic(input, problem, inelastic, elastic, finalVelocity);
	return {
		type: 'response',
		response: {
			bodyVelocities: input.bodies.map((body, index) => ({
				bodyId: body.id,
				velocity: [finalVelocity[index * 2]!, finalVelocity[index * 2 + 1]!] as Vec2
			})),
			contacts: input.contacts.map((contact, index) => ({
				contactId: contact.id,
				impulse: normalize(impulses.values[index] ?? 0, feasibilityTolerance),
				preImpactNormalVelocity: normalize(dot(problem.gradients[index]!, problem.velocity), feasibilityTolerance),
				postImpactNormalVelocity: normalize(dot(problem.gradients[index]!, finalVelocity), feasibilityTolerance)
			})),
			inelasticVelocity: inelastic,
			elasticVelocity: elastic.velocity,
			finalVelocity,
			diagnostic
		}
	};
}

function solveInelastic(problem: PreparedProblem, tolerance: number): number[] | null {
	const hessian = gramMatrix(problem.gradients, problem.inverseMasses);
	const linear = normalVelocities(problem.gradients, problem.velocity);
	const solution = solveNonnegativeQuadratic(hessian, linear, tolerance);
	if (!solution) return null;
	let momentum = [...problem.momentum];
	for (let index = 0; index < problem.gradients.length; index += 1)
		momentum = addScaled(momentum, problem.gradients[index]!, solution.values[index]!);
	const velocity = momentum.map((value, index) => value * problem.inverseMasses[index]!);
	return normalVelocities(problem.gradients, velocity).every((value) => value >= -tolerance * 32)
		? velocity
		: null;
}

function solveElastic(
	input: CoupledImpactInput,
	problem: PreparedProblem,
	tolerance: number
): ElasticEndpoint | string {
	const lineality = detectLineality(problem.gradients, tolerance);
	const projectedVelocity = projectEqualityCompatible(
		problem.velocity,
		lineality.basis,
		problem.inverseMasses,
		tolerance
	);
	if (!projectedVelocity) return 'impact-termination-certification-failed: anti-locking projection failed.';
	const projected: { readonly index: number; readonly gradient: readonly number[] }[] = [];
	const removedIndices: number[] = [];
	for (let index = 0; index < problem.gradients.length; index += 1) {
		const gradient = projectEqualityCompatible(
			problem.gradients[index]!,
			lineality.basis,
			problem.inverseMasses,
			tolerance
		);
		if (!gradient) return 'impact-termination-certification-failed: contact projection failed.';
		const norm = weightedNorm(gradient, problem.inverseMasses);
		if (norm <= tolerance * 16) removedIndices.push(index);
		else projected.push({ index, gradient: gradient.map((value) => value / norm) });
	}
	let velocity = [...projectedVelocity];
	const initialNorm = weightedNorm(projectedVelocity, problem.masses);
	const threshold = Math.max(
		input.tolerances.absoluteNormalVelocityFloor,
		input.tolerances.relativeViolationEpsilon * initialNorm
	);
	const reflections: ReflectionDiagnostic[] = [];
	for (let iteration = 0; iteration < input.tolerances.maximumReflections; iteration += 1) {
		const violating = projected.filter(({ gradient }) => dot(gradient, velocity) < -threshold);
		if (violating.length === 0) {
			if (normalVelocities(problem.gradients, velocity).some((value) => value < -threshold * 16))
				return 'impact-termination-certification-failed: reduced feasibility did not imply complete feasibility.';
			return {
				velocity,
				projectedVelocity,
				projectedGradients: projected.map(({ gradient }) => gradient),
				removedIndices,
				linealityIndices: lineality.contactIndices,
				equalityBasis: lineality.basis,
				threshold,
				reflections
			};
		}
		const gradients = violating.map(({ gradient }) => gradient);
		const hessian = gramMatrix(gradients, problem.inverseMasses);
		const linear = gradients.map((gradient) => 2 * dot(gradient, velocity));
		const solution = solveNonnegativeQuadratic(hessian, linear, tolerance);
		if (!solution || solution.values.every((value) => value <= tolerance))
			return 'impact-termination-certification-failed: a violating subset was not materially modified.';
		let tentativeMomentum = velocity.map((value, index) => problem.masses[index]! * value);
		for (let index = 0; index < gradients.length; index += 1)
			tentativeMomentum = addScaled(tentativeMomentum, gradients[index]!, solution.values[index]!);
		const tentativeVelocity = tentativeMomentum.map(
			(value, index) => value * problem.inverseMasses[index]!
		);
		const tentativeNorm = weightedNorm(tentativeVelocity, problem.masses);
		if (!Number.isFinite(tentativeNorm) || (initialNorm > tolerance && tentativeNorm <= tolerance))
			return 'impact-termination-certification-failed: elastic energy renormalisation was undefined.';
		const factor = tentativeNorm > tolerance ? initialNorm / tentativeNorm : 1;
		const next = tentativeVelocity.map((value) => value * factor);
		const beforeViolation = maximumViolation(projected, velocity);
		const afterViolation = maximumViolation(projected, next);
		const energyBefore = kineticEnergy(velocity, problem.masses);
		const energyAfterTentative = kineticEnergy(tentativeVelocity, problem.masses);
		const energyAfter = kineticEnergy(next, problem.masses);
		const modification = weightedNorm(
			next.map((value, index) => value - velocity[index]!),
			problem.masses
		);
		const checks = {
			norm: true,
			kin: Math.abs(energyAfter - energyBefore) <= tolerance * Math.max(1, energyBefore) * 64,
			one: solution.values.every((value) => value >= -tolerance),
			vio: violating.every(({ gradient }) => dot(gradient, velocity) < -threshold),
			mod: modification > tolerance
		};
		reflections.push({
			iteration,
			violatingContactIds: violating.map(({ index }) => input.contacts[index]!.id),
			impulse: solution.values,
			energyBefore,
			energyAfterTentative,
			energyAfterRenormalisation: energyAfter,
			energyRenormalisationFactor: factor,
			maximumSignificantViolationBefore: beforeViolation,
			maximumSignificantViolationAfter: afterViolation,
			checks
		});
		if (!Object.values(checks).every(Boolean))
			return 'impact-termination-certification-failed: a reflection invariant failed.';
		velocity = next;
	}
	return 'impact-termination-certification-failed: defensive reflection cap reached.';
}

function validate(input: CoupledImpactInput): string | null {
	if (input.bodies.length === 0 || input.contacts.length === 0) return 'A coupled impact requires bodies and contacts.';
	if (input.contacts.length > 16) return 'The coupled impact exceeds the supported contact resource boundary.';
	if (input.restitution < 0 || input.restitution > 1 || !Number.isFinite(input.restitution))
		return 'Restitution must lie in [0, 1].';
	if (input.tolerances.maximumReflections <= 0) return 'The reflection resource cap must be positive.';
	const ids = new Set(input.bodies.map(({ id }) => id));
	if (ids.size !== input.bodies.length) return 'Coupled-impact body IDs must be unique.';
	for (const body of input.bodies) {
		if (!(body.mass > 0) || !Number.isFinite(body.mass) || !body.velocity.every(Number.isFinite))
			return `Body ${body.id} has invalid mass or velocity.`;
	}
	for (const contact of input.contacts) {
		const bodyIds = contact.type === 'body-body' ? [contact.firstBodyId, contact.secondBodyId] : [contact.bodyId];
		if (bodyIds.some((id) => !ids.has(id))) return `Contact ${contact.id} references an unknown body.`;
		const normal = contact.type === 'body-body' ? contact.normalFromFirstToSecond : contact.normal;
		if (!normal.every(Number.isFinite) || Math.abs(Math.hypot(...normal) - 1) > effectiveTolerance(input) * 16)
			return `Contact ${contact.id} has a non-unit normal.`;
	}
	return null;
}

function prepare(input: CoupledImpactInput): PreparedProblem {
	const bodyIndex = new Map(input.bodies.map((body, index) => [body.id, index]));
	const masses = input.bodies.flatMap(({ mass }) => [mass, mass]);
	const inverseMasses = masses.map((mass) => 1 / mass);
	const velocity = input.bodies.flatMap(({ velocity: [x, y] }) => [x, y]);
	const gradients = input.contacts.map((contact) => contactGradient(contact, bodyIndex, masses.length));
	return {
		bodyIndex,
		masses,
		inverseMasses,
		velocity,
		momentum: velocity.map((value, index) => masses[index]! * value),
		gradients
	};
}

function contactGradient(
	contact: CoupledImpactContact,
	bodyIndex: ReadonlyMap<string, number>,
	size: number
): number[] {
	const result = Array.from({ length: size }, () => 0);
	if (contact.type === 'body-fixed') {
		const offset = bodyIndex.get(contact.bodyId)! * 2;
		result[offset] = contact.normal[0];
		result[offset + 1] = contact.normal[1];
		return result;
	}
	const first = bodyIndex.get(contact.firstBodyId)! * 2;
	const second = bodyIndex.get(contact.secondBodyId)! * 2;
	result[first] = -contact.normalFromFirstToSecond[0];
	result[first + 1] = -contact.normalFromFirstToSecond[1];
	result[second] = contact.normalFromFirstToSecond[0];
	result[second + 1] = contact.normalFromFirstToSecond[1];
	return result;
}

function normalVelocities(
	gradients: readonly (readonly number[])[],
	velocity: readonly number[]
): number[] {
	return gradients.map((gradient) => dot(gradient, velocity));
}

function maximumViolation(
	projected: readonly { readonly gradient: readonly number[] }[],
	velocity: readonly number[]
): number {
	return Math.max(0, ...projected.map(({ gradient }) => -dot(gradient, velocity)));
}

function kineticEnergy(velocity: readonly number[], masses: readonly number[]): number {
	return 0.5 * velocity.reduce((sum, value, index) => sum + masses[index]! * value * value, 0);
}

function effectiveTolerance(input: CoupledImpactInput): number {
	return Math.max(input.tolerances.numerical, Number.EPSILON * 256);
}

function completeDiagnostic(
	input: CoupledImpactInput,
	problem: PreparedProblem,
	inelastic: readonly number[],
	elastic: ElasticEndpoint,
	finalVelocity: readonly number[]
): CoupledImpactDiagnostic {
	return {
		bodyIds: input.bodies.map(({ id }) => id),
		contactIds: input.contacts.map(({ id }) => id),
		masses: problem.masses,
		preImpactVelocity: problem.velocity,
		preImpactMomentum: problem.momentum,
		contactGradients: problem.gradients,
		linealityDimension: elastic.equalityBasis.length,
		linealityContactIds: elastic.linealityIndices.map((index) => input.contacts[index]!.id),
		equalityBasis: elastic.equalityBasis,
		projectedVelocity: elastic.projectedVelocity,
		projectedContactGradients: elastic.projectedGradients,
		removedContactIds: elastic.removedIndices.map((index) => input.contacts[index]!.id),
		violationThreshold: elastic.threshold,
		relativeViolationEpsilon: input.tolerances.relativeViolationEpsilon,
		absoluteNormalVelocityFloor: input.tolerances.absoluteNormalVelocityFloor,
		reflections: elastic.reflections,
		inelasticVelocity: inelastic,
		elasticVelocity: elastic.velocity,
		finalVelocity,
		restitution: input.restitution,
		completion: 'complete',
		failureReason: null
	};
}

function failureDiagnostic(
	input: CoupledImpactInput,
	problem: PreparedProblem,
	inelastic: readonly number[],
	reason: string
): CoupledImpactDiagnostic {
	return {
		bodyIds: input.bodies.map(({ id }) => id),
		contactIds: input.contacts.map(({ id }) => id),
		masses: problem.masses,
		preImpactVelocity: problem.velocity,
		preImpactMomentum: problem.momentum,
		contactGradients: problem.gradients,
		linealityDimension: 0,
		linealityContactIds: [],
		equalityBasis: [],
		projectedVelocity: problem.velocity,
		projectedContactGradients: [],
		removedContactIds: [],
		violationThreshold: 0,
		relativeViolationEpsilon: input.tolerances.relativeViolationEpsilon,
		absoluteNormalVelocityFloor: input.tolerances.absoluteNormalVelocityFloor,
		reflections: [],
		inelasticVelocity: inelastic,
		elasticVelocity: problem.velocity,
		finalVelocity: problem.velocity,
		restitution: input.restitution,
		completion: 'impact-termination-certification-failed',
		failureReason: reason
	};
}

function normalize(value: number, tolerance: number): number {
	return Math.abs(value) <= tolerance ? 0 : value;
}
