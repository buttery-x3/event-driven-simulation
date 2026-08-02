import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		files: ['src/lib/simulation/**/*.{js,ts}'],
		ignores: ['src/lib/simulation/**/*.{spec,test}.{js,ts}'],
		rules: {
			'no-restricted-globals': [
				'error',
				...[
					'cancelAnimationFrame',
					'document',
					'Document',
					'fetch',
					'HTMLElement',
					'requestAnimationFrame',
					'ResizeObserver',
					'WebSocket',
					'window',
					'Window',
					'Worker',
					'XMLHttpRequest'
				].map((name) => ({
					name,
					message: 'Simulation code must remain independent of browser and transport APIs.'
				}))
			],
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'svelte',
							message: 'Simulation code must not depend on Svelte.'
						},
						{
							name: 'three',
							message: 'Simulation code must not depend on Three.js.'
						}
					],
					patterns: [
						{
							group: ['svelte/*', 'three/*'],
							message: 'Simulation code must not depend on UI or rendering modules.'
						},
						{
							regex: '^(?:\\$lib/|(?:\\.\\./)+)rendering(?:/|$)',
							message: 'Simulation code must not depend on rendering modules.'
						}
					]
				}
			]
		}
	},
	{
		files: ['src/lib/**/*.{js,ts}'],
		ignores: ['src/lib/**/__tests__/**', 'src/lib/**/*.{spec,test}.{js,ts}'],
		rules: {
			'max-lines': [
				'error',
				{
					max: 500,
					skipBlankLines: true,
					skipComments: true
				}
			],
			'max-lines-per-function': [
				'error',
				{
					max: 200,
					skipBlankLines: true,
					skipComments: true,
					IIFEs: true
				}
			]
		}
	},
	{
		files: ['src/lib/rendering/**/*.{js,ts}'],
		ignores: ['src/lib/rendering/**/*.{spec,test}.{js,ts}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							regex: '^\\$lib/simulation/(?!contracts$|motion$)',
							message:
								'Rendering may consume simulation contracts and the canonical trajectory evaluator, not other simulation implementations.'
						},
						{
							regex: '^(?:\\.\\./)+simulation/(?!contracts(?:\\.ts)?$|motion(?:\\.ts)?$)',
							message:
								'Rendering may consume simulation contracts and the canonical trajectory evaluator, not other simulation implementations.'
						}
					]
				}
			]
		}
	},
	{
		files: ['src/routes/**/*.{js,ts,svelte}', 'src/lib/workbench/**/*.{js,ts,svelte}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							regex:
								'^\\$lib/rendering/(?:playback-admission|playback-clock|recorded-frame)(?:\\.ts)?$',
							message: 'Application routes must use the rendering/playback public entry point.'
						},
						{
							regex: '^\\$lib/simulation/serialization/run-record/.+',
							message: 'Application routes must use the simulation/run-fixture public entry point.'
						}
					]
				}
			]
		}
	}
);
