import { expect, test } from '@playwright/test';

test('loads the replay and can begin playback', async ({ page }) => {
	await page.goto('/');

	await expect(
		page.getByRole('heading', { level: 1, name: 'Motion, one recorded segment at a time.' })
	).toBeVisible();

	const replay = page.getByRole('region', { name: 'Trajectory playback' });
	await expect(replay).toBeVisible();
	await expect(
		replay.getByRole('img', {
			name: 'A ball replaying a completed trajectory past fixed pegs'
		})
	).toBeVisible();
	await expect(replay.locator('canvas')).toBeVisible();

	const playButton = replay.getByRole('button', { name: /^(Play|Pause)$/ });
	await playButton.click();
	if ((await playButton.textContent()) === 'Play') {
		await playButton.click();
	}

	await expect(playButton).toHaveText('Pause');
	await expect(replay.getByText('Playing', { exact: true })).toBeVisible();
	await expect(
		replay.getByRole('slider', { name: 'Seek through completed trajectory' })
	).toBeEnabled();
});
