import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { SimulationInput } from '../../src/lib/simulation/contracts';
import { constructSingleBallRun } from '../../src/lib/simulation/run';

interface FilePayload {
	readonly name: string;
	readonly mimeType: string;
	readonly buffer: Buffer;
}

const canonicalFixturePath = path.resolve(
	process.cwd(),
	'fixtures/runs/canonical-event-driven-offset-drop.json'
);

test.describe.configure({ mode: 'serial' });

test('presents a calculated run as a diagnostic workbench and seeks exact events', async ({
	page
}) => {
	await page.goto('/');

	await expect(page.getByRole('main', { name: 'Simulation diagnostics workbench' })).toBeVisible();
	await expect(
		page.getByRole('heading', { level: 1, name: 'Event-Driven Simulation' })
	).toBeVisible();
	await expect(page.getByText('Motion, one recorded segment at a time.')).toHaveCount(0);

	const replay = page.getByRole('region', { name: 'Calculated run replay' });
	await expect(replay).toBeVisible();
	await expect(
		replay.getByRole('img', {
			name: 'Scene canonical-plinko-board replaying recorded ball trajectory data'
		})
	).toBeVisible();
	await expect(replay.locator('canvas')).toBeVisible();
	await expect(page.getByText('Calculation completed before replay began.')).toBeVisible();
	await expect(page.getByText('Replaying already calculated trajectory data')).toBeVisible();

	const controls = page.getByRole('region', { name: 'Replay controls' });
	const playButton = controls.getByRole('button', { name: 'Play' });
	await playButton.click();
	await expect(controls.getByRole('button', { name: 'Pause' })).toBeVisible();
	await expect(replay.getByText('playing', { exact: true })).toBeVisible();

	const event = page.getByRole('button', { name: /^Event 1, contact at / });
	await event.click();

	await expect(event).toHaveAttribute('aria-current', 'true');
	await expect(controls.locator('output')).toHaveText('0.386 s / 4.145 s');
	await expect(controls.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('selects, edits, runs and replays a canonical launch without mutating the prior run', async ({
	page
}) => {
	await page.goto('/');

	await page.getByLabel('Scenario preset').selectOption('offset-drop');
	await expect(
		page.getByText('Draft reset to Offset drop. Current run unchanged until Run.')
	).toBeVisible();
	await expect(
		page
			.getByLabel('Current run source')
			.getByText('Repository fixture · canonical-event-driven-offset-drop.json', { exact: true })
	).toBeVisible();

	const position = page.getByRole('group', { name: 'Initial position (m)' });
	await position.getByLabel('X').fill('0.44');
	await page.getByLabel('Components').check();
	await page.getByLabel('Velocity X (m/s)').fill('0');
	await page.getByLabel('Velocity Y (m/s)').fill('0');
	await page.getByRole('button', { name: 'Run simulation' }).click();

	await expect(
		page
			.getByLabel('Current run source')
			.getByText('Calculated scenario · Offset drop', { exact: true })
	).toBeVisible();
	await expect(
		page.getByText(/^Run calculated · exited · \d+ events · \d+ ms wall time\.$/)
	).toBeVisible();
	await expect(page.getByText('Calculation completed before replay began.')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Event 1, contact at / })).toBeVisible();

	const controls = page.getByRole('region', { name: 'Replay controls' });
	await controls.getByRole('button', { name: 'Play' }).click();
	await expect(controls.getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('edits physical settings, runs their immutable snapshot and keeps replay unchanged by later drafts', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Scenario preset').selectOption('offset-drop');

	await page.getByLabel('Radius (m)').fill('0.17');
	await page.getByLabel('Gravity X (m/s²)').fill('2.25');
	await page.getByLabel('Gravity Y (m/s²)').fill('-4.5');
	await page.getByLabel('Bounciness').fill('0.35');
	await page.getByLabel('Maximum time (s)').fill('2');
	await page.getByLabel('Maximum events').fill('12');
	await page.getByRole('button', { name: 'Run simulation' }).click();

	const inspector = page.getByRole('complementary', { name: 'Run inspector' });
	await expect(inspector.getByText('0.17 m', { exact: true })).toBeVisible();
	await expect(inspector.getByText('(2.25, -4.5)', { exact: true })).toBeVisible();
	await expect(inspector.getByText('0.35', { exact: true })).toBeVisible();
	await expect(inspector.getByText('12', { exact: true })).toBeVisible();
	await expect(
		inspector.getByText('Maximum simulation time').locator('..').getByText('2 s', { exact: true })
	).toBeVisible();

	await page.getByLabel('Radius (m)').fill('0.42');
	await page.getByLabel('Gravity X (m/s²)').fill('0');
	await page.getByLabel('Gravity Y (m/s²)').fill('9.81');

	await expect(inspector.getByText('0.17 m', { exact: true })).toBeVisible();
	await expect(inspector.getByText('(2.25, -4.5)', { exact: true })).toBeVisible();
	await expect(inspector.getByText('0.42 m', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('region', { name: /replay|inspection/ }).first()).toBeVisible();
});

test('rejects invalid physical settings with field-level feedback before simulation', async ({
	page
}) => {
	await page.goto('/');

	await page.getByLabel('Radius (m)').fill('0');
	await page.getByLabel('Gravity X (m/s²)').fill('');
	await page.getByLabel('Gravity Y (m/s²)').fill('');
	await page.getByLabel('Bounciness').fill('1.2');
	await page.getByLabel('Maximum time (s)').fill('0');
	await page.getByLabel('Maximum events').fill('1.5');
	await page.getByRole('button', { name: 'Run simulation' }).click();

	await expect(page.getByText('Ball radius must be greater than zero.')).toBeVisible();
	await expect(page.getByText('Gravity X is required.')).toBeVisible();
	await expect(page.getByText('Gravity Y is required.')).toBeVisible();
	await expect(page.getByText('Bounciness must be between zero and one.')).toBeVisible();
	await expect(page.getByText('Maximum simulation time must be greater than zero.')).toBeVisible();
	await expect(page.getByText('Maximum event count must be a non-negative integer.')).toBeVisible();
	await expect(
		page
			.getByLabel('Current run source')
			.getByText('Repository fixture · canonical-event-driven-offset-drop.json', { exact: true })
	).toBeVisible();
});

test('saves and reloads every exposed physical setting through scenario JSON', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Scenario preset').selectOption('offset-drop');

	await page.getByLabel('Radius (m)').fill('0.037');
	await page.getByLabel('Gravity X (m/s²)').fill('-3.125');
	await page.getByLabel('Gravity Y (m/s²)').fill('8.75');
	await page.getByLabel('Bounciness').fill('0.625');
	await page.getByLabel('Maximum time (s)').fill('12.75');
	await page.getByLabel('Maximum events').fill('17');

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Save scenario' }).click();
	const download = await downloadPromise;
	const downloadPath = await download.path();
	if (!downloadPath) throw new Error('Expected Playwright to retain the saved scenario download.');
	const savedBuffer = await readFile(downloadPath);
	const savedFixture = JSON.parse(savedBuffer.toString('utf8')) as {
		input: SimulationInput;
	};

	expect(savedFixture.input.initialDynamicBodies[0]!.physicalShape.radius).toBe(0.037);
	expect(savedFixture.input.settings).toMatchObject({
		gravity: [-3.125, 8.75],
		restitution: 0.625,
		maximumSimulationTime: 12.75,
		maximumEvents: 17
	});

	await page.getByLabel('Radius (m)').fill('1');
	await page.getByLabel('Gravity X (m/s²)').fill('0');
	await page.getByLabel('Gravity Y (m/s²)').fill('-9.81');
	await chooseScenarioFile(page, {
		name: 'physical-settings-input.json',
		mimeType: 'application/json',
		buffer: savedBuffer
	});

	await expect(page.getByLabel('Radius (m)')).toHaveValue('0.037');
	await expect(page.getByLabel('Gravity X (m/s²)')).toHaveValue('-3.125');
	await expect(page.getByLabel('Gravity Y (m/s²)')).toHaveValue('8.75');
	await expect(page.getByLabel('Bounciness')).toHaveValue('0.625');
	await expect(page.getByLabel('Maximum time (s)')).toHaveValue('12.75');
	await expect(page.getByLabel('Maximum events')).toHaveValue('17');
});

test('groups verification scenarios, replaces worlds on Run and reports authoritative outcomes', async ({
	page
}) => {
	await page.goto('/');

	const catalogue = page.getByRole('region', { name: 'Scenario catalogue' });
	const selector = catalogue.getByLabel('Scenario preset');
	await expect(selector.locator('optgroup[label="Canonical launches"] option')).toHaveCount(5);
	await expect(selector.locator('optgroup[label="Board layouts"] option')).toHaveCount(7);
	await expect(selector.locator('optgroup[label="Physical settings"] option')).toHaveCount(5);
	await expect(selector.locator('optgroup[label="Adversarial contacts"] option')).toHaveCount(1);

	const scenarios = [
		{ id: 'no-pegs', sceneId: 'no-pegs-board', outcome: 'exited' },
		{ id: 'dense', sceneId: 'dense-board', outcome: 'exited' },
		{ id: 'mirrored-sparse', sceneId: 'mirrored-sparse-board', outcome: 'escaped' },
		{ id: 'angled-ramp', sceneId: 'angled-ramp-board', outcome: 'escaped' },
		{ id: 'close-contacts', sceneId: 'close-contact-board', outcome: 'unresolved' }
	] as const;

	for (const scenario of scenarios) {
		await selector.selectOption(scenario.id);
		await expect(catalogue.getByLabel('Selected scenario ID')).toHaveText(scenario.id);
		await expect(catalogue.getByLabel('Selected scene ID')).toHaveText(scenario.sceneId);
		await expect(
			catalogue.getByText('Expected / permitted outcomes', { exact: true })
		).toBeVisible();
		await expect(catalogue.getByText('Not run for this selection', { exact: true })).toBeVisible();
		await expect(
			page.getByRole('img', {
				name: `Scene ${scenario.sceneId} replaying recorded ball trajectory data`
			})
		).toHaveCount(0);

		await page.getByRole('button', { name: 'Run simulation' }).click();

		await expect(
			page.getByRole('img', {
				name: `Scene ${scenario.sceneId} replaying recorded ball trajectory data`
			})
		).toBeVisible();
		await expect(catalogue.getByText(new RegExp(`^${scenario.outcome}.*permitted$`))).toBeVisible();
		await expect(
			page.getByText(new RegExp(`^Run calculated.*${scenario.outcome}.*events`))
		).toBeVisible();

		if (scenario.id === 'no-pegs') {
			await page.getByLabel('Components').check();
			await page.getByLabel('Velocity X (m/s)').fill('10');
			await page.getByLabel('Velocity Y (m/s)').fill('0');
			await page.getByRole('button', { name: 'Run simulation' }).click();
			await expect(catalogue.getByRole('alert')).toContainText(/escaped.*mismatch/);
		}
	}

	await expect(page.getByRole('region', { name: 'Recorded-prefix inspection' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Failure boundary' })).toBeVisible();
});

test('loads a local saved run and retains it after typed validation failures', async ({ page }) => {
	await page.goto('/');

	const canonical = await readFile(canonicalFixturePath, 'utf8');
	await chooseFile(page, {
		name: 'local-run.json',
		mimeType: 'application/json',
		buffer: Buffer.from(canonical)
	});

	await expect(
		page.getByLabel('Current run source').getByText('Local file · local-run.json', { exact: true })
	).toBeVisible();
	await expect(
		page.getByText('Loaded local-run.json · contract v6', { exact: true })
	).toBeVisible();

	await expectRejectedCandidate(page, {
		name: 'malformed.json',
		content: '{',
		code: 'MALFORMED_FIXTURE_JSON'
	});
	await expectRejectedCandidate(page, {
		name: 'future.json',
		content: JSON.stringify({ contractVersion: 99 }),
		code: 'UNSUPPORTED_CONTRACT_VERSION'
	});
	await expectRejectedCandidate(page, {
		name: 'invalid-record.json',
		content: JSON.stringify({ contractVersion: 6 }),
		code: 'INVALID_RUN_RECORD'
	});

	await expect(
		page.getByLabel('Current run source').getByText('Local file · local-run.json', { exact: true })
	).toBeVisible();
	await expect(page.getByRole('region', { name: 'Calculated run replay' })).toBeVisible();
});

test('plays a zero-time-loop through its committed prefix and freezes at the boundary', async ({
	page
}) => {
	await page.goto('/');

	const unresolved = makeZeroTimeLoopFixture(await readFile(canonicalFixturePath, 'utf8'));

	await chooseFile(page, {
		name: 'zero-time-loop-run.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(unresolved))
	});

	const prefix = page.getByRole('region', { name: 'Recorded-prefix inspection' });
	await expect(prefix).toBeVisible();
	await expect(prefix.getByText('Recorded prefix only')).toBeVisible();
	await expect(prefix.locator('canvas')).toBeVisible();
	await expect(
		page.getByLabel('Calculation outcome').getByText('The next contact repeats at the boundary.')
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Failure boundary' })).toBeVisible();
	await expect(page.getByText('valid / unresolved', { exact: true })).toBeVisible();
	await expect(page.getByText('Not accepted motion', { exact: true })).toBeVisible();
	await expect(page.getByText('0 s', { exact: true })).toBeVisible();

	const controls = page.getByRole('region', { name: 'Replay controls' });
	await expect(controls.getByRole('button', { name: 'Play' })).toBeEnabled();
	await expect(
		controls.getByRole('slider', { name: 'Seek recorded simulation time' })
	).toBeEnabled();

	await page.getByRole('button', { name: /^Event 1, contact at / }).click();
	await expect(controls.locator('output')).toHaveText('0.386 s / 4.145 s');

	const seek = controls.getByRole('slider', { name: 'Seek recorded simulation time' });
	await seek.evaluate((element) => {
		const input = element as HTMLInputElement;
		input.value = input.max;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await expect(prefix.getByText('ended', { exact: true })).toBeVisible();
});

test('renders and replays an invalid saved prefix as distinct forensic evidence', async ({
	page
}) => {
	await page.goto('/');

	const invalid = makeZeroTimeLoopFixture(await readFile(canonicalFixturePath, 'utf8'));
	invalid.validity = 'invalid';
	invalid.outcome = 'invalid';
	invalid.terminalReason = {
		type: 'invalid-state',
		time: invalid.diagnostics.simulatedUntilTime,
		detail: 'The committed prefix ended at an invalid state.'
	};
	invalid.diagnostics.entries[invalid.diagnostics.entries.length - 1] = {
		severity: 'error',
		code: 'RUN_INVALID',
		message: 'The committed prefix ended at an invalid state.',
		time: invalid.diagnostics.simulatedUntilTime,
		bodyId: 'ball-primary'
	};

	await chooseFile(page, {
		name: 'invalid-partial-run.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(invalid))
	});

	const prefix = page.getByRole('region', { name: 'Invalid-prefix inspection' });
	await expect(prefix).toBeVisible();
	await expect(prefix.locator('canvas')).toBeVisible();
	await expect(prefix.getByText('Invalid committed prefix')).toBeVisible();
	await expect(page.getByText('invalid / invalid', { exact: true })).toBeVisible();
	await expect(
		page
			.getByLabel('Calculation outcome')
			.getByText('The committed prefix ended at an invalid state.')
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
});

test('loads and seeks authoritative sustained circular contact with explicit mode transitions', async ({
	page
}) => {
	const run = constructSingleBallRun(sustainedPegInput());
	const circular = run.trajectories[0]!.segments.find(
		(segment) => segment.type === 'circular-contact'
	);
	if (!circular) throw new Error('Expected the browser fixture to contain circular contact.');

	await page.goto('/');
	await chooseFile(page, {
		name: 'sustained-peg-run.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(run))
	});

	await expect(page.getByText('Loaded sustained-peg-run.json · contract v6')).toBeVisible();
	const entry = page.getByRole('button', { name: /impact to sliding/ });
	const exit = page.getByRole('button', { name: /sliding to free-flight/ });
	await expect(entry).toBeVisible();
	await expect(exit).toBeVisible();
	await entry.click();
	await expect(entry).toHaveAttribute('aria-current', 'true');
	await expect(page.getByText('impact → sliding', { exact: true })).toBeVisible();
	await expect(page.getByText('sliding → free-flight', { exact: true })).toBeVisible();

	const seek = page.getByRole('slider', { name: 'Seek recorded simulation time' });
	await seek.evaluate(
		(element, time) => {
			const input = element as HTMLInputElement;
			input.value = String(time);
			input.dispatchEvent(new Event('input', { bubbles: true }));
		},
		(circular.startTime + circular.endTime) / 2
	);
	await expect(page.locator('canvas')).toBeVisible();
});

interface MutableRunFixture {
	validity: string;
	outcome: string;
	terminalReason: unknown;
	events: Array<{ colliderId: string }>;
	diagnostics: {
		iterations: number;
		simulatedUntilTime: number;
		candidateCount: number;
		contactSearches: unknown[];
		entries: Array<{
			severity: string;
			code: string;
			message: string;
			time: number | null;
			bodyId: string | null;
		}>;
	};
}

function makeZeroTimeLoopFixture(json: string): MutableRunFixture {
	const run = JSON.parse(json) as MutableRunFixture;
	const time = run.diagnostics.simulatedUntilTime;
	const colliderId = run.events.at(-1)!.colliderId;

	run.outcome = 'unresolved';
	run.terminalReason = {
		type: 'zero-time-loop',
		time,
		colliderId,
		detail: 'The next contact repeats at the boundary.'
	};
	run.diagnostics.contactSearches.push({
		searchInterval: [time, time + 1],
		eventTimeTolerance: 1e-9,
		outcome: 'contact',
		reason: null,
		selectedColliderId: colliderId,
		candidates: [
			{
				colliderId,
				feature: 'circle',
				time,
				classification: 'accepted',
				timeDelta: 0,
				position: [0, 0],
				contactPoint: [0, 0],
				normal: [0, 1],
				normalVelocity: 0,
				preContactVelocity: [0, 0],
				postContactVelocity: [0, 0],
				nearSimultaneous: true
			}
		]
	});
	run.diagnostics.iterations += 1;
	run.diagnostics.candidateCount += 1;
	run.diagnostics.entries[run.diagnostics.entries.length - 1] = {
		severity: 'error',
		code: 'RUN_UNRESOLVED',
		message: 'The next contact repeats at the boundary.',
		time,
		bodyId: 'ball-primary'
	};

	return run;
}

async function expectRejectedCandidate(
	page: Page,
	candidate: { readonly name: string; readonly content: string; readonly code: string }
): Promise<void> {
	await chooseFile(page, {
		name: candidate.name,
		mimeType: 'application/json',
		buffer: Buffer.from(candidate.content)
	});

	const alert = page.getByRole('alert');
	await expect(alert).toContainText(candidate.code);
	await expect(alert).toContainText('Current run retained.');
}

async function chooseFile(page: Page, file: FilePayload): Promise<void> {
	const chooserPromise = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Load saved run' }).click();
	const chooser = await chooserPromise;
	await chooser.setFiles(file);
}

async function chooseScenarioFile(page: Page, file: FilePayload): Promise<void> {
	const chooserPromise = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Load scenario' }).click();
	const chooser = await chooserPromise;
	await chooser.setFiles(file);
}

function sustainedPegInput(): SimulationInput {
	return {
		scene: {
			id: 'browser-sustained-contact',
			coordinateSystem: {
				origin: 'centre-bottom',
				horizontalAxis: 'right',
				verticalAxis: 'up',
				lengthUnit: 'metre'
			},
			bounds: { width: 6, height: 4 },
			staticColliders: [
				{
					id: 'peg',
					motionAuthority: 'static',
					physicalShape: { type: 'circle', radius: 0.5 },
					centre: [0, 1]
				}
			],
			terminationRegions: []
		},
		initialDynamicBodies: [
			{
				id: 'ball',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius: 0.1 },
				position: [0.08, 3],
				velocity: [0, 0]
			}
		],
		settings: {
			gravity: [0, -10],
			restitution: 0,
			maximumEvents: 20,
			maximumSimulationTime: 3,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}
