import type { ConstrainedImpactSolveDiagnostic, DynamicContactRecord } from '../../../contracts';
import { stateTolerance } from '../../history';
import { reportRunValidationFailure, type RunValidationContext } from '../../results';

export function validateConstrainedImpacts(context: RunValidationContext): void {
	for (const [index, solve] of (context.run.diagnostics.constrainedImpactSolves ?? []).entries()) {
		validateConstrainedImpact(context, solve, `$.diagnostics.constrainedImpactSolves[${index}]`);
	}
}

function validateConstrainedImpact(
	context: RunValidationContext,
	solve: ConstrainedImpactSolveDiagnostic,
	path: string
): void {
	const component = context.run.contactComponents.find(({ id }) => id === solve.componentId);
	if (!component) return;
	const contactById = new Map(
		context.run.dynamicContacts
			.filter(({ id }) => component.activeContactIds.includes(id))
			.map((contact) => [contact.id, contact])
	);
	const bodyIndex = new Map(solve.bodyIds.map((bodyId, index) => [bodyId, index]));
	const tolerance = stateTolerance(context);
	const velocityScale = Math.max(
		1,
		...solve.preImpactVelocity.map(Math.abs),
		...solve.finalVelocity.map(Math.abs)
	);
	const kinematicTolerance = tolerance * velocityScale * 128;
	const gradients = new Map<string, readonly number[]>();
	let maximumPreSupportViolation = 0;
	let maximumPostSupportViolation = 0;
	let maximumPostImpactViolation = 0;
	let impactSpeed = 0;
	for (const contact of solve.contacts) {
		const record = contactById.get(contact.contactId);
		if (
			!record ||
			record.participants.some(
				(participant) => participant.type === 'body' && !bodyIndex.has(participant.bodyId)
			)
		) {
			fail(
				context,
				'CONTACT_SET_MISMATCH',
				'Constrained-response contacts must belong to the declared impact component.',
				path
			);
			continue;
		}
		const gradient = contactGradient(record, bodyIndex, solve.preImpactVelocity.length);
		gradients.set(contact.contactId, gradient);
		validateRecordedVelocities(context, solve, record, bodyIndex, kinematicTolerance, path);
		const pre = dot(gradient, solve.preImpactVelocity);
		const post = dot(gradient, solve.finalVelocity);
		if (
			Math.abs(pre - contact.preImpactNormalVelocity) > kinematicTolerance ||
			Math.abs(post - contact.postImpactNormalVelocity) > kinematicTolerance ||
			Math.abs((record.preImpactNormalVelocity ?? pre) - pre) > kinematicTolerance ||
			Math.abs((record.postImpactNormalVelocity ?? post) - post) > kinematicTolerance
		) {
			fail(
				context,
				'IMPACT_EVIDENCE_MISMATCH',
				'Constrained-response contact kinematics must agree with the recorded physical velocities.',
				path
			);
		}
		if (contact.role === 'support-constraint') {
			maximumPreSupportViolation = Math.max(maximumPreSupportViolation, Math.abs(pre));
			maximumPostSupportViolation = Math.max(maximumPostSupportViolation, Math.abs(post));
			if (Math.abs(pre) > kinematicTolerance || Math.abs(post) > kinematicTolerance) {
				fail(
					context,
					'CONTACT_SET_MISMATCH',
					'Authoritative constrained-response supports must remain bilateral velocity equalities.',
					path
				);
			}
		} else {
			maximumPostImpactViolation = Math.max(maximumPostImpactViolation, -post, 0);
			if (isBodyBody(record)) impactSpeed = Math.max(impactSpeed, -pre, 0);
			if (post < -kinematicTolerance) {
				fail(
					context,
					'PENETRATING_POST_IMPACT_VELOCITY',
					'Every unilateral constrained-response impact must be feasible after response.',
					path
				);
			}
		}
	}
	validateImpulseEvidence(context, solve, contactById, kinematicTolerance, path);
	validateLocks(context, solve, bodyIndex, kinematicTolerance, path);
	validateEnergy(context, solve, tolerance, path);
	const residualNorm = momentumResidual(solve, gradients, bodyIndex);
	const momentumScale = Math.max(
		1,
		...solve.masses.map((mass, index) =>
			Math.abs(mass * (solve.finalVelocity[index]! - solve.preImpactVelocity[index]!))
		)
	);
	if (residualNorm > tolerance * momentumScale * 512) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'Impact impulses plus signed support and lock reactions must reconstruct momentum.',
			path
		);
	}
	const certification = solve.certification;
	const evidenceTolerance = tolerance * Math.max(1, impactSpeed, velocityScale) * 256;
	if (
		Math.abs(certification.impactSpeed - impactSpeed) > evidenceTolerance ||
		Math.abs(certification.maximumPreSupportViolation - maximumPreSupportViolation) >
			evidenceTolerance ||
		Math.abs(certification.maximumPostSupportViolation - maximumPostSupportViolation) >
			evidenceTolerance ||
		Math.abs(certification.maximumPostImpactViolation - maximumPostImpactViolation) >
			evidenceTolerance ||
		Math.abs(certification.momentumResidualNorm - residualNorm) > tolerance * momentumScale * 512 ||
		certification.incomingProjectionCorrectionNorm < 0 ||
		certification.incomingProjectionCorrectionNorm > tolerance * velocityScale * 128 ||
		certification.reflectionCount < 0
	) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'Constrained-response certification must agree with its physical evidence.',
			path
		);
	}
}

