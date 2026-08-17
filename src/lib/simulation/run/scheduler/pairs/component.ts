import type {
	ImpactSolveDiagnostic,
	MotionSegment,
	StaticCollider,
	Vec2
} from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import {
	evaluateCircularContactState,
	evaluateMotionSegmentPosition,
	evaluateMotionSegmentVelocity
} from '../../../motion';
import {
	isRepresentedRestCandidate,
	type ExactContact,
	type ExactContactBodyState,
	type ExactTimeContactState
} from '../../contact-resolution';
import { predictionSegments, type LocalBodyRuntime } from '../../single-ball/local-events';
import type { SchedulerState } from '../types';
import { dynamicSupportPathForBody } from '../dynamic-support/prediction';
import type { PairSchedulerSelection } from './selection';

export interface PairComponentBodyState extends ExactContactBodyState {
	readonly prefixSegment: MotionSegment | null;
}

export interface ExactTimeComponent extends Omit<ExactTimeContactState, 'bodies'> {
	readonly bodies: readonly PairComponentBodyState[];
	readonly candidateEvidence: NonNullable<ImpactSolveDiagnostic['candidateEvidence']>;
	readonly selectionDiagnosticIds: readonly string[];
}

export function buildExactTimeComponent(
	state: SchedulerState,
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>
): ExactTimeComponent | null {
	const time = selection.time;
	const tolerance = Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256);
	const bodyStates = [...state.runtimes.values()]
		.map((runtime) => bodyStateAt(state, runtime, time))
		.filter((body): body is PairComponentBodyState => body !== null)
		.sort(bodyGeometryOrder);
	const dynamicCandidates = bodyPairCandidates(bodyStates, selection, time, tolerance);
	const connectedBodyIds = connectedBodies(selection, dynamicCandidates);
	const bodies = bodyStates.filter(({ id }) => connectedBodyIds.has(id));
	if (bodies.length < 2) return null;
	const dynamicContacts = dynamicCandidates
		.filter(
			({ contact }) =>
				contact !== null &&
				connectedBodyIds.has(contact.firstBodyId) &&
				connectedBodyIds.has(contact.secondBodyId)
		)
		.map(({ contact }) => contact!);
	const fixedCandidates = bodies.flatMap((body) =>
		state.input.scene.staticColliders.map((collider) =>
			fixedCandidate(body, collider, time, tolerance)
		)
	);
	const fixedContacts = fixedCandidates
		.filter(({ contact }) => contact !== null)
		.map(({ contact }) => contact!);
	const contacts = [...dynamicContacts, ...fixedContacts];
	const candidateEvidence = [
		...dynamicCandidates.map(({ evidence }) => evidence),
		...fixedCandidates.map(({ evidence }) => evidence)
	];
	return {
		id: `impact-component:${time}:${bodies
			.map(({ id }) => id)
			.sort()
			.join('+')}`,
		time,
		bodies,
		contacts,
		candidateEvidence,
		selectionDiagnosticIds: dynamicCandidates.flatMap(({ contact, selectionDiagnosticId }) =>
			contact &&
			selectionDiagnosticId &&
			connectedBodyIds.has(contact.firstBodyId) &&
			connectedBodyIds.has(contact.secondBodyId)
				? [selectionDiagnosticId]
				: []
		)
	};
}

