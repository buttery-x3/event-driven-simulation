import type { EntityId, SimulationInput, Vec2 } from '$lib/simulation/contracts';

export interface RenderCircle {
	readonly id: EntityId;
	readonly role: 'dynamic-body' | 'fixed-collider';
	readonly centre: Vec2;
	readonly radius: number;
}

export type PhysicalSceneSource = Pick<SimulationInput, 'scene' | 'initialBodies'>;

export function getRenderableCircles(source: PhysicalSceneSource): readonly RenderCircle[] {
	return [
		...source.initialBodies.map((body) => ({
			id: body.id,
			role: 'dynamic-body' as const,
			centre: body.position,
			radius: body.radius
		})),
		...source.scene.fixedCircles.map((collider) => ({
			id: collider.id,
			role: 'fixed-collider' as const,
			centre: collider.centre,
			radius: collider.radius
		}))
	];
}
