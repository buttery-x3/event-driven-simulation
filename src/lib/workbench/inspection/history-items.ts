import type {
	ComponentLifecycleEvent,
	ContactParticipant,
	DynamicContactRecord,
	PhysicalEvent,
	ReleaseEvent,
	SimulationRunRecord
} from '$lib/simulation/contracts';
import { formatVector } from '../model';

export type WorkbenchHistoryKind =
	| 'release'
	| 'physical-event'
	| 'dynamic-contact'
	| 'component-transition'
	| 'prediction'
	| 'scheduler';

export interface WorkbenchHistoryItem {
	readonly id: string;
	readonly time: number;
	readonly kind: WorkbenchHistoryKind;
	readonly title: string;
	readonly participants: string;
	readonly detail: string;
	readonly bodyIds: readonly string[];
	readonly sourceOrder: number;
}

export function buildWorkbenchHistory(run: SimulationRunRecord): readonly WorkbenchHistoryItem[] {
	const items = [
		...run.releases.map((event, index) => releaseItem(event, index)),
		...run.events.map((event, index) => physicalEventItem(event, index)),
		...run.dynamicContacts.map((contact, index) => dynamicContactItem(contact, index)),
		...run.componentEvents.map((event, index) => componentEventItem(run, event, index)),
		...run.diagnostics.pairPredictions.map((prediction, index) => ({
			id: `prediction-${index}-${prediction.id}`,
			time: prediction.predictedTime ?? prediction.validInterval[1],
			kind: 'prediction' as const,
			title: `Prediction ${prediction.decision}`,
			participants: prediction.bodyIds.join(' ↔ '),
			detail: `${prediction.reason} Revisions ${prediction.revisions.map(({ revision }) => revision).join(' / ')}.${prediction.retainedThroughWorldTimes?.length ? ` Retained unchanged through world time ${prediction.retainedThroughWorldTimes.join(', ')}.` : ''}`,
			bodyIds: prediction.bodyIds,
			sourceOrder: 4_000 + index
		})),
		...(run.diagnostics.schedulerSteps ?? [])
			.filter(({ eventType }) => eventType !== 'release')
			.map((step, index) => ({
				id: `scheduler-${index}-${step.bodyId}-${step.revision}`,
				time: step.worldTime,
				kind: 'scheduler' as const,
				title: `Scheduler selected ${step.eventType}`,
				participants: step.bodyId,
				detail:
					step.retainedBodyIds.length === 0
						? `Revision ${step.revision}; no unrelated predictions were active.`
						: `Revision ${step.revision}; retained ${step.retainedBodyIds.join(', ')} without segmentation.`,
				bodyIds: [step.bodyId, ...step.retainedBodyIds],
				sourceOrder: 5_000 + index
			}))
	];

	return items.sort(
		(left, right) => left.time - right.time || left.sourceOrder - right.sourceOrder
	);
}

export function filterHistoryByBody(
	items: readonly WorkbenchHistoryItem[],
	bodyId: string | null
): readonly WorkbenchHistoryItem[] {
	return bodyId === null ? items : items.filter((item) => item.bodyIds.includes(bodyId));
}

function releaseItem(event: ReleaseEvent, index: number): WorkbenchHistoryItem {
	return {
		id: `release-${index}-${event.bodyId}`,
		time: event.time,
		kind: 'release',
		title: event.status === 'released' ? 'Body released' : 'Release rejected',
		participants: event.bodyId,
		detail: `p=${formatVector(event.position)} · v=${formatVector(event.velocity)}${event.reason ? ` · ${event.reason}` : ''}`,
		bodyIds: [event.bodyId],
		sourceOrder: index
	};
}

function physicalEventItem(event: PhysicalEvent, index: number): WorkbenchHistoryItem {
	return {
		id: `physical-${index}-${event.bodyId}-${event.colliderId}`,
		time: event.time,
		kind: 'physical-event',
		title:
			event.type === 'contact-mode-transition'
				? `${event.from} → ${event.to}`
				: 'Fixed-world contact',
		participants: `${event.bodyId} → ${event.colliderId}`,
		detail: `${event.type === 'contact-mode-transition' ? `${event.reason} · ` : ''}p=${formatVector(event.position)} · normal=${formatVector(event.normal)}${event.contacts ? ` · ${event.contacts.length} manifold contacts` : ''}`,
		bodyIds: [event.bodyId],
		sourceOrder: 1_000 + index
	};
}

function dynamicContactItem(contact: DynamicContactRecord, index: number): WorkbenchHistoryItem {
	const bodyIds = contact.participants.flatMap((participant) =>
		participant.type === 'body' ? [participant.bodyId] : []
	);
	return {
		id: `dynamic-${index}-${contact.id}`,
		time: contact.time,
		kind: 'dynamic-contact',
		title: `Dynamic contact ${contact.state}`,
		participants: contact.participants.map(formatParticipant).join(' ↔ '),
		detail: `point=${formatVector(contact.contactPoint)} · normal=${formatVector(contact.normalFromFirstToSecond)} · impulse=${contact.impulse ?? 'not recorded'} · normal velocity ${contact.preImpactNormalVelocity ?? '—'} → ${contact.postImpactNormalVelocity ?? '—'}`,
		bodyIds,
		sourceOrder: 2_000 + index
	};
}

function componentEventItem(
	run: SimulationRunRecord,
	event: ComponentLifecycleEvent,
	index: number
): WorkbenchHistoryItem {
	const componentIds = [...event.componentIds, ...event.resultingComponentIds];
	const bodyIds = [
		...new Set(
			componentIds.flatMap(
				(id) => run.contactComponents.find((component) => component.id === id)?.bodyIds ?? []
			)
		)
	];
	return {
		id: `component-${index}-${event.change}`,
		time: event.time,
		kind: 'component-transition',
		title: `Component ${event.change}`,
		participants: bodyIds.length > 0 ? bodyIds.join(', ') : 'No dynamic members',
		detail: `${event.componentIds.join(', ') || '∅'} → ${event.resultingComponentIds.join(', ') || '∅'}`,
		bodyIds,
		sourceOrder: 3_000 + index
	};
}

function formatParticipant(participant: ContactParticipant): string {
	return participant.type === 'body' ? participant.bodyId : `fixed:${participant.colliderId}`;
}
