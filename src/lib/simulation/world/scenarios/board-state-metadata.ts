import type {
	ScenarioCategoryId,
	ScenarioCoverageId,
	ScenarioEventExpectation,
	VerificationScenario
} from './types';

const scenarioMetadata = {
	'no-pegs': metadata('board-layouts', ['board.no-pegs']),
	'isolated-peg': metadata('board-layouts', ['board.isolated-peg']),
	sparse: metadata('board-layouts', ['board.sparse']),
	canonical: metadata('board-layouts', ['board.canonical']),
	dense: metadata('board-layouts', ['board.dense']),
	'mirrored-sparse': metadata('board-layouts', ['board.mirrored']),
	'reversed-sparse': metadata('board-layouts', ['board.reversed']),
	'flat-support': metadata(
		'physical-settings',
		['board.flat-support', 'physics.zero-restitution', 'sustained.flat-resting'],
		{
			summary: 'One impact collapses into explicit resting contact.',
			minimumContactEvents: 1,
			requiredTransitions: [{ from: 'impact', to: 'resting' }]
		}
	),
	'angled-ramp': metadata('physical-settings', ['board.angled-ramp', 'sustained.line-sliding'], {
		summary: 'Impact collapses into line-segment sliding before endpoint detachment.',
		minimumContactEvents: 1,
		requiredMotionModes: ['linear-contact'],
		requiredTransitions: [
			{ from: 'impact', to: 'sliding' },
			{ from: 'sliding', to: 'free-flight' }
		]
	}),
	'close-contacts': metadata(
		'adversarial-contacts',
		['board.close-contacts', 'launch.simultaneous-candidates'],
		{
			summary: 'The first search exposes exact near-simultaneous peg candidates.',
			nearSimultaneousCandidate: true
		},
		'valid-prefix'
	),
	'no-reachable-exit-settled': metadata('board-layouts', ['board.no-reachable-exit']),
	'no-future-event': metadata('physical-settings', []),
	'explicit-time-limit': metadata('physical-settings', ['physics.time-limit-boundary'])
} as const;

export function getBoardStateScenarioMetadata(id: string) {
	const result = scenarioMetadata[id as keyof typeof scenarioMetadata];
	if (!result) throw new Error(`Missing board scenario metadata for ${id}.`);
	return result;
}

function metadata(
	categoryId: ScenarioCategoryId,
	coverage: readonly ScenarioCoverageId[],
	expectedEventCharacteristics: ScenarioEventExpectation | null = null,
	replayExpectation: VerificationScenario['replayExpectation'] = 'complete'
) {
	return { categoryId, coverage, expectedEventCharacteristics, replayExpectation } as const;
}
