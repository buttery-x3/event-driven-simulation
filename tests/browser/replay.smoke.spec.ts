import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

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
			name: 'A canonical Plinko board replaying recorded ball trajectory data'
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
		page.getByText('Loaded local-run.json · contract v5', { exact: true })
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
		content: JSON.stringify({ contractVersion: 5 }),
		code: 'INVALID_RUN_RECORD'
	});

	await expect(
		page.getByLabel('Current run source').getByText('Local file · local-run.json', { exact: true })
	).toBeVisible();
	await expect(page.getByRole('region', { name: 'Calculated run replay' })).toBeVisible();
});

test('keeps a failed calculation distinct while exposing its recorded prefix', async ({ page }) => {
	await page.goto('/');

	const unresolved = JSON.parse(await readFile(canonicalFixturePath, 'utf8')) as {
		outcome: string;
		terminalReason: unknown;
		diagnostics: {
			simulatedUntilTime: number;
			entries: Array<{
				severity: string;
				code: string;
				message: string;
				time: number | null;
				bodyId: string | null;
			}>;
		};
	};
	unresolved.outcome = 'unresolved';
	unresolved.terminalReason = {
		type: 'unresolved-collision-search',
		time: unresolved.diagnostics.simulatedUntilTime,
		detail: 'The solver retained a validated prefix for inspection.'
	};
	unresolved.diagnostics.entries[unresolved.diagnostics.entries.length - 1] = {
		severity: 'error',
		code: 'RUN_UNRESOLVED',
		message: 'The solver retained a validated prefix for inspection.',
		time: unresolved.diagnostics.simulatedUntilTime,
		bodyId: 'ball-primary'
	};

	await chooseFile(page, {
		name: 'unresolved-run.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(unresolved))
	});

	const prefix = page.getByRole('region', { name: 'Recorded-prefix inspection' });
	await expect(prefix).toBeVisible();
	await expect(prefix.getByText('Recorded prefix only')).toBeVisible();
	await expect(
		page
			.getByLabel('Run inspector')
			.getByText('The solver retained a validated prefix for inspection.')
	).toBeVisible();

	const controls = page.getByRole('region', { name: 'Replay controls' });
	await expect(controls.getByRole('button', { name: 'Play' })).toBeDisabled();
	await expect(
		controls.getByRole('slider', { name: 'Seek recorded simulation time' })
	).toBeEnabled();

	await page.getByRole('button', { name: /^Event 1, contact at / }).click();
	await expect(controls.locator('output')).toHaveText('0.386 s / 4.145 s');
});

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