function validateRecordedVelocities(
	context: RunValidationContext,
	solve: ConstrainedImpactSolveDiagnostic,
	contact: DynamicContactRecord,
	bodyIndex: ReadonlyMap<string, number>,
	tolerance: number,
	path: string
): void {
	if (!contact.preImpactVelocities || !contact.postImpactVelocities) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'Constrained-response contacts must retain complete pre/post velocity evidence.',
			path
		);
		return;
	}
	for (const [participantIndex, participant] of contact.participants.entries()) {
		const bodyOffset = participant.type === 'body' ? bodyIndex.get(participant.bodyId)! * 2 : null;
		const expectedPre =
			bodyOffset === null
				? ([0, 0] as const)
				: ([
						solve.preImpactVelocity[bodyOffset]!,
						solve.preImpactVelocity[bodyOffset + 1]!
					] as const);
		const expectedPost =
			bodyOffset === null
				? ([0, 0] as const)
				: ([solve.finalVelocity[bodyOffset]!, solve.finalVelocity[bodyOffset + 1]!] as const);
		const recordedPre = contact.preImpactVelocities[participantIndex]!;
		const recordedPost = contact.postImpactVelocities[participantIndex]!;
		if (
			Math.hypot(recordedPre[0] - expectedPre[0], recordedPre[1] - expectedPre[1]) > tolerance ||
			Math.hypot(recordedPost[0] - expectedPost[0], recordedPost[1] - expectedPost[1]) > tolerance
		) {
			fail(
				context,
				'IMPACT_EVIDENCE_MISMATCH',
				'Constrained-response pre/post velocities must agree with contact history.',
				path
			);
		}
	}
}

function validateImpulseEvidence(
	context: RunValidationContext,
	solve: ConstrainedImpactSolveDiagnostic,
	contactById: ReadonlyMap<string, DynamicContactRecord>,
	tolerance: number,
	path: string
): void {
	for (const impact of solve.impactImpulses) {
		const recorded = contactById.get(impact.contactId)?.impulse;
		if (impact.impulse < -tolerance || recorded === null || recorded === undefined) {
			fail(
				context,
				'NEGATIVE_IMPULSE',
				'Constrained-response impact impulses must remain ordinary non-negative impulses.',
				path
			);
		} else if (Math.abs(recorded - impact.impulse) > tolerance) {
			fail(
				context,
				'IMPACT_EVIDENCE_MISMATCH',
				'Constrained-response impact impulses must agree with contact history.',
				path
			);
		}
	}
	for (const support of solve.supportReactions) {
		const recorded = contactById.get(support.contactId)?.impulse;
		if (recorded === null || recorded === undefined || Math.abs(recorded) > tolerance) {
			fail(
				context,
				'IMPACT_EVIDENCE_MISMATCH',
				'Bilateral support reactions must be separate from ordinary contact impulses.',
				path
			);
		}
	}
}