export function buildStationaryContactComponents(
	state: SchedulerState,
	time: number
): readonly ExactTimeComponent[] {
	const tolerance = Math.max(state.input.settings.tolerances.contactDistance, Number.EPSILON * 256);
	const bodies = [...state.runtimes.values()]
		.filter((runtime) => runtime.dormantComponentId === null)
		.map((runtime) => bodyStateAt(state, runtime, time))
		.filter((body): body is PairComponentBodyState => {
			if (body === null) return false;
			return isRepresentedRestCandidate([body.velocity]);
		})
		.sort(bodyGeometryOrder);
	if (bodies.length === 0) return [];
	const dynamicCandidates = bodyPairCandidates(bodies, null, time, tolerance);
	const dynamicContacts = dynamicCandidates.flatMap(({ contact }) => (contact ? [contact] : []));
	const groups: Set<string>[] = [];
	const remaining = new Set(bodies.map(({ id }) => id));
	while (remaining.size > 0) {
		const seed = [...remaining].sort()[0]!;
		const group = new Set([seed]);
		remaining.delete(seed);
		let changed = true;
		while (changed) {
			changed = false;
			for (const contact of dynamicContacts) {
				if (!group.has(contact.firstBodyId) && !group.has(contact.secondBodyId)) continue;
				for (const id of [contact.firstBodyId, contact.secondBodyId]) {
					if (!remaining.delete(id)) continue;
					group.add(id);
					changed = true;
				}
			}
		}
		groups.push(group);
	}
	return groups.map((bodyIds, index) => {
		const members = bodies.filter(({ id }) => bodyIds.has(id));
		const bodyContacts = dynamicContacts.filter(
			(contact) => bodyIds.has(contact.firstBodyId) && bodyIds.has(contact.secondBodyId)
		);
		const fixedCandidates = members.flatMap((body) =>
			state.input.scene.staticColliders.map((collider) =>
				fixedCandidate(body, collider, time, tolerance)
			)
		);
		return {
			id: `stationary-candidate:${time}:${index}:${[...bodyIds].sort().join('+')}`,
			time,
			bodies: members,
			contacts: [
				...bodyContacts,
				...fixedCandidates.flatMap(({ contact }) => (contact ? [contact] : []))
			],
			candidateEvidence: [
				...dynamicCandidates
					.filter(({ contact }) =>
						contact ? bodyIds.has(contact.firstBodyId) && bodyIds.has(contact.secondBodyId) : false
					)
					.map(({ evidence }) => evidence),
				...fixedCandidates.map(({ evidence }) => evidence)
			],
			selectionDiagnosticIds: []
		};
	});
}

function bodyStateAt(
	state: SchedulerState,
	runtime: LocalBodyRuntime,
	time: number
): PairComponentBodyState | null {
	if (time < runtime.body.releaseTime) return null;
	const dynamicSupportPath = dynamicSupportPathForBody(state, runtime.body.id);
	if (
		dynamicSupportPath &&
		time >= dynamicSupportPath.startTime &&
		time <= dynamicSupportPath.endTime
	) {
		return {
			id: runtime.body.id,
			mass: runtime.body.mass,
			radius: runtime.body.physicalShape.radius,
			position: evaluateMotionSegmentPosition(dynamicSupportPath, time),
			velocity: evaluateMotionSegmentVelocity(dynamicSupportPath, time),
			prefixSegment:
				time > dynamicSupportPath.startTime ? truncateSegment(dynamicSupportPath, time) : null
		};
	}
	const reason = runtime.terminalReason;
	if (reason?.type === 'resting-contact' || reason?.type === 'no-future-event') {
		const startTime = reason.time ?? runtime.committedTime;
		const position = reason.type === 'resting-contact' ? reason.position : runtime.state.position;
		return {
			id: runtime.body.id,
			mass: runtime.body.mass,
			radius: runtime.body.physicalShape.radius,
			position,
			velocity: [0, 0],
			prefixSegment:
				time > startTime
					? {
							type: 'stationary',
							bodyId: runtime.body.id,
							startTime,
							endTime: time,
							startPosition: position,
							startVelocity: [0, 0],
							reason: 'resting-contact',
							componentId: runtime.dormantComponentId
						}
					: null
		};
	}
	const prediction = state.predictions.get(runtime.body.id) ?? null;
	const segment = prediction
		? predictionSegments(runtime, prediction).find(
				(candidate) => candidate.startTime <= time && candidate.endTime >= time
			)
		: null;
	if (!segment && time !== runtime.state.time) return null;
	return {
		id: runtime.body.id,
		mass: runtime.body.mass,
		radius: runtime.body.physicalShape.radius,
		position: segment ? evaluateMotionSegmentPosition(segment, time) : runtime.state.position,
		velocity: segment ? evaluateMotionSegmentVelocity(segment, time) : runtime.state.velocity,
		prefixSegment: segment && time > segment.startTime ? truncateSegment(segment, time) : null
	};
}

function truncateSegment(segment: MotionSegment, endTime: number): MotionSegment {
	if (segment.type !== 'circular-contact') return { ...segment, endTime };
	return {
		...segment,
		endTime,
		endAngle: evaluateCircularContactState(segment, endTime).angle
	};
}

