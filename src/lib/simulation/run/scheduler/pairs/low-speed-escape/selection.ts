import type { ConstrainedImpactSolveDiagnostic, Vec2 } from '../../../../contracts';
import {
	classifyPostResponseContacts,
	isRepresentedRestCandidate,
	selectPostContactMode,
	type ResolvedContactState
} from '../../../contact-resolution';
import {
	LOW_SPEED_ELASTIC_IMPACT,
	resolveAnchoredComponentElasticFallback,
	resolveSupportPreservingElasticResponse,
	type LowSpeedElasticResponse
} from '../../../dynamic-impact';
import { planDormantComponents } from '../../dormancy';
import {
	canRepresentDynamicSupport,
	type DynamicSupportPreflightAnchor
} from '../../dynamic-support';
import type { SchedulerState } from '../../types';
import { coupledImpactInput, type SelectedCoupledImpact } from '../capture';
import type { ExactTimeComponent } from '../component';
import {
	authoritativeSupportContext,
	type AuthoritativeAnchoredComponent,
	type AuthoritativeSupportContext
} from './support';

export type LowSpeedEscapeSelection =
	| { readonly type: 'ordinary'; readonly selected: SelectedCoupledImpact }
	| {
			readonly type: 'constrained';
			readonly mode: 'support-preserving' | 'anchored-fallback';
			readonly response: LowSpeedElasticResponse;
			readonly resolvedContacts: ResolvedContactState;
			readonly preservedAnchoredComponents: readonly AuthoritativeAnchoredComponent[];
			readonly diagnostic: ConstrainedImpactSolveDiagnostic;
	  }
	| { readonly type: 'rejected'; readonly reason: string };

export function selectLowSpeedEscape(
	state: SchedulerState,
	component: ExactTimeComponent,
	ordinary: SelectedCoupledImpact,
	tolerance: number
): LowSpeedEscapeSelection {
	const support = authoritativeSupportContext(state, component, tolerance);
	const impactContacts = component.contacts.filter(({ id }) => !support.contactIds.includes(id));
	if (impactContacts.some(({ type }) => type === 'body-fixed')) {
		return { type: 'ordinary', selected: ordinary };
	}
	const incomingFloor =
		tolerance *
		Math.max(1, ...component.bodies.flatMap(({ velocity }) => velocity.map(Math.abs))) *
		32;
	const incomingBodyContacts = impactContacts.filter(
		(
			contact
		): contact is Extract<(typeof impactContacts)[number], { readonly type: 'body-body' }> =>
			contact.type === 'body-body' && -relativeNormal(component, contact) > incomingFloor
	);
	if (incomingBodyContacts.length === 0) return { type: 'ordinary', selected: ordinary };
	const impactSpeed = Math.max(
		...incomingBodyContacts.map((contact) => -relativeNormal(component, contact))
	);
	if (impactSpeed > LOW_SPEED_ELASTIC_IMPACT + incomingFloor) {
		return { type: 'ordinary', selected: ordinary };
	}
	const ordinaryResolved = classifyResponse(component, ordinary.response, tolerance);
	if (!ordinaryResolved) {
		return { type: 'rejected', reason: 'The configured response could not be classified.' };
	}
	if (hasStableRepresentedOutcome(state, ordinaryResolved, ordinary.response, tolerance, support)) {
		return { type: 'ordinary', selected: ordinary };
	}
	const input = {
		...coupledImpactInput(state, component, tolerance, 1),
		supportContactIds: support.contactIds
	};
	const primary = resolveSupportPreservingElasticResponse(input);
	if (primary.type === 'rejected') return primary;
	const primaryResolved = classifyResponse(component, primary.response, tolerance);
	if (!primaryResolved) {
		return { type: 'rejected', reason: 'The support-preserving response could not be classified.' };
	}
	const unsupported = unsupportedRetainedBodyContacts(
		state,
		primaryResolved,
		primary.response,
		tolerance,
		support
	);
	if (unsupported.length === 0) {
		return constrainedSelection(
			component,
			'support-preserving',
			primary.response,
			primaryResolved,
			[]
		);
	}
	const anchored = support.anchoredComponents.filter(({ record }) => {
		if (!record.bodyIds.some((bodyId) => unsupported.some((ids) => ids.includes(bodyId)))) {
			return false;
		}
		return record.bodyIds.some((bodyId) => {
			const velocity = primary.response.bodyVelocities.find(
				(body) => body.bodyId === bodyId
			)!.velocity;
			return Math.hypot(...velocity) > tolerance;
		});
	});
	if (anchored.length === 0) {
		return {
			type: 'rejected',
			reason:
				'The primary response requires an unsupported moving constrained cluster without an authoritative resting component eligible for anchored fallback.'
		};
	}
	const fallback = resolveAnchoredComponentElasticFallback({
		...input,
		anchoredComponents: anchored.map(({ record }) => ({
			componentId: record.id,
			bodyIds: record.bodyIds
		}))
	});
	if (fallback.type === 'rejected') return fallback;
	const fallbackResolved = classifyResponse(component, fallback.response, tolerance);
	if (!fallbackResolved) {
		return { type: 'rejected', reason: 'The anchored response could not be classified.' };
	}
	return constrainedSelection(
		component,
		'anchored-fallback',
		fallback.response,
		fallbackResolved,
		anchored
	);
}

