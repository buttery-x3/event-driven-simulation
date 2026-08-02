export { boardStateScenarios, type BoardStateScenario } from './board-state-scenarios';
export {
	canonicalBoardDimensions,
	canonicalPegDimensions,
	canonicalPlinkoBoard
} from './canonical-board';
export { prototypeSimulationInput } from './prototype-input';
export {
	canonicalPlinkoScenarios,
	defaultCanonicalPlinkoScenario,
	type SimulationScenario
} from './scenario-catalogue';
export {
	assertValidSceneDefinition,
	isStaticCircleCollider,
	SceneValidationError,
	validateSceneDefinition,
	type SceneValidationDiagnostic,
	type SceneValidationDiagnosticCode,
	type SceneValidationResult
} from './scene-validation';
