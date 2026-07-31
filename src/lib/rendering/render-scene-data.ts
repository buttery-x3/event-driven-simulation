import type { EntityId, SimulationInput, Vec2 } from '$lib/simulation/contracts';

type RenderVec3 = readonly [x: number, y: number, z: number];

interface RenderObjectBase {
	readonly id: EntityId;
	readonly centre: Vec2;
	readonly radius: number;
}

export interface RenderSphere extends RenderObjectBase {
	readonly motionAuthority: 'dynamic';
	readonly representation: 'sphere';
	readonly material: 'dynamic-body';
}

export interface RenderCylinder extends RenderObjectBase {
	readonly motionAuthority: 'static';
	readonly representation: 'cylinder';
	readonly material: 'fixed-peg';
	readonly depth: number;
	readonly orientation: RenderVec3;
}

export type RenderSceneObject = RenderSphere | RenderCylinder;

export interface RenderSceneViewModel {
	readonly objects: readonly RenderSceneObject[];
}

export type PhysicalSceneSource = Pick<SimulationInput, 'scene' | 'initialDynamicBodies'>;

const fixedCirclePresentation = {
	depth: 0.32,
	orientation: [Math.PI / 2, 0, 0] as const
} as const;

export function toRenderSceneViewModel(source: PhysicalSceneSource): RenderSceneViewModel {
	return {
		objects: [
			...source.initialDynamicBodies.map((body) => ({
				id: body.id,
				motionAuthority: body.motionAuthority,
				representation: 'sphere' as const,
				material: 'dynamic-body' as const,
				centre: body.position,
				radius: body.physicalShape.radius
			})),
			...source.scene.staticColliders.map((collider) => ({
				id: collider.id,
				motionAuthority: collider.motionAuthority,
				representation: 'cylinder' as const,
				material: 'fixed-peg' as const,
				centre: collider.centre,
				radius: collider.physicalShape.radius,
				depth: fixedCirclePresentation.depth,
				orientation: fixedCirclePresentation.orientation
			}))
		]
	};
}