function bodyPairCandidates(
	bodies: readonly ExactContactBodyState[],
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }> | null,
	time: number,
	tolerance: number
): readonly {
	readonly contact: Extract<ExactContact, { readonly type: 'body-body' }> | null;
	readonly evidence: NonNullable<ImpactSolveDiagnostic['candidateEvidence']>[number];
	readonly selectionDiagnosticId: string | null;
}[] {
	const selections = new Map(
		(selection?.simultaneousContacts ?? []).map((contact) => [
			pairKey(contact.first.bodyId, contact.second.bodyId),
			contact
		])
	);
	const result: {
		contact: Extract<ExactContact, { readonly type: 'body-body' }> | null;
		evidence: NonNullable<ImpactSolveDiagnostic['candidateEvidence']>[number];
		selectionDiagnosticId: string | null;
	}[] = [];
	for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
		for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
			const first = bodies[firstIndex]!;
			const second = bodies[secondIndex]!;
			const offset: Vec2 = [
				second.position[0] - first.position[0],
				second.position[1] - first.position[1]
			];
			const distance = Math.hypot(...offset);
			const separation = distance - first.radius - second.radius;
			const active =
				distance > tolerance && separation <= tolerance && separation >= -tolerance * 8;
			const id = bodyContactId(first.id, second.id, time);
			const selected = selections.get(pairKey(first.id, second.id)) ?? null;
			const geometricNormal: Vec2 = active ? [offset[0] / distance, offset[1] / distance] : [0, 0];
			const firstBodyId = selected?.first.bodyId ?? [first.id, second.id].sort()[0]!;
			const secondBodyId = firstBodyId === first.id ? second.id : first.id;
			const normal: Vec2 = selected
				? selected.state.normalFromFirstToSecond
				: firstBodyId === first.id
					? geometricNormal
					: [-geometricNormal[0], -geometricNormal[1]];
			const contactPoint = selected?.state.contactPoint ?? [
				first.position[0] + first.radius * geometricNormal[0],
				first.position[1] + first.radius * geometricNormal[1]
			];
			result.push({
				contact: active
					? {
							type: 'body-body' as const,
							id,
							firstBodyId,
							secondBodyId,
							normalFromFirstToSecond: normal,
							contactPoint: contactPoint as Vec2
						}
					: null,
				selectionDiagnosticId: selected?.diagnosticId ?? null,
				evidence: {
					id,
					type: 'body-body',
					separation,
					active,
					reason: active
						? 'Geometry touches at the certified common event time.'
						: separation > tolerance
							? 'Positive separation remains at the common event time.'
							: 'Geometry is degenerate or materially penetrating.'
				}
			});
		}
	}
	return result;
}

function connectedBodies(
	selection: Extract<PairSchedulerSelection, { readonly type: 'contact' }>,
	candidates: ReturnType<typeof bodyPairCandidates>
): ReadonlySet<string> {
	const connected = new Set([selection.first.bodyId, selection.second.bodyId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const { contact } of candidates) {
			if (!contact) continue;
			if (!connected.has(contact.firstBodyId) && !connected.has(contact.secondBodyId)) continue;
			if (!connected.has(contact.firstBodyId)) {
				connected.add(contact.firstBodyId);
				changed = true;
			}
			if (!connected.has(contact.secondBodyId)) {
				connected.add(contact.secondBodyId);
				changed = true;
			}
		}
	}
	return connected;
}

