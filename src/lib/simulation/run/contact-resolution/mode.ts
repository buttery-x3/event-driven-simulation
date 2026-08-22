import type { Vec2 } from '../../contracts';
import { solveNonnegativeQuadratic } from '../dynamic-impact';
import type {
	ExactContact,
	ExactContactBodyState,
	PostContactMode,
	ResolvedContactState,
	SupportReactionSolution
} from './types';

export const REPRESENTED_MOTION_SPEED = 0.01;

export interface SupportedMotionEvidence {
	readonly velocities?: readonly Vec2[];
	readonly velocityComponents?: readonly number[];
	readonly constrainedAccelerations?: readonly Vec2[];
	readonly constrainedAccelerationComponents?: readonly number[];
	readonly tolerance: number;
}

export type SupportedMotionClassification = 'moving' | 'resting-qualified';

interface RestingModeRequest {
	readonly bodyIds: readonly string[];
	readonly lockedBodyIds?: readonly string[];
	readonly motion: SupportedMotionEvidence;
	readonly support: () => SupportReactionSolution | null;
}

export interface PostContactModeRequest {
	readonly contacts: ResolvedContactState;
	readonly resting?: RestingModeRequest | null;
	readonly dynamicSupport?: {
		readonly contactId: string;
		readonly movingBodyId: string;
		readonly supportBodyId: string;
		readonly motion?: SupportedMotionEvidence;
		readonly stationaryDetail?: string;
	} | null;
	readonly preferredFixedContactId?: string | null;
	readonly unsupportedBodyContactId?: string | null;
	readonly unresolvedDetail?: string | null;
	readonly unresolvedWithoutRestingMode?: string | null;
}

export function classifySupportedMotion(
	evidence: SupportedMotionEvidence
): SupportedMotionClassification {
	if (evidence.velocities?.some((velocity) => Math.hypot(...velocity) > evidence.tolerance)) {
		return 'moving';
	}
	if (evidence.velocityComponents?.some((velocity) => Math.abs(velocity) > evidence.tolerance)) {
		return 'moving';
	}
	if (
		evidence.constrainedAccelerations?.some(
			(acceleration) => Math.hypot(...acceleration) > evidence.tolerance
		)
	) {
		return 'moving';
	}
	if (
		evidence.constrainedAccelerationComponents?.some(
			(acceleration) => Math.abs(acceleration) > evidence.tolerance
		)
	) {
		return 'moving';
	}
	return 'resting-qualified';
}

export function isRepresentedRestCandidate(velocities: readonly Vec2[]): boolean {
	return (
		velocities.length > 0 &&
		velocities.every((velocity) => Math.hypot(...velocity) <= REPRESENTED_MOTION_SPEED)
	);
}

export function isSubResolutionNormalMotion(
	preNormalVelocity: number,
	postNormalVelocity: number
): boolean {
	return (
		Math.abs(preNormalVelocity) <= REPRESENTED_MOTION_SPEED &&
		isSubResolutionPostNormalMotion(postNormalVelocity)
	);
}

export function isSubResolutionPostNormalMotion(postNormalVelocity: number): boolean {
	return Math.abs(postNormalVelocity) <= REPRESENTED_MOTION_SPEED;
}

export function admissibleConstrainedVelocities(
	bodies: readonly ExactContactBodyState[],
	contacts: readonly ExactContact[],
	velocities: readonly Vec2[],
	lockedBodyIds: ReadonlySet<string>,
	tolerance: number
): readonly Vec2[] {
	if (bodies.length !== velocities.length) return velocities;
	const residual = velocities.map((velocity, index) =>
		lockedBodyIds.has(bodies[index]!.id) ? ([0, 0] as const) : velocity
	);
	const freeBodies = bodies.filter(({ id }) => !lockedBodyIds.has(id));
	if (freeBodies.length === 0) return residual;
	const freeIndex = new Map(freeBodies.map((body, index) => [body.id, index]));
	const freeVelocity = bodies.flatMap((body, index) =>
		lockedBodyIds.has(body.id) ? [] : residual[index]!
	);
	const columns = contactGradientColumns(contacts, freeIndex, freeBodies.length);
	if (columns.length === 0) return residual;
	const hessian = columns.map((left) => columns.map((right) => dot(left, right)));
	const linear = columns.map((column) => dot(column, freeVelocity));
	const solution = solveNonnegativeQuadratic(hessian, linear, tolerance);
	if (!solution) return residual;
	const projected = [...freeVelocity];
	for (let contactIndex = 0; contactIndex < columns.length; contactIndex += 1) {
		const multiplier = solution.values[contactIndex]!;
		if (multiplier === 0) continue;
		const column = columns[contactIndex]!;
		for (let row = 0; row < projected.length; row += 1)
			projected[row]! += multiplier * column[row]!;
	}
	if (projected.some((value) => !Number.isFinite(value))) return residual;
	return bodies.map((body) => {
		if (lockedBodyIds.has(body.id)) return [0, 0] as const;
		const offset = freeIndex.get(body.id)! * 2;
		return [projected[offset]!, projected[offset + 1]!] as const;
	});
}

