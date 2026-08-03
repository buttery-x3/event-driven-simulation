import type { CirclePhysicalShape, EntityId, SceneDefinition, Vec2 } from './geometry';

export interface InitialDynamicCircleBodyState {
	readonly id: EntityId;
	readonly motionAuthority: 'dynamic';
	readonly physicalShape: CirclePhysicalShape;
	readonly mass: number;
	readonly position: Vec2;
	readonly velocity: Vec2;
	readonly releaseTime: number;
}

export interface SimulationTolerances {
	readonly contactDistance: number;
	readonly eventTime: number;
}

export interface SimulationSettings {
	readonly gravity: Vec2;
	readonly restitution: number;
	readonly maximumEvents: number;
	readonly maximumSimulationTime: number;
	readonly tolerances: SimulationTolerances;
}

export interface SimulationInput {
	readonly scene: SceneDefinition;
	readonly initialDynamicBodies: readonly InitialDynamicCircleBodyState[];
	readonly settings: SimulationSettings;
}
