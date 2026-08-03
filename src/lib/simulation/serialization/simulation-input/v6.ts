import type { InitialDynamicCircleBodyState, SimulationInput } from '../../contracts';
import { validateSceneDefinition } from '../../world';
import {
	createUnknownDataAssertions,
	invalidSimulationInputField,
	type FieldValidationFailure
} from '../structural-validation';

export type LegacySimulationInputV6 = Omit<SimulationInput, 'initialDynamicBodies'> & {
	readonly initialDynamicBodies: readonly Omit<
		InitialDynamicCircleBodyState,
		'mass' | 'releaseTime'
	>[];
};

export function validateSimulationInputV6(
	value: unknown,
	path = '$',
	fail: FieldValidationFailure = invalidSimulationInputField
): LegacySimulationInputV6 {
	const {
		requireArray,
		requireFiniteNumber,
		requireInteger,
		requireLiteral,
		requireRecord,
		requireString,
		validateVec2
	} = createUnknownDataAssertions(fail);
	const input = requireRecord(value, path);
	const sceneValidation = validateSceneDefinition(input.scene, `${path}.scene`);

	if (!sceneValidation.valid) {
		const diagnostic = sceneValidation.diagnostics[0]!;
		fail(diagnostic.path, `${diagnostic.code}: ${diagnostic.message}`);
	}

	requireArray(input.initialDynamicBodies, `${path}.initialDynamicBodies`).forEach(
		(body, index) => {
			const bodyPath = `${path}.initialDynamicBodies[${index}]`;
			const record = requireRecord(body, bodyPath);

			requireString(record.id, `${bodyPath}.id`);
			requireLiteral(record.motionAuthority, 'dynamic', `${bodyPath}.motionAuthority`);
			validateCirclePhysicalShape(record.physicalShape, `${bodyPath}.physicalShape`, fail);
			validateVec2(record.position, `${bodyPath}.position`);
			validateVec2(record.velocity, `${bodyPath}.velocity`);
		}
	);

	const settings = requireRecord(input.settings, `${path}.settings`);
	validateVec2(settings.gravity, `${path}.settings.gravity`);
	requireFiniteNumber(settings.restitution, `${path}.settings.restitution`);
	requireInteger(settings.maximumEvents, `${path}.settings.maximumEvents`);
	requireFiniteNumber(settings.maximumSimulationTime, `${path}.settings.maximumSimulationTime`);

	const tolerances = requireRecord(settings.tolerances, `${path}.settings.tolerances`);
	requireFiniteNumber(tolerances.contactDistance, `${path}.settings.tolerances.contactDistance`);
	requireFiniteNumber(tolerances.eventTime, `${path}.settings.tolerances.eventTime`);

	return value as LegacySimulationInputV6;
}

function validateCirclePhysicalShape(
	value: unknown,
	path: string,
	fail: FieldValidationFailure
): void {
	const { requireFiniteNumber, requireLiteral, requireRecord } = createUnknownDataAssertions(fail);
	const shape = requireRecord(value, path);

	requireLiteral(shape.type, 'circle', `${path}.type`);
	requireFiniteNumber(shape.radius, `${path}.radius`);
}
