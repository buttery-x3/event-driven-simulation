export {
	canonicalBoardDimensions,
	canonicalPegDimensions,
	canonicalPlinkoBoard
} from './canonical-board';
export { prototypeSimulationInput } from './prototype-input';
export {
	boardStateScenarios,
	adversarialScenarios,
	manifoldContactScenarios,
	independentBodySchedulerScenarios,
	dynamicPairScenarios,
	simultaneousImpactScenarios,
	canonicalPlinkoScenarios,
	defaultCanonicalPlinkoScenario,
	type BoardStateScenario,
	type ScenarioCategoryId,
	type ScenarioContactModeTransitionExpectation,
	type ScenarioCoverageId,
	type ScenarioEventExpectation,
	type ScenarioMotionMode,
	type SimulationScenario,
	type VerificationScenario
} from './scenarios';
export {
	assertValidSceneDefinition,
	isStaticCircleCollider,
	SceneValidationError,
	validateSceneDefinition,
	type SceneValidationDiagnostic,
	type SceneValidationDiagnosticCode,
	type SceneValidationResult
} from './scene-validation';