function hasStableRepresentedOutcome(
	state: SchedulerState,
	resolved: ResolvedContactState,
	response: {
		readonly bodyVelocities: readonly { readonly bodyId: string; readonly velocity: Vec2 }[];
	},
	tolerance: number,
	support: AuthoritativeSupportContext
): boolean {
	const dormantPlans = planDormantComponents(state, resolved, response, tolerance);
	const dormantBodyIds = new Set(dormantPlans.flatMap(({ bodyIds }) => [...bodyIds]));
	if (
		unsupportedRetainedBodyContacts(state, resolved, response, tolerance, support, dormantBodyIds)
			.length > 0
	) {
		return false;
	}
	if (dormantPlans.length > 0) return true;
	const fixed = resolved.contacts.find(
		({ contact, disposition }) => contact.type === 'body-fixed' && disposition === 'retained'
	)?.contact;
	if (fixed) {
		return (
			selectPostContactMode({ contacts: resolved, preferredFixedContactId: fixed.id }).type ===
			'fixed-sustained-contact'
		);
	}
	return resolved.contacts.some(
		({ contact, disposition }) =>
			contact.type === 'body-body' &&
			disposition === 'retained' &&
			isRepresentableDynamicSupport(
				state,
				resolved,
				contact,
				response,
				tolerance,
				supportAnchors(support, dormantPlans)
			)
	);
}

function unsupportedRetainedBodyContacts(
	state: SchedulerState,
	resolved: ResolvedContactState,
	response: {
		readonly bodyVelocities: readonly { readonly bodyId: string; readonly velocity: Vec2 }[];
	},
	tolerance: number,
	support: AuthoritativeSupportContext,
	dormantBodyIds: ReadonlySet<string> = new Set()
): readonly (readonly [string, string])[] {
	const dormantPlans = planDormantComponents(state, resolved, response, tolerance);
	const plannedDormantBodyIds = new Set([
		...dormantBodyIds,
		...dormantPlans.flatMap(({ bodyIds }) => [...bodyIds])
	]);
	const anchors = supportAnchors(support, dormantPlans);
	return resolved.contacts.flatMap(({ contact, disposition }) => {
		if (contact.type !== 'body-body' || disposition !== 'retained') return [];
		const contactVelocities = [contact.firstBodyId, contact.secondBodyId].map(
			(bodyId) => response.bodyVelocities.find((body) => body.bodyId === bodyId)!.velocity
		);
		if (isRepresentedRestCandidate(contactVelocities)) return [];
		if (
			plannedDormantBodyIds.has(contact.firstBodyId) &&
			plannedDormantBodyIds.has(contact.secondBodyId)
		) {
			return [];
		}
		return isRepresentableDynamicSupport(state, resolved, contact, response, tolerance, anchors)
			? []
			: [[contact.firstBodyId, contact.secondBodyId] as const];
	});
}