function fixedCandidate(
	body: ExactContactBodyState,
	collider: StaticCollider,
	time: number,
	tolerance: number
): {
	readonly contact: Extract<ExactContact, { readonly type: 'body-fixed' }> | null;
	readonly evidence: NonNullable<ImpactSolveDiagnostic['candidateEvidence']>[number];
} {
	const geometry = fixedGeometry(body.position, collider);
	const separation = geometry.distance - body.radius - geometry.colliderRadius;
	const active =
		geometry.distance > tolerance && separation <= tolerance && separation >= -tolerance * 8;
	const id = `fixed-contact:${body.id}:${collider.id}:${geometry.feature}:${time}`;
	const normalOffset: Vec2 = [
		body.position[0] - geometry.contactPoint[0],
		body.position[1] - geometry.contactPoint[1]
	];
	const normalDistance = Math.hypot(...normalOffset);
	const normal: Vec2 =
		active && normalDistance > tolerance
			? [normalOffset[0] / normalDistance, normalOffset[1] / normalDistance]
			: [0, 0];
	const normalVelocity = body.velocity[0] * normal[0] + body.velocity[1] * normal[1];
	const candidate: FixedWorldContactCandidate = {
		type: 'contact-candidate',
		bodyId: body.id,
		colliderId: collider.id,
		colliderKind: collider.physicalShape.type === 'circle' ? 'circle' : 'boundary',
		feature: geometry.feature,
		time,
		position: body.position,
		contactPoint: geometry.contactPoint,
		normal,
		normalVelocity,
		response: normalVelocity < -tolerance ? 'impact' : 'non-impulsive-contact'
	};
	return {
		contact: active
			? {
					type: 'body-fixed',
					id,
					bodyId: body.id,
					colliderId: collider.id,
					normal,
					contactPoint: geometry.contactPoint,
					candidate
				}
			: null,
		evidence: {
			id,
			type: 'body-fixed',
			separation,
			active,
			reason: active
				? 'Fixed geometry touches at the certified common event time.'
				: separation > tolerance
					? 'Positive separation remains at the common event time.'
					: 'Fixed-contact geometry is degenerate or materially penetrating.'
		}
	};
}

function fixedGeometry(
	position: Vec2,
	collider: StaticCollider
): {
	readonly distance: number;
	readonly colliderRadius: number;
	readonly contactPoint: Vec2;
	readonly feature: FixedWorldContactCandidate['feature'];
} {
	if (collider.physicalShape.type === 'circle' && 'centre' in collider) {
		const offset: Vec2 = [position[0] - collider.centre[0], position[1] - collider.centre[1]];
		const distance = Math.hypot(...offset);
		const normal: Vec2 = distance > 0 ? [offset[0] / distance, offset[1] / distance] : [0, 0];
		return {
			distance,
			colliderRadius: collider.physicalShape.radius,
			contactPoint: [
				collider.centre[0] + normal[0] * collider.physicalShape.radius,
				collider.centre[1] + normal[1] * collider.physicalShape.radius
			],
			feature: 'circle'
		};
	}
	const shape = collider.physicalShape;
	if (shape.type !== 'line-segment') {
		return {
			distance: Number.POSITIVE_INFINITY,
			colliderRadius: 0,
			contactPoint: position,
			feature: 'circle'
		};
	}
	const [startX, startY] = shape.start;
	const deltaX = shape.end[0] - startX;
	const deltaY = shape.end[1] - startY;
	const lengthSquared = deltaX * deltaX + deltaY * deltaY;
	const raw =
		lengthSquared > 0
			? ((position[0] - startX) * deltaX + (position[1] - startY) * deltaY) / lengthSquared
			: 0;
	const parameter = Math.max(0, Math.min(1, raw));
	const contactPoint: Vec2 = [startX + parameter * deltaX, startY + parameter * deltaY];
	const cross = deltaX * (position[1] - startY) - deltaY * (position[0] - startX);
	return {
		distance: Math.hypot(position[0] - contactPoint[0], position[1] - contactPoint[1]),
		colliderRadius: 0,
		contactPoint,
		feature:
			parameter === 0
				? 'start-endpoint'
				: parameter === 1
					? 'end-endpoint'
					: cross >= 0
						? 'segment-face-positive'
						: 'segment-face-negative'
	};
}

function bodyGeometryOrder(left: ExactContactBodyState, right: ExactContactBodyState): number {
	return (
		left.position[0] - right.position[0] ||
		left.position[1] - right.position[1] ||
		left.radius - right.radius ||
		left.mass - right.mass ||
		left.velocity[0] - right.velocity[0] ||
		left.velocity[1] - right.velocity[1] ||
		left.id.localeCompare(right.id)
	);
}

function pairKey(first: string, second: string): string {
	return [first, second].sort().join('\u0000');
}

function bodyContactId(first: string, second: string, time: number): string {
	return `body-contact:${[first, second].sort().join(':')}:${time}`;
}
