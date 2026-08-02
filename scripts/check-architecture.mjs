import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const documentedSubsystems = new Set([
	'collision',
	'contracts',
	'math',
	'motion',
	'run',
	'serialization',
	'verification',
	'world'
]);

const allowedDependencies = new Map([
	['contracts', new Set()],
	['math', new Set(['contracts'])],
	['motion', new Set(['contracts', 'math'])],
	['collision', new Set(['contracts', 'math', 'motion'])],
	['world', new Set(['contracts'])],
	['run', new Set(['collision', 'contracts', 'math', 'motion', 'world'])],
	['serialization', new Set(['contracts', 'run', 'world'])],
	['verification', new Set(['contracts', 'math', 'motion'])]
]);

const catchAllDirectoryNames = new Set(['common', 'core', 'helpers', 'misc', 'shared', 'utils']);
const productionExtension = /\.(?:[cm]?[jt]s)$/;
const testFileName = /\.(?:spec|test)\.(?:[cm]?[jt]s)$/;

export function checkArchitecture(projectRoot = process.cwd()) {
	const simulationRoot = path.join(projectRoot, 'src', 'lib', 'simulation');
	const issues = [];
	if (!fs.existsSync(simulationRoot)) {
		return [issue('MISSING_SIMULATION_ROOT', simulationRoot, 'Simulation source root is missing.')];
	}

	const sourceFiles = collectProductionFiles(simulationRoot);
	checkTopLevelEntries(simulationRoot, issues);
	checkDirectoryShape(simulationRoot, issues);
	checkEntryPoints(sourceFiles, issues);

	const dependencyGraph = new Map(
		[...documentedSubsystems].map((subsystem) => [subsystem, new Set()])
	);
	for (const file of sourceFiles) {
		checkImports(file, simulationRoot, dependencyGraph, issues);
	}
	checkCircularDependencies(dependencyGraph, simulationRoot, issues);

	return issues.sort(
		(left, right) => left.file.localeCompare(right.file) || left.code.localeCompare(right.code)
	);
}

function checkTopLevelEntries(simulationRoot, issues) {
	for (const entry of fs.readdirSync(simulationRoot, { withFileTypes: true })) {
		const entryPath = path.join(simulationRoot, entry.name);
		if (entry.isDirectory() && !documentedSubsystems.has(entry.name)) {
			issues.push(
				issue(
					'UNDOCUMENTED_SUBSYSTEM',
					entryPath,
					`Top-level simulation directory "${entry.name}" is not a documented subsystem.`
				)
			);
		}
		if (entry.isFile() && isProductionFile(entry.name) && entry.name !== 'index.ts') {
			issues.push(
				issue(
					'ROOT_IMPLEMENTATION',
					entryPath,
					'Production implementation files must belong to a named simulation subsystem.'
				)
			);
		}
	}
}

function checkDirectoryShape(simulationRoot, issues) {
	for (const directory of collectDirectories(simulationRoot)) {
		const name = path.basename(directory);
		if (catchAllDirectoryNames.has(name)) {
			issues.push(
				issue(
					'CATCH_ALL_DIRECTORY',
					directory,
					`Catch-all source directory "${name}" requires an explicit documented exception.`
				)
			);
		}

		const implementationFiles = fs
			.readdirSync(directory, { withFileTypes: true })
			.filter(
				(entry) => entry.isFile() && isProductionFile(entry.name) && entry.name !== 'index.ts'
			);
		if (implementationFiles.length > 8) {
			issues.push(
				issue(
					'DIRECTORY_FILE_LIMIT',
					directory,
					`Directory contains ${implementationFiles.length} production files; the maximum is 8.`
				)
			);
		}
	}
}

function checkEntryPoints(sourceFiles, issues) {
	for (const file of sourceFiles.filter((candidate) => path.basename(candidate) === 'index.ts')) {
		const source = parseSourceFile(file);
		for (const statement of source.statements) {
			if (!isAllowedEntryPointStatement(statement)) {
				issues.push(
					issue(
						'INDEX_LOGIC',
						file,
						'Subsystem entry points may contain only explicit exports and exported type declarations.'
					)
				);
				break;
			}
		}
	}
}

