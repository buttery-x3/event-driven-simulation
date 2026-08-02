import type { ContactManifoldMember, Vec2 } from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { dotVec2 } from '../../../math';
import type { ImpactManifoldSolution } from './types';

interface Constraint {
	readonly candidate: FixedWorldContactCandidate;
	readonly incoming: number;
	readonly target: number;
}

interface VelocitySolution {
	readonly delta: Vec2;
	readonly impulses: readonly number[];
}

export function solveImpactManifold(
	candidates: readonly FixedWorldContactCandidate[],
	incomingVelocity: Vec2,
	restitution: number,
	tolerance: number
): ImpactManifoldSolution | null {
	if (candidates.length === 0 || !incomingVelocity.every(Number.isFinite)) return null;
	const constraints = candidates.map((candidate) => {
		const incoming = dotVec2(incomingVelocity, candidate.normal);
		return { candidate, incoming, target: incoming < -tolerance ? -restitution * incoming : 0 };
	});
	const solution = chooseSolution(constraints, incomingVelocity, tolerance);
	if (!solution) return null;
	const outgoingVelocity: Vec2 = [
		incomingVelocity[0] + solution.delta[0],
		incomingVelocity[1] + solution.delta[1]
	];
	if (!outgoingVelocity.every(Number.isFinite)) return null;
	const contacts = constraints.map((constraint, index): ContactManifoldMember => ({
		colliderId: constraint.candidate.colliderId,
		feature: constraint.candidate.feature,
		contactPoint: constraint.candidate.contactPoint,
		normal: constraint.candidate.normal,
		preImpactNormalVelocity: normalize(constraint.incoming, tolerance),
		postImpactNormalVelocity: normalize(
			dotVec2(outgoingVelocity, constraint.candidate.normal),
			tolerance
		),
		impulse: normalize(solution.impulses[index] ?? 0, tolerance)
	}));
	return {
		outgoingVelocity: normalizeVector(outgoingVelocity, tolerance),
		contacts,
		activeCandidates: candidates.filter((_, index) => (solution.impulses[index] ?? 0) > tolerance)
	};
}

function chooseSolution(
	constraints: readonly Constraint[],
	velocity: Vec2,
	tolerance: number
): VelocitySolution | null {
	const candidates: VelocitySolution[] = [];
	if (satisfiesAll([0, 0], constraints, velocity, tolerance)) {
		candidates.push({ delta: [0, 0], impulses: constraints.map(() => 0) });
	}
	for (let first = 0; first < constraints.length; first += 1) {
		const one = solveOne(constraints, velocity, first);
		if (one && valid(one, constraints, velocity, tolerance)) candidates.push(one);
		for (let second = first + 1; second < constraints.length; second += 1) {
			const two = solveTwo(constraints, velocity, first, second, tolerance);
			if (two && valid(two, constraints, velocity, tolerance)) candidates.push(two);
		}
	}
	return (
		candidates.sort(
			(left, right) => dotVec2(left.delta, left.delta) - dotVec2(right.delta, right.delta)
		)[0] ?? null
	);
}

function solveOne(
	constraints: readonly Constraint[],
	velocity: Vec2,
	index: number
): VelocitySolution | null {
	const constraint = constraints[index]!;
	const impulse = constraint.target - dotVec2(velocity, constraint.candidate.normal);
	if (!Number.isFinite(impulse)) return null;
	const impulses = constraints.map(() => 0);
	impulses[index] = impulse;
	return {
		delta: [impulse * constraint.candidate.normal[0], impulse * constraint.candidate.normal[1]],
		impulses
	};
}

function solveTwo(
	constraints: readonly Constraint[],
	velocity: Vec2,
	first: number,
	second: number,
	tolerance: number
): VelocitySolution | null {
	const left = constraints[first]!;
	const right = constraints[second]!;
	const coupling = dotVec2(left.candidate.normal, right.candidate.normal);
	const determinant = 1 - coupling * coupling;
	if (Math.abs(determinant) <= tolerance) return null;
	const leftRequired = left.target - dotVec2(velocity, left.candidate.normal);
	const rightRequired = right.target - dotVec2(velocity, right.candidate.normal);
	const leftImpulse = (leftRequired - coupling * rightRequired) / determinant;
	const rightImpulse = (rightRequired - coupling * leftRequired) / determinant;
	const impulses = constraints.map(() => 0);
	impulses[first] = leftImpulse;
	impulses[second] = rightImpulse;
	return {
		delta: [
			leftImpulse * left.candidate.normal[0] + rightImpulse * right.candidate.normal[0],
			leftImpulse * left.candidate.normal[1] + rightImpulse * right.candidate.normal[1]
		],
		impulses
	};
}

function valid(
	solution: VelocitySolution,
	constraints: readonly Constraint[],
	velocity: Vec2,
	tolerance: number
): boolean {
	return (
		solution.impulses.every((impulse) => impulse >= -tolerance && Number.isFinite(impulse)) &&
		satisfiesAll(solution.delta, constraints, velocity, tolerance)
	);
}

function satisfiesAll(
	delta: Vec2,
	constraints: readonly Constraint[],
	velocity: Vec2,
	tolerance: number
): boolean {
	const outgoing: Vec2 = [velocity[0] + delta[0], velocity[1] + delta[1]];
	return constraints.every(
		(constraint) => dotVec2(outgoing, constraint.candidate.normal) >= constraint.target - tolerance
	);
}

function normalize(value: number, tolerance: number): number {
	return Math.abs(value) <= tolerance ? 0 : value;
}

function normalizeVector(vector: Vec2, tolerance: number): Vec2 {
	return [normalize(vector[0], tolerance), normalize(vector[1], tolerance)];
}