export function selectPostContactMode(request: PostContactModeRequest): PostContactMode {
	if (request.unresolvedDetail) {
		return { type: 'unresolved', detail: request.unresolvedDetail };
	}
	const retained = new Set(
		request.contacts.contacts
			.filter(({ disposition }) => disposition === 'retained')
			.map(({ contact }) => contact.id)
	);
	if (request.resting && admitsRepresentedRest(request)) {
		const support = request.resting.support();
		if (support) {
			return {
				type: 'resting-anchored',
				bodyIds: [...request.resting.bodyIds].sort(),
				support
			};
		}
	}
	if (request.unresolvedWithoutRestingMode) {
		return { type: 'unresolved', detail: request.unresolvedWithoutRestingMode };
	}
	if (request.dynamicSupport && retained.has(request.dynamicSupport.contactId)) {
		if (
			request.dynamicSupport.motion &&
			classifySupportedMotion(request.dynamicSupport.motion) === 'resting-qualified'
		) {
			return {
				type: 'unresolved',
				detail:
					request.dynamicSupport.stationaryDetail ??
					'Dynamic sustained support has no represented stationary continuation.'
			};
		}
		return {
			type: 'dynamic-sustained-support',
			contactId: request.dynamicSupport.contactId,
			movingBodyId: request.dynamicSupport.movingBodyId,
			supportBodyId: request.dynamicSupport.supportBodyId
		};
	}
	if (request.preferredFixedContactId && retained.has(request.preferredFixedContactId)) {
		return { type: 'fixed-sustained-contact', contactId: request.preferredFixedContactId };
	}
	if (request.unsupportedBodyContactId && retained.has(request.unsupportedBodyContactId)) {
		const contact = request.contacts.eventState.contacts.find(
			({ id }) => id === request.unsupportedBodyContactId
		);
		if (contact?.type === 'body-body') {
			return {
				type: 'unsupported',
				contactId: contact.id,
				bodyIds: [contact.firstBodyId, contact.secondBodyId]
			};
		}
	}
	return { type: 'free-flight' };
}

function admitsRepresentedRest(request: PostContactModeRequest): boolean {
	const resting = request.resting;
	if (!resting) return false;
	if (classifySupportedMotion(resting.motion) === 'resting-qualified') return true;
	if (resting.motion.velocities?.length !== resting.bodyIds.length) return false;
	const residual = admissibleConstrainedVelocities(
		request.contacts.eventState.bodies,
		request.contacts.eventState.contacts,
		restingVelocities(request),
		new Set(resting.lockedBodyIds ?? []),
		resting.motion.tolerance
	);
	const residualByBody = new Map(
		request.contacts.eventState.bodies.map((body, index) => [body.id, residual[index]!])
	);
	return isRepresentedRestCandidate(
		resting.bodyIds
			.map((bodyId) => residualByBody.get(bodyId))
			.filter((velocity) => velocity != null)
	);
}

function restingVelocities(request: PostContactModeRequest): readonly Vec2[] {
	const resting = request.resting!;
	const supplied = new Map(
		resting.bodyIds.map((bodyId, index) => [bodyId, resting.motion.velocities![index]!])
	);
	const lockedBodyIds = new Set(resting.lockedBodyIds ?? []);
	return request.contacts.eventState.bodies.map((body) => {
		const velocity = supplied.get(body.id);
		if (velocity !== undefined) return velocity;
		if (lockedBodyIds.has(body.id)) return [0, 0];
		return body.velocity;
	});
}

function contactGradientColumns(
	contacts: readonly ExactContact[],
	freeIndex: ReadonlyMap<string, number>,
	freeCount: number
): readonly (readonly number[])[] {
	const dimensions = freeCount * 2;
	return contacts.flatMap((contact) => {
		const column = Array.from({ length: dimensions }, () => 0);
		if (contact.type === 'body-fixed') {
			accumulateNormal(column, freeIndex, contact.bodyId, contact.normal, 1);
		} else {
			accumulateNormal(column, freeIndex, contact.firstBodyId, contact.normalFromFirstToSecond, -1);
			accumulateNormal(column, freeIndex, contact.secondBodyId, contact.normalFromFirstToSecond, 1);
		}
		return column.some((value) => value !== 0) ? [column] : [];
	});
}

function accumulateNormal(
	column: number[],
	freeIndex: ReadonlyMap<string, number>,
	bodyId: string,
	normal: Vec2,
	scale: number
): void {
	const index = freeIndex.get(bodyId);
	if (index === undefined) return;
	column[index * 2]! += scale * normal[0];
	column[index * 2 + 1]! += scale * normal[1];
}

function dot(left: readonly number[], right: readonly number[]): number {
	let result = 0;
	for (let index = 0; index < left.length; index += 1) result += left[index]! * right[index]!;
	return result;
}