function isRepresentableDynamicSupport(
	state: SchedulerState,
	resolved: ResolvedContactState,
	contact: Extract<
		ResolvedContactState['eventState']['contacts'][number],
		{ readonly type: 'body-body' }
	>,
	response: {
		readonly bodyVelocities: readonly { readonly bodyId: string; readonly velocity: Vec2 }[];
	},
	tolerance: number,
	anchors: readonly DynamicSupportPreflightAnchor[]
): boolean {
	return anchors.some((anchor) =>
		canRepresentDynamicSupport(state, resolved, response, contact, anchor, tolerance)
	);
}

function supportAnchors(
	support: AuthoritativeSupportContext,
	dormantPlans: ReturnType<typeof planDormantComponents>
): readonly DynamicSupportPreflightAnchor[] {
	return [
		...support.anchoredComponents.map(({ record, contacts }) => ({
			componentId: record.id,
			bodyIds: new Set(record.bodyIds),
			contacts
		})),
		...dormantPlans.map((plan) => ({
			componentId: `dormant-preflight:${plan.groupIndex}`,
			bodyIds: plan.bodyIds,
			contacts: plan.support.contacts
		}))
	];
}

function classifyResponse(
	component: ExactTimeComponent,
	response: {
		readonly contacts: readonly {
			readonly contactId: string;
			readonly preImpactNormalVelocity: number;
			readonly postImpactNormalVelocity: number;
			readonly impulse?: number;
			readonly role?: 'support-constraint' | 'impact';
		}[];
		readonly impactImpulses?: readonly { readonly contactId: string; readonly impulse: number }[];
	},
	tolerance: number
): ResolvedContactState | null {
	return classifyPostResponseContacts(
		component,
		response.contacts.map((contact) => ({
			contactId: contact.contactId,
			preResponseNormalVelocity: contact.preImpactNormalVelocity,
			postResponseNormalVelocity: contact.postImpactNormalVelocity,
			impulse:
				contact.impulse ??
				response.impactImpulses?.find(({ contactId }) => contactId === contact.contactId)
					?.impulse ??
				0
		})),
		tolerance
	);
}

function constrainedSelection(
	component: ExactTimeComponent,
	mode: 'support-preserving' | 'anchored-fallback',
	response: LowSpeedElasticResponse,
	resolvedContacts: ResolvedContactState,
	preservedAnchoredComponents: readonly AuthoritativeAnchoredComponent[]
): Extract<LowSpeedEscapeSelection, { readonly type: 'constrained' }> {
	return {
		type: 'constrained',
		mode,
		response,
		resolvedContacts,
		preservedAnchoredComponents,
		diagnostic: {
			kind: 'support-preserving-elastic',
			componentId: component.id,
			mode,
			bodyIds: component.bodies.map(({ id }) => id),
			masses: component.bodies.flatMap(({ mass }) => [mass, mass]),
			contacts: response.contacts,
			impactImpulses: response.impactImpulses,
			supportReactions: response.supportReactions,
			lockReactions: response.lockReactions,
			preImpactVelocity: response.preImpactVelocity,
			finalVelocity: response.finalVelocity,
			certification: response.certification
		}
	};
}

function relativeNormal(
	component: ExactTimeComponent,
	contact: Extract<ExactTimeComponent['contacts'][number], { readonly type: 'body-body' }>
): number {
	const first = component.bodies.find(({ id }) => id === contact.firstBodyId)!.velocity;
	const second = component.bodies.find(({ id }) => id === contact.secondBodyId)!.velocity;
	return (
		(second[0] - first[0]) * contact.normalFromFirstToSecond[0] +
		(second[1] - first[1]) * contact.normalFromFirstToSecond[1]
	);
}
