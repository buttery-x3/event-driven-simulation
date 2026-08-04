import type { ImpactSolveDiagnostic } from '../../contracts';
import { reportRunValidationFailure, type RunValidationContext } from '../results';
import { stateTolerance } from '../history';

export function validateCoupledImpacts(context: RunValidationContext): void {
	for (const [index, solve] of (context.run.diagnostics.impactSolves ?? []).entries()) {
		if (solve.completion !== 'complete') continue;
		const path = `$.diagnostics.impactSolves[${index}]`;
		validateFeasibility(context, solve, path);
		validateEnergy(context, solve, path);
		validateProjection(context, solve, path);
		validateReflections(context, solve, path);
		validateMomentumBalance(context, solve, path);
	}
}

function validateFeasibility(
	context: RunValidationContext,
	solve: ImpactSolveDiagnostic,
	path: string
): void {
	const tolerance = stateTolerance(context) * 64;
	const component = context.run.contactComponents.find(({ id }) => id === solve.componentId);
	const contacts = component
		? context.run.dynamicContacts.filter(({ id }) => component.activeContactIds.includes(id))
		: [];
	if (
		!component ||
		contacts.length !== solve.contactIds.length ||
		contacts.some(
			(contact) =>
				contact.impulse === null ||
				contact.impulse < -tolerance ||
				contact.postImpactNormalVelocity === null ||
				contact.postImpactNormalVelocity < -tolerance
		)
	) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'A completed coupled impact must expose non-negative impulses and feasible final contact velocities.',
			path
		);
	}
	const calculated = solve.contactGradients.map((gradient) => dot(gradient, solve.finalVelocity));
	if (
		calculated.some((value) => value < -tolerance) ||
		contacts.some((contact) => {
			const contactIndex = solve.contactIds.indexOf(contact.id);
			return (
				contactIndex < 0 ||
				Math.abs(calculated[contactIndex]! - contact.postImpactNormalVelocity!) > tolerance
			);
		})
	) {
		fail(
			context,
			'PENETRATING_POST_IMPACT_VELOCITY',
			'The reported generalized final velocity must satisfy every complete active contact.',
			path
		);
	}
}

function validateEnergy(
	context: RunValidationContext,
	solve: ImpactSolveDiagnostic,
	path: string
): void {
	const before = kineticEnergy(solve.preImpactVelocity, solve.masses);
	const projected = kineticEnergy(solve.projectedVelocity, solve.masses);
	const elastic = kineticEnergy(solve.elasticVelocity, solve.masses);
	const inelastic = kineticEnergy(solve.inelasticVelocity, solve.masses);
	const final = kineticEnergy(solve.finalVelocity, solve.masses);
	const tolerance = stateTolerance(context) * Math.max(1, before) * 128;
	if (
		Math.abs(elastic - projected) > tolerance ||
		inelastic > final + tolerance ||
		final > before + tolerance
	) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'Elastic energy and energetic-restitution bounds must agree with the reported endpoints.',
			path
		);
	}
}

function validateProjection(
	context: RunValidationContext,
	solve: ImpactSolveDiagnostic,
	path: string
): void {
	const tolerance = stateTolerance(context) * 128;
	const projectedVelocityValid = solve.equalityBasis.every(
		(direction) => Math.abs(dot(direction, solve.projectedVelocity)) <= tolerance
	);
	const projectedGradientsValid = solve.projectedContactGradients.every((gradient) =>
		solve.equalityBasis.every((direction) => Math.abs(dot(direction, gradient)) <= tolerance)
	);
	if (!projectedVelocityValid || !projectedGradientsValid) {
		fail(
			context,
			'CONTACT_SET_MISMATCH',
			'Anti-locking output must remain in the reported equality-compatible subspace.',
			path
		);
	}
}

function validateReflections(
	context: RunValidationContext,
	solve: ImpactSolveDiagnostic,
	path: string
): void {
	const tolerance = stateTolerance(context) * 128;
	const modificationFloor = Math.max(
		solve.absoluteNormalVelocityFloor,
		Number.EPSILON * Math.max(1, ...solve.preImpactVelocity.map(Math.abs)) * 512
	);
	for (const reflection of solve.reflections) {
		const expectedViolations = solve.projectedContactIds.filter(
			(_, index) =>
				dot(solve.projectedContactGradients[index]!, reflection.velocityBefore) <
				-solve.violationThreshold
		);
		const modification = Math.sqrt(
			reflection.velocityAfter.reduce((sum, value, index) => {
				const delta = value - reflection.velocityBefore[index]!;
				return sum + solve.masses[index]! * delta * delta;
			}, 0)
		);
		if (
			!Object.values(reflection.checks).every(Boolean) ||
			reflection.impulse.length !== reflection.violatingContactIds.length ||
			!sameMembers(expectedViolations, reflection.violatingContactIds) ||
			modification <= modificationFloor ||
			reflection.impulse.some((value) => value < -tolerance) ||
			Math.abs(reflection.energyAfterRenormalisation - reflection.energyBefore) >
				tolerance * Math.max(1, reflection.energyBefore)
		) {
			fail(
				context,
				'IMPACT_EVIDENCE_MISMATCH',
				'Every recorded reflection must satisfy NORM, KIN, ONE, VIO and MOD.',
				`${path}.reflections[${reflection.iteration}]`
			);
		}
	}
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value) => right.includes(value));
}

function validateMomentumBalance(
	context: RunValidationContext,
	solve: ImpactSolveDiagnostic,
	path: string
): void {
	const component = context.run.contactComponents.find(({ id }) => id === solve.componentId);
	if (!component) return;
	const momentumChange = [0, 0];
	for (let bodyIndex = 0; bodyIndex < solve.bodyIds.length; bodyIndex += 1) {
		const mass = solve.masses[bodyIndex * 2]!;
		momentumChange[0] +=
			mass * (solve.finalVelocity[bodyIndex * 2]! - solve.preImpactVelocity[bodyIndex * 2]!);
		momentumChange[1] +=
			mass *
			(solve.finalVelocity[bodyIndex * 2 + 1]! - solve.preImpactVelocity[bodyIndex * 2 + 1]!);
	}
	const fixedImpulse = [0, 0];
	for (const contact of context.run.dynamicContacts.filter(({ id }) =>
		component.activeContactIds.includes(id)
	)) {
		if (!contact.participants.some(({ type }) => type === 'fixed-collider')) continue;
		fixedImpulse[0] += contact.impulseOnSecond?.[0] ?? 0;
		fixedImpulse[1] += contact.impulseOnSecond?.[1] ?? 0;
	}
	const tolerance = stateTolerance(context) * Math.max(1, ...momentumChange.map(Math.abs)) * 128;
	if (
		Math.abs(momentumChange[0] - fixedImpulse[0]) > tolerance ||
		Math.abs(momentumChange[1] - fixedImpulse[1]) > tolerance
	) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'Component momentum change must equal its recorded fixed-world impulse.',
			path
		);
	}
}

function kineticEnergy(velocity: readonly number[], masses: readonly number[]): number {
	return 0.5 * velocity.reduce((sum, value, index) => sum + masses[index]! * value * value, 0);
}

function dot(left: readonly number[], right: readonly number[]): number {
	return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

function fail(
	context: RunValidationContext,
	code: 'CONTACT_SET_MISMATCH' | 'IMPACT_EVIDENCE_MISMATCH' | 'PENETRATING_POST_IMPACT_VELOCITY',
	message: string,
	path: string
): void {
	reportRunValidationFailure(context, 'impact-manifold', code, message, { path });
}
