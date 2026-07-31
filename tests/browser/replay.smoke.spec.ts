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
		page.getByText('Loaded local-run.json · contract v4', { exact: true })
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
		content: JSON.stringify({ contractVersion: 4 }),
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
		terminalReason: unknown;
	};
	unresolved.terminalReason = {
		type: 'unresolved-collision-search',
		time: 0,
		detail: 'The solver retained a validated prefix for inspection.'
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
		page.getByText('The solver retained a validated prefix for inspection.')
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
