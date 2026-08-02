import type { SimulationRunRecord } from '../../contracts';
import {
	getRunOutcome,
	getTerminalDiagnosticCode,
	isOutcomeConsistentWithValidity
} from '../../run';
import { invalidRunRecordField } from '../structural-validation';

export function validateRunConsistencyV6(record: SimulationRunRecord): void {
	const expectedOutcome = getRunOutcome(record.terminalReason);
	if (record.outcome !== expectedOutcome) {
		invalidRunRecordField(
			'$.outcome',
			`must be ${JSON.stringify(expectedOutcome)} for terminal reason ${JSON.stringify(record.terminalReason.type)}`
		);
	}
	if (!isOutcomeConsistentWithValidity(record.outcome, record.validity)) {
		invalidRunRecordField(
			'$.validity',
			`must agree with terminal outcome ${JSON.stringify(record.outcome)}`
		);
	}
	if (record.diagnostics.eventCount !== record.events.length) {
		invalidRunRecordField('$.diagnostics.eventCount', 'must equal the recorded event count');
	}
	if (record.diagnostics.iterations !== record.diagnostics.contactSearches.length) {
		invalidRunRecordField(
			'$.diagnostics.iterations',
			'must equal the recorded contact-search count'
		);
	}
	const candidateCount = record.diagnostics.contactSearches.reduce(
		(total, search) => total + search.candidates.length,
		0
	);
	if (record.diagnostics.candidateCount !== candidateCount) {
		invalidRunRecordField(
			'$.diagnostics.candidateCount',
			'must equal the recorded candidate count'
		);
	}
	const segmentCount = record.trajectories.reduce(
		(total, trajectory) => total + trajectory.segments.length,
		0
	);
	if (record.diagnostics.segmentCount !== segmentCount) {
		invalidRunRecordField(
			'$.diagnostics.segmentCount',
			'must equal the recorded trajectory segment count'
		);
	}
	if (
		record.terminalReason.time !== null &&
		record.diagnostics.simulatedUntilTime !== record.terminalReason.time
	) {
		invalidRunRecordField(
			'$.diagnostics.simulatedUntilTime',
			'must equal the terminal-reason time'
		);
	}
	if (record.terminalReason.time === null && record.diagnostics.simulatedUntilTime !== 0) {
		invalidRunRecordField(
			'$.diagnostics.simulatedUntilTime',
			'must be zero when terminal time is unavailable'
		);
	}
	const finalSegmentTime = record.trajectories
		.flatMap(({ segments }) => segments)
		.reduce<number | null>(
			(latest, segment) => (latest === null ? segment.endTime : Math.max(latest, segment.endTime)),
			null
		);
	if (finalSegmentTime !== null && finalSegmentTime !== record.diagnostics.simulatedUntilTime) {
		invalidRunRecordField('$.trajectories', 'must end at the simulated-until time');
	}
	if (record.events.some(({ time }) => time > record.diagnostics.simulatedUntilTime)) {
		invalidRunRecordField('$.events', 'must not contain an event after the simulated-until time');
	}
	const terminalEntry = record.diagnostics.entries.at(-1);
	if (!terminalEntry || terminalEntry.code !== getTerminalDiagnosticCode(record.outcome)) {
		invalidRunRecordField(
			'$.diagnostics.entries',
			`must end with ${getTerminalDiagnosticCode(record.outcome)} for the terminal outcome`
		);
	}
	validateTerminalReference(record);
}

function validateTerminalReference(record: SimulationRunRecord): void {
	const reason = record.terminalReason;
	if (reason.type === 'completion-region' || reason.type === 'escape-region') {
		const region = record.input.scene.terminationRegions.find(({ id }) => id === reason.regionId);
		const expectedPurpose = reason.type === 'completion-region' ? 'complete' : 'escape';
		if (!region || region.purpose !== expectedPurpose) {
			invalidRunRecordField(
				'$.terminalReason.regionId',
				`must identify a ${expectedPurpose} termination region in the input scene`
			);
		}
	}
	if (reason.type === 'resting-contact') {
		const collider = record.input.scene.staticColliders.find(({ id }) => id === reason.colliderId);
		if (!collider) {
			invalidRunRecordField('$.terminalReason.colliderId', 'must identify a fixed collider');
		}
		for (const [index, contact] of (reason.contacts ?? []).entries()) {
			if (!record.input.scene.staticColliders.some(({ id }) => id === contact.colliderId)) {
				invalidRunRecordField(
					`$.terminalReason.contacts[${index}].colliderId`,
					'must identify a fixed collider'
				);
			}
			if (contact.impulse < 0)
				invalidRunRecordField(
					`$.terminalReason.contacts[${index}].impulse`,
					'must be non-negative'
				);
		}
		const lastEvent = [...record.events].reverse().find(({ type }) => type === 'contact');
		if (
			!lastEvent ||
			lastEvent.type !== 'contact' ||
			lastEvent.colliderId !== reason.colliderId ||
			lastEvent.time !== reason.time ||
			lastEvent.position[0] !== reason.position[0] ||
			lastEvent.position[1] !== reason.position[1]
		) {
			invalidRunRecordField('$.terminalReason', 'must agree with the final recorded contact');
		}
	}
}
