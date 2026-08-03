import { describe, expect, it } from 'vitest';
import { constructSingleBallRun } from '$lib/simulation/run';
import {
	parseSimulationInputFixture,
	serializeSimulationInputFixture
} from '$lib/simulation/serialization/simulation-input';
import { canonicalPlinkoScenarios } from '$lib/simulation/world';
import { syntheticMultiBodyFixtures } from '../fixtures';
import {
	createSimulationInputDraft,
	prepareSimulationInputSubmission,
	type DynamicBodyDraft,
	type SimulationInputDraft
} from './simulation-input-draft';

const angledScenario = canonicalPlinkoScenarios.find(({ id }) => id === 'angled-launch')!;

type DraftChanges = Partial<DynamicBodyDraft> & Partial<Omit<SimulationInputDraft, 'bodies'>>;

function prepare(changes: DraftChanges = {}) {
	const draft = createSimulationInputDraft(angledScenario.input);
	const settingKeys = new Set([
		'gravityX',
		'gravityY',
		'restitution',
		'maximumSimulationTime',
		'maximumEvents'
	]);
	const settings = Object.fromEntries(
		Object.entries(changes).filter(([key]) => settingKeys.has(key))
	) as Partial<Omit<SimulationInputDraft, 'bodies'>>;
	const body = Object.fromEntries(
		Object.entries(changes).filter(([key]) => !settingKeys.has(key))
	) as Partial<DynamicBodyDraft>;
	return prepareSimulationInputSubmission(angledScenario.input, {
		...draft,
		...settings,
		bodies: [{ ...draft.bodies[0]!, ...body }]
	});
}