function checkImports(file, simulationRoot, dependencyGraph, issues) {
	const source = parseSourceFile(file);
	const sourceParts = relativeParts(simulationRoot, file);
	const sourceSubsystem = sourceParts[0];
	if (!documentedSubsystems.has(sourceSubsystem)) return;

	for (const statement of source.statements) {
		const specifier = moduleSpecifier(statement);
		if (!specifier) continue;
		const targetParts = resolveSimulationTarget(specifier, file, simulationRoot);
		if (!targetParts || targetParts.length === 0) continue;
		const targetSubsystem = targetParts[0];
		if (!documentedSubsystems.has(targetSubsystem) || targetSubsystem === sourceSubsystem) continue;

		dependencyGraph.get(sourceSubsystem).add(targetSubsystem);
		if (!isSubsystemEntryPoint(targetParts)) {
			issues.push(
				issue(
					'DEEP_IMPORT',
					file,
					`Cross-subsystem import "${specifier}" must use the ${targetSubsystem} entry point.`
				)
			);
		}
		if (!allowedDependencies.get(sourceSubsystem).has(targetSubsystem)) {
			issues.push(
				issue(
					'DEPENDENCY_DIRECTION',
					file,
					`Subsystem ${sourceSubsystem} may not depend on ${targetSubsystem}.`
				)
			);
		}
	}
}

function checkCircularDependencies(graph, simulationRoot, issues) {
	const visiting = new Set();
	const visited = new Set();
	const reported = new Set();

	function visit(subsystem, stack) {
		if (visiting.has(subsystem)) {
			const cycleStart = stack.indexOf(subsystem);
			const cycle = [...stack.slice(cycleStart), subsystem];
			const key = [...new Set(cycle)].sort().join(':');
			if (!reported.has(key)) {
				reported.add(key);
				issues.push(
					issue(
						'CIRCULAR_DEPENDENCY',
						path.join(simulationRoot, subsystem),
						`Circular subsystem dependency detected: ${cycle.join(' -> ')}.`
					)
				);
			}
			return;
		}
		if (visited.has(subsystem)) return;

		visiting.add(subsystem);
		for (const dependency of graph.get(subsystem) ?? []) {
			visit(dependency, [...stack, subsystem]);
		}
		visiting.delete(subsystem);
		visited.add(subsystem);
	}

	for (const subsystem of graph.keys()) visit(subsystem, []);
}

function collectProductionFiles(root) {
	return collectDirectories(root).flatMap((directory) =>
		fs
			.readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isFile() && isProductionFile(entry.name))
			.map((entry) => path.join(directory, entry.name))
	);
}

function collectDirectories(root) {
	const directories = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		directories.push(directory);
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name !== '__tests__') {
				pending.push(path.join(directory, entry.name));
			}
		}
	}
	return directories;
}

function parseSourceFile(file) {
	return ts.createSourceFile(
		file,
		fs.readFileSync(file, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS
	);
}

function isAllowedEntryPointStatement(statement) {
	if (ts.isExportDeclaration(statement)) return statement.exportClause !== undefined;
	if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) return false;
	return (
		statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
	);
}

function moduleSpecifier(statement) {
	if (
		(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
		statement.moduleSpecifier &&
		ts.isStringLiteral(statement.moduleSpecifier)
	) {
		return statement.moduleSpecifier.text;
	}
	return null;
}

function resolveSimulationTarget(specifier, sourceFile, simulationRoot) {
	if (specifier.startsWith('$lib/simulation/')) {
		return cleanTargetParts(specifier.slice('$lib/simulation/'.length).split('/'));
	}
	if (!specifier.startsWith('.')) return null;

	const resolved = path.resolve(path.dirname(sourceFile), specifier);
	const relative = path.relative(simulationRoot, resolved);
	if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
	return cleanTargetParts(relative.split(path.sep));
}

function cleanTargetParts(parts) {
	const cleaned = [...parts];
	const lastIndex = cleaned.length - 1;
	cleaned[lastIndex] = cleaned[lastIndex].replace(/\.(?:[cm]?[jt]s)$/, '');
	return cleaned.filter(Boolean);
}

function isSubsystemEntryPoint(parts) {
	return parts.length === 1 || (parts.length === 2 && parts[1] === 'index');
}

function relativeParts(root, file) {
	return path.relative(root, file).split(path.sep);
}

function isProductionFile(fileName) {
	return (
		productionExtension.test(fileName) &&
		!fileName.endsWith('.d.ts') &&
		!testFileName.test(fileName)
	);
}

function issue(code, file, message) {
	return { code, file: path.normalize(file), message };
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
	const issues = checkArchitecture();
	if (issues.length === 0) {
		console.log('Simulation architecture check passed.');
	} else {
		for (const finding of issues) {
			console.error(
				`${finding.code} ${path.relative(process.cwd(), finding.file)}: ${finding.message}`
			);
		}
		process.exitCode = 1;
	}
}
