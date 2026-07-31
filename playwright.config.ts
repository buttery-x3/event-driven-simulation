import { defineConfig, devices } from '@playwright/test';

const browserTestUrl = 'http://127.0.0.1:8439';

export default defineConfig({
	testDir: './tests/browser',
	fullyParallel: true,
	forbidOnly: true,
	reporter: 'list',
	use: {
		baseURL: browserTestUrl,
		launchOptions: {
			args: ['--disable-features=NetworkServiceSandbox']
		},
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: 'npm run build && vite preview --host 127.0.0.1 --port 8439 --strictPort',
		url: browserTestUrl,
		reuseExistingServer: false,
		stdout: 'pipe',
		timeout: 120_000
	}
});