describe('simulation input drafts', () => {
	it('prepopulates every exposed field from a scenario without scenario-specific branches', () => {
		const draft = createSimulationInputDraft(angledScenario.input);
		const body = angledScenario.input.initialDynamicBodies[0]!;

		expect(draft.bodies[0]).toMatchObject({
			radius: String(body.physicalShape.radius),
			positionX: String(body.position[0]),
			positionY: String(body.position[1]),
			velocityX: String(body.velocity[0]),
			velocityY: String(body.velocity[1])
		});
		expect(draft).toMatchObject({
			gravityX: String(angledScenario.input.settings.gravity[0]),
			gravityY: String(angledScenario.input.settings.gravity[1]),
			restitution: String(angledScenario.input.settings.restitution),
			maximumSimulationTime: String(angledScenario.input.settings.maximumSimulationTime),
			maximumEvents: String(angledScenario.input.settings.maximumEvents)
		});
	});

	it.each([
		['zero gravity', '0', '0'],
		['downward gravity', '0', '-9.81'],
		['lateral gravity', '3.5', '0'],
		['inverted gravity', '0', '9.81']
	])('accepts %s exactly', (_label, gravityX, gravityY) => {
		const result = prepare({ gravityX, gravityY });
		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.input.settings.gravity).toEqual([Number(gravityX), Number(gravityY)]);
	});

	it.each(['0', '0.45', '1'])('accepts restitution boundary/intermediate value %s', (value) => {
		const result = prepare({ restitution: value });
		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.input.settings.restitution).toBe(Number(value));
	});

	it.each(['0.001', '0.13', '2.5'])('accepts positive ball radius %s exactly', (value) => {
		const result = prepare({ radius: value });
		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.input.initialDynamicBodies[0]!.physicalShape.radius).toBe(Number(value));
	});

	it('accepts run-limit boundary values without normalising them', () => {
		const result = prepare({ maximumEvents: '0', maximumSimulationTime: '0.001' });
		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.input.settings.maximumEvents).toBe(0);
		expect(result.input.settings.maximumSimulationTime).toBe(0.001);
	});

	it('reports precise field errors before creating a submission', () => {
		const result = prepare({
			positionX: '',
			radius: '0',
			gravityX: 'Infinity',
			gravityY: 'NaN',
			restitution: '1.1',
			maximumSimulationTime: '0',
			maximumEvents: '1.5',
			speed: '-1'
		});

		expect(result).toEqual({
			valid: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ field: 'body.0.positionX', code: 'REQUIRED' }),
				expect.objectContaining({ field: 'body.0.radius', code: 'INVALID_RADIUS' }),
				expect.objectContaining({ field: 'gravityX', code: 'NOT_FINITE' }),
				expect.objectContaining({ field: 'gravityY', code: 'NOT_FINITE' }),
				expect.objectContaining({ field: 'restitution', code: 'INVALID_RESTITUTION' }),
				expect.objectContaining({ field: 'maximumSimulationTime', code: 'INVALID_MAXIMUM_TIME' }),
				expect.objectContaining({ field: 'maximumEvents', code: 'INVALID_MAXIMUM_EVENTS' }),
				expect.objectContaining({ field: 'body.0.speed', code: 'NEGATIVE_SPEED' })
			])
		});
	});

	it.each(['-1', '0', 'Infinity', 'NaN'])('rejects invalid radius %s', (radius) => {
		const result = prepare({ radius });
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.errors[0]).toMatchObject({
			field: 'body.0.radius',
			code: radius === '-1' || radius === '0' ? 'INVALID_RADIUS' : 'NOT_FINITE'
		});
	});

	it.each(['-0.01', '1.01', 'Infinity', 'NaN'])('rejects invalid restitution %s', (restitution) => {
		const result = prepare({ restitution });
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.errors[0]).toMatchObject({
			field: 'restitution',
			code: restitution === '-0.01' || restitution === '1.01' ? 'INVALID_RESTITUTION' : 'NOT_FINITE'
		});
	});

	it.each([
		[{ maximumEvents: '-1' }, 'maximumEvents', 'INVALID_MAXIMUM_EVENTS'],
		[{ maximumEvents: '2.5' }, 'maximumEvents', 'INVALID_MAXIMUM_EVENTS'],
		[{ maximumSimulationTime: '0' }, 'maximumSimulationTime', 'INVALID_MAXIMUM_TIME'],
		[{ maximumSimulationTime: '-1' }, 'maximumSimulationTime', 'INVALID_MAXIMUM_TIME']
	] as const)('rejects invalid run limit %#', (changes, field, code) => {
		const result = prepare(changes);
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.errors[0]).toMatchObject({ field, code });
	});

	it('snapshots all exposed values independently of later draft and scenario changes', () => {
		const baseDraft = createSimulationInputDraft(angledScenario.input);
		const draft = {
			...baseDraft,
			bodies: [
				{
					...baseDraft.bodies[0]!,
					radius: '0.37',
					positionX: '-1.25',
					velocityMode: 'components' as const,
					velocityX: '2.5',
					velocityY: '-0.75'
				}
			],
			gravityX: '4.25',
			gravityY: '2.75',
			restitution: '1',
			maximumSimulationTime: '0.125',
			maximumEvents: '0'
		};
		const baseInput = JSON.parse(
			JSON.stringify(angledScenario.input)
		) as typeof angledScenario.input;
		const result = prepareSimulationInputSubmission(baseInput, draft);
		expect(result.valid).toBe(true);
		if (!result.valid) return;

		const submittedJson = JSON.stringify(result.input);
		const mutableDraft = draft as unknown as {
			bodies: [{ radius: string }];
			gravityX: string;
		};
		mutableDraft.bodies[0].radius = '1';
		mutableDraft.gravityX = '0';
		(baseInput.settings.gravity as unknown as [number, number])[0] = -99;

		expect(JSON.stringify(result.input)).toBe(submittedJson);
		expect(result.input).toMatchObject({
			initialDynamicBodies: [
				{
					physicalShape: { radius: 0.37 },
					position: [-1.25, 6.5],
					velocity: [2.5, -0.75]
				}
			],
			settings: {
				gravity: [4.25, 2.75],
				restitution: 1,
				maximumSimulationTime: 0.125,
				maximumEvents: 0
			}
		});
		expect(Object.isFrozen(result.input)).toBe(true);
		expect(Object.isFrozen(result.input.settings)).toBe(true);
		expect(Object.isFrozen(result.input.initialDynamicBodies[0])).toBe(true);
	});

	it('round-trips every submitted setting through scenario JSON exactly', () => {
		const submission = prepare({
			radius: '0.037',
			gravityX: '-3.125',
			gravityY: '8.75',
			restitution: '0.625',
			maximumSimulationTime: '12.75',
			maximumEvents: '17'
		});
		expect(submission.valid).toBe(true);
		if (!submission.valid) return;

		const restored = parseSimulationInputFixture(serializeSimulationInputFixture(submission.input));
		expect(restored).toEqual(submission.input);
	});

	it('snapshots and round-trips mass, radius, release state and velocity for every body', () => {
		const baseInput = syntheticMultiBodyFixtures.find(
			({ id }) => id === 'synthetic-two-body-contact'
		)!.run.input;
		const draft = createSimulationInputDraft(baseInput);
		const submission = prepareSimulationInputSubmission(baseInput, {
			...draft,
			bodies: draft.bodies.map((body, index) =>
				index === 1
					? {
							...body,
							mass: '3.75',
							radius: '0.45',
							releaseTime: '1.25',
							positionX: '4',
							velocityMode: 'components' as const,
							velocityX: '-2.5',
							velocityY: '0.75'
						}
					: body
			)
		});

		expect(submission.valid).toBe(true);
		if (!submission.valid) return;
		expect(submission.input.initialDynamicBodies[1]).toMatchObject({
			mass: 3.75,
			physicalShape: { radius: 0.45 },
			releaseTime: 1.25,
			position: [4, 5],
			velocity: [-2.5, 0.75]
		});
		expect(parseSimulationInputFixture(serializeSimulationInputFixture(submission.input))).toEqual(
			submission.input
		);
		expect(Object.isFrozen(submission.input.initialDynamicBodies[1])).toBe(true);
	});

	it('keeps an authoritative run separate from later draft edits', () => {
		const draft = createSimulationInputDraft(angledScenario.input);
		const submission = prepareSimulationInputSubmission(angledScenario.input, draft);
		expect(submission.valid).toBe(true);
		if (!submission.valid) return;

		const run = constructSingleBallRun(submission.input);
		const updatedDraft = {
			...draft,
			bodies: [{ ...draft.bodies[0]!, radius: '0.5' }],
			gravityY: '9.81'
		};

		expect(updatedDraft.bodies[0]!.radius).not.toBe(
			run.input.initialDynamicBodies[0]!.physicalShape.radius.toString()
		);
		expect(run.input).toBe(submission.input);
		expect(run.input.settings.gravity).toEqual(angledScenario.input.settings.gravity);
	});
});
