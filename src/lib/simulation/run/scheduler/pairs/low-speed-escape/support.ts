import type { ContactComponentRecord, DynamicContactRecord, Vec2 } from '../../../../contracts';
import type { ExactContact } from '../../../contact-resolution';
import type { SchedulerState } from '../../types';
import type { ExactTimeComponent } from '../component';

export interface AuthoritativeAnchoredComponent {
	readonly record: ContactComponentRecord;
	readonly contacts: readonly ExactContact[];
}

export interface AuthoritativeSupportContext {
	readonly contactIds: readonly string[];
	readonly anchoredComponents: readonly AuthoritativeAnchoredComponent[];
}

export function authoritativeSupportContext(
	state: SchedulerState,
	component: ExactTimeComponent,
	tolerance: number
): AuthoritativeSupportContext {
	const supportIds = new Set<string>();
	const anchoredComponents = state.contactComponents
		.filter((record) => record.type === 'resting-anchored' && record.dissolvedAtTime === null)
		.flatMap((record) => {
			const evidence = state.dynamicContacts.filter(({ id }) =>
				record.activeContactIds.includes(id)
			);
			const contacts = component.contacts.filter((contact) =>
				evidence.some((candidate) => matchesRecordedContact(contact, candidate, tolerance))
			);
			if (contacts.length === 0) return [];
			for (const contact of contacts) supportIds.add(contact.id);
			return [{ record, contacts }];
		});
	for (const support of state.dynamicSupports.values()) {
		for (const contact of component.contacts) {
			if (
				support.anchoredContacts.some((candidate) =>
					matchesExactContact(contact, candidate, tolerance)
				) ||
				(contact.type === 'body-body' &&
					sameBodyPair(
						contact.firstBodyId,
						contact.secondBodyId,
						support.movingBodyId,
						support.supportBodyId
					))
			) {
				supportIds.add(contact.id);
			}
		}
	}
	for (const body of component.bodies) {
		const segment = body.prefixSegment;
		if (
			!segment ||
			(segment.type !== 'linear-contact' && segment.type !== 'circular-contact') ||
			(segment.type === 'circular-contact' && segment.supportingBodyId !== undefined)
		) {
			continue;
		}
		const contact = component.contacts.find(
			(candidate) =>
				candidate.type === 'body-fixed' &&
				candidate.bodyId === body.id &&
				candidate.colliderId === segment.supportingColliderId &&
				normalsAgree(
					candidate.normal,
					segment.type === 'linear-contact' ? segment.contactNormal : normalAtCircularEnd(segment),
					tolerance
				)
		);
		if (contact) supportIds.add(contact.id);
	}
	return {
		contactIds: component.contacts.flatMap(({ id }) => (supportIds.has(id) ? [id] : [])),
		anchoredComponents
	};
}

function matchesRecordedContact(
	contact: ExactContact,
	recorded: DynamicContactRecord,
	tolerance: number
): boolean {
	if (contact.type === 'body-fixed') {
		const [first, second] = recorded.participants;
		return (
			first.type === 'fixed-collider' &&
			second.type === 'body' &&
			first.colliderId === contact.colliderId &&
			second.bodyId === contact.bodyId &&
			normalsAgree(recorded.normalFromFirstToSecond, contact.normal, tolerance)
		);
	}
	const [first, second] = recorded.participants;
	if (first.type !== 'body' || second.type !== 'body') return false;
	if (!sameBodyPair(first.bodyId, second.bodyId, contact.firstBodyId, contact.secondBodyId)) {
		return false;
	}
	const alignedNormal: Vec2 =
		first.bodyId === contact.firstBodyId
			? recorded.normalFromFirstToSecond
			: [-recorded.normalFromFirstToSecond[0], -recorded.normalFromFirstToSecond[1]];
	return normalsAgree(alignedNormal, contact.normalFromFirstToSecond, tolerance);
}

function matchesExactContact(left: ExactContact, right: ExactContact, tolerance: number): boolean {
	if (left.type !== right.type) return false;
	if (left.type === 'body-fixed' && right.type === 'body-fixed') {
		return (
			left.bodyId === right.bodyId &&
			left.colliderId === right.colliderId &&
			normalsAgree(left.normal, right.normal, tolerance)
		);
	}
	if (left.type !== 'body-body' || right.type !== 'body-body') return false;
	if (!sameBodyPair(left.firstBodyId, left.secondBodyId, right.firstBodyId, right.secondBodyId)) {
		return false;
	}
	const alignedNormal: Vec2 =
		left.firstBodyId === right.firstBodyId
			? right.normalFromFirstToSecond
			: [-right.normalFromFirstToSecond[0], -right.normalFromFirstToSecond[1]];
	return normalsAgree(left.normalFromFirstToSecond, alignedNormal, tolerance);
}

function normalsAgree(left: Vec2, right: Vec2, tolerance: number): boolean {
	return left[0] * right[0] + left[1] * right[1] >= 1 - tolerance * 32;
}

function sameBodyPair(
	first: string,
	second: string,
	otherFirst: string,
	otherSecond: string
): boolean {
	return (
		(first === otherFirst && second === otherSecond) ||
		(first === otherSecond && second === otherFirst)
	);
}

function normalAtCircularEnd(
	segment: Extract<
		NonNullable<ExactTimeComponent['bodies'][number]['prefixSegment']>,
		{ readonly type: 'circular-contact' }
	>
): Vec2 {
	return [Math.cos(segment.endAngle), Math.sin(segment.endAngle)];
}