function validateLocks(
	context: RunValidationContext,
	solve: ConstrainedImpactSolveDiagnostic,
	bodyIndex: ReadonlyMap<string, number>,
	tolerance: number,
	path: string
): void {
	for (const lock of solve.lockReactions) {
		const bodyOffset = bodyIndex.get(lock.bodyId);
		if (bodyOffset === undefined) {
			fail(
				context,
				'CONTACT_SET_MISMATCH',
				'Anchored fallback may lock only declared impact-component bodies.',
				path
			);
			continue;
		}
		const index = bodyOffset * 2 + (lock.axis === 'x' ? 0 : 1);
		if (
			Math.abs(solve.preImpactVelocity[index]!) > tolerance ||
			Math.abs(solve.finalVelocity[index]!) > tolerance
		) {
			fail(
				context,
				'CONTACT_SET_MISMATCH',
				'Anchored fallback must preserve every declared locked coordinate.',
				path
			);
		}
	}
}

function validateEnergy(
	context: RunValidationContext,
	solve: ConstrainedImpactSolveDiagnostic,
	tolerance: number,
	path: string
): void {
	const before = kineticEnergy(solve.preImpactVelocity, solve.masses);
	const after = kineticEnergy(solve.finalVelocity, solve.masses);
	const error = Math.abs(after - before);
	const scale = Math.max(1, before);
	if (
		error > tolerance * scale * 256 ||
		Math.abs(solve.certification.kineticEnergyBefore - before) > tolerance * scale * 256 ||
		Math.abs(solve.certification.kineticEnergyAfter - after) > tolerance * scale * 256 ||
		Math.abs(solve.certification.energyError - error) > tolerance * scale * 256
	) {
		fail(
			context,
			'IMPACT_EVIDENCE_MISMATCH',
			'The constrained elastic response must preserve and accurately report kinetic energy.',
			path
		);
	}
}

function momentumResidual(
	solve: ConstrainedImpactSolveDiagnostic,
	gradients: ReadonlyMap<string, readonly number[]>,
	bodyIndex: ReadonlyMap<string, number>
): number {
	const target = solve.finalVelocity.map(
		(value, index) => solve.masses[index]! * (value - solve.preImpactVelocity[index]!)
	);
	const reconstructed = Array.from({ length: target.length }, () => 0);
	for (const impulse of solve.impactImpulses) {
		const gradient = gradients.get(impulse.contactId);
		if (!gradient) return Number.POSITIVE_INFINITY;
		addScaled(reconstructed, gradient, impulse.impulse);
	}
	for (const reaction of solve.supportReactions) {
		const gradient = gradients.get(reaction.contactId);
		if (!gradient) return Number.POSITIVE_INFINITY;
		addScaled(reconstructed, gradient, reaction.multiplier);
	}
	for (const reaction of solve.lockReactions) {
		const bodyOffset = bodyIndex.get(reaction.bodyId);
		if (bodyOffset === undefined) return Number.POSITIVE_INFINITY;
		const index = bodyOffset * 2 + (reaction.axis === 'x' ? 0 : 1);
		reconstructed[index] += reaction.multiplier;
	}
	return Math.hypot(...target.map((value, index) => value - reconstructed[index]!));
}

function contactGradient(
	contact: DynamicContactRecord,
	bodyIndex: ReadonlyMap<string, number>,
	size: number
): readonly number[] {
	const gradient = Array.from({ length: size }, () => 0);
	const [first, second] = contact.participants;
	if (first.type === 'body') {
		const offset = bodyIndex.get(first.bodyId)! * 2;
		gradient[offset] = -contact.normalFromFirstToSecond[0];
		gradient[offset + 1] = -contact.normalFromFirstToSecond[1];
	}
	if (second.type === 'body') {
		const offset = bodyIndex.get(second.bodyId)! * 2;
		gradient[offset] = contact.normalFromFirstToSecond[0];
		gradient[offset + 1] = contact.normalFromFirstToSecond[1];
	}
	return gradient;
}

function isBodyBody(contact: DynamicContactRecord): boolean {
	return contact.participants.every(({ type }) => type === 'body');
}

function addScaled(target: number[], direction: readonly number[], scale: number): void {
	for (let index = 0; index < target.length; index += 1) {
		target[index] += direction[index]! * scale;
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
	code:
		| 'CONTACT_SET_MISMATCH'
		| 'IMPACT_EVIDENCE_MISMATCH'
		| 'NEGATIVE_IMPULSE'
		| 'PENETRATING_POST_IMPACT_VELOCITY',
	message: string,
	path: string
): void {
	reportRunValidationFailure(context, 'impact-manifold', code, message, { path });
}
