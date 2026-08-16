import type { SimulationInput } from '../../contracts';
import { validateSceneDefinition } from '../../world';
import {
	createUnknownDataAssertions,
	invalidSimulationInputField,
	type FieldValidationFailure
} from '../structural-validation';

export function validateSimulationInputV7(
	value: unknown,
	path = '$',
	fail: FieldValidationFailure = invalidSimulationInputField
): SimulationInput {
	const assertions = createUnknownDataAssertions(fail);
	const input = assertions.requireRecord(value, path);
	const sceneValidation = validateSceneDefinition(input.scene, `${path}.scene`);
	if (!sceneValidation.valid) {
		const diagnostic = sceneValidation.diagnostics[0]!;
		fail(diagnostic.path, `${diagnostic.code}: ${diagnostic.message}`);
	}

	const bodies = assertions.requireArray(
		input.initialDynamicBodies,
		`${path}.initialDynamicBodies`
	);
	if (bodies.length === 0) fail(`${path}.initialDynamicBodies`, 'must contain at least one body');
	const seen = new Set<string>();
	const sceneIds = new Set([
		...(input.scene as SimulationInput['scene']).staticColliders.map(({ id }) => id),
		...(input.scene as SimulationInput['scene']).terminationRegions.map(({ id }) => id)
	]);
	for (const [index, body] of bodies.entries()) {
		const bodyPath = `${path}.initialDynamicBodies[${index}]`;
		const record = assertions.requireRecord(body, bodyPath);
		assertions.requireString(record.id, `${bodyPath}.id`);
		const id = record.id as string;
		if (id.trim().length === 0) fail(`${bodyPath}.id`, 'must be non-empty');
		if (seen.has(id) || sceneIds.has(id))
			fail(`${bodyPath}.id`, 'must be unique across world entities');
		seen.add(id);
		assertions.requireLiteral(record.motionAuthority, 'dynamic', `${bodyPath}.motionAuthority`);
		const shape = assertions.requireRecord(record.physicalShape, `${bodyPath}.physicalShape`);
		assertions.requireLiteral(shape.type, 'circle', `${bodyPath}.physicalShape.type`);
		assertions.requireFiniteNumber(shape.radius, `${bodyPath}.physicalShape.radius`);
		if ((shape.radius as number) <= 0) fail(`${bodyPath}.physicalShape.radius`, 'must be positive');
		assertions.requireFiniteNumber(record.mass, `${bodyPath}.mass`);
		if ((record.mass as number) <= 0) fail(`${bodyPath}.mass`, 'must be positive');
		assertions.validateVec2(record.position, `${bodyPath}.position`);
		const [x, y] = record.position as [number, number];
		const bounds = (input.scene as SimulationInput['scene']).bounds;
		if (x < -bounds.width / 2 || x > bounds.width / 2 || y < 0 || y > bounds.height) {
			fail(`${bodyPath}.position`, 'must lie inside the supported scene bounds');
		}
		assertions.validateVec2(record.velocity, `${bodyPath}.velocity`);
		assertions.requireFiniteNumber(record.releaseTime, `${bodyPath}.releaseTime`);
		if ((record.releaseTime as number) < 0) fail(`${bodyPath}.releaseTime`, 'must be non-negative');
	}

	const settings = assertions.requireRecord(input.settings, `${path}.settings`);
	assertions.validateVec2(settings.gravity, `${path}.settings.gravity`);
	assertions.requireFiniteNumber(settings.restitution, `${path}.settings.restitution`);
	if ((settings.restitution as number) < 0 || (settings.restitution as number) > 1) {
		fail(`${path}.settings.restitution`, 'must be between zero and one');
	}
	const contactCaptureDistance =
		settings.contactCaptureDistance === undefined
			? undefined
			: assertions.requireFiniteNumber(
					settings.contactCaptureDistance,
					`${path}.settings.contactCaptureDistance`
				);
	if (contactCaptureDistance !== undefined && contactCaptureDistance < 0) {
		fail(`${path}.settings.contactCaptureDistance`, 'must be non-negative');
	}
	assertions.requireInteger(settings.maximumEvents, `${path}.settings.maximumEvents`);
	if ((settings.maximumEvents as number) < 0)
		fail(`${path}.settings.maximumEvents`, 'must be non-negative');
	assertions.requireFiniteNumber(
		settings.maximumSimulationTime,
		`${path}.settings.maximumSimulationTime`
	);
	if ((settings.maximumSimulationTime as number) <= 0) {
		fail(`${path}.settings.maximumSimulationTime`, 'must be positive');
	}
	const tolerances = assertions.requireRecord(settings.tolerances, `${path}.settings.tolerances`);
	assertions.requireFiniteNumber(
		tolerances.contactDistance,
		`${path}.settings.tolerances.contactDistance`
	);
	assertions.requireFiniteNumber(tolerances.eventTime, `${path}.settings.tolerances.eventTime`);
	if ((tolerances.contactDistance as number) <= 0 || (tolerances.eventTime as number) <= 0) {
		fail(`${path}.settings.tolerances`, 'must contain positive tolerances');
	}

	const typed = {
		...(value as Omit<SimulationInput, 'settings'>),
		settings: {
			...(settings as unknown as SimulationInput['settings']),
			contactCaptureDistance: contactCaptureDistance ?? (tolerances.contactDistance as number)
		}
	} satisfies SimulationInput;
	validateDeclaredReleaseStates(typed, path, fail);
	return typed;
}

function validateDeclaredReleaseStates(
	input: SimulationInput,
	path: string,
	fail: FieldValidationFailure
): void {
	const tolerance = input.settings.tolerances.contactDistance;
	for (const [index, body] of input.initialDynamicBodies.entries()) {
		for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
			const other = input.initialDynamicBodies[otherIndex]!;
			if (other.releaseTime !== body.releaseTime) continue;
			const distance = Math.hypot(
				body.position[0] - other.position[0],
				body.position[1] - other.position[1]
			);
			if (distance < body.physicalShape.radius + other.physicalShape.radius - tolerance) {
				fail(
					`${path}.initialDynamicBodies[${index}].position`,
					`must not overlap body ${JSON.stringify(other.id)} at their common release time`
				);
			}
		}
	}
}
