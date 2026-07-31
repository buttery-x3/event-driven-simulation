import type {
	AxisAlignedTerminationRegion,
	EntityId,
	SimulationInput,
	StaticCollider,
	Vec2
} from '$lib/simulation/contracts';

type RenderVec3 = readonly [x: number, y: number, z: number];
type RenderSize2 = readonly [width: number, height: number];
type RenderSize3 = readonly [width: number, height: number, depth: number];

interface RenderObjectBase {
	readonly id: EntityId;
	readonly centre: Vec2;
	readonly z: number;
	readonly orientation: RenderVec3;
	readonly motionAuthority: 'static' | 'dynamic';
}

export interface RenderSphere extends RenderObjectBase {
	readonly motionAuthority: 'dynamic';
	readonly representation: 'sphere';
	readonly material: 'dynamic-body';
	readonly radius: number;
}

export interface RenderCylinder extends RenderObjectBase {
	readonly motionAuthority: 'static';
	readonly representation: 'cylinder';
	readonly material: 'fixed-peg';
	readonly radius: number;
	readonly depth: number;
}

export interface RenderBox extends RenderObjectBase {
	readonly motionAuthority: 'static';
	readonly representation: 'box';
	readonly material: 'fixed-boundary';
	readonly size: RenderSize3;
}

export interface RenderPlane extends RenderObjectBase {
	readonly motionAuthority: 'static';
	readonly representation: 'plane';
	readonly material: 'termination-region';
	readonly size: RenderSize2;
}

export type RenderSceneObject = RenderSphere | RenderCylinder | RenderBox | RenderPlane;

export interface RenderBoard {
	readonly centre: Vec2;
	readonly size: RenderSize3;
}

export interface RenderSceneViewModel {
	readonly board: RenderBoard;
	readonly objects: readonly RenderSceneObject[];
}

export type PhysicalSceneSource = Pick<SimulationInput, 'scene' | 'initialDynamicBodies'>;

const fixedCirclePresentation = {
	depth: 0.32,
	orientation: [Math.PI / 2, 0, 0] as const
} as const;

const fixedSegmentPresentation = {
	thickness: 0.08,
	depth: 0.24
} as const;

const boardPresentation = {
	depth: 0.3
} as const;

export function toRenderSceneViewModel(source: PhysicalSceneSource): RenderSceneViewModel {
	return {
		board: {
			centre: [0, source.scene.bounds.height / 2],
			size: [source.scene.bounds.width, source.scene.bounds.height, boardPresentation.depth]
		},
		objects: [
			...source.initialDynamicBodies.map((body) => ({
				id: body.id,
				motionAuthority: body.motionAuthority,
				representation: 'sphere' as const,
				material: 'dynamic-body' as const,
				centre: body.position,
				z: 0,
				orientation: [0, 0, 0] as const,
				radius: body.physicalShape.radius
			})),
			...source.scene.staticColliders.map(toRenderCollider),
			...source.scene.terminationRegions.map(toRenderTerminationRegion)
		]
	};
}

function toRenderCollider(collider: StaticCollider): RenderCylinder | RenderBox {
	switch (collider.physicalShape.type) {
		case 'circle': {
			if (!('centre' in collider)) {
				throw new Error(`Circle collider ${collider.id} does not define a centre.`);
			}
			return {
				id: collider.id,
				motionAuthority: collider.motionAuthority,
				representation: 'cylinder',
				material: 'fixed-peg',
				centre: collider.centre,
				z: 0,
				radius: collider.physicalShape.radius,
				depth: fixedCirclePresentation.depth,
				orientation: fixedCirclePresentation.orientation
			};
		}
		case 'line-segment': {
			const [startX, startY] = collider.physicalShape.start;
			const [endX, endY] = collider.physicalShape.end;
			const deltaX = endX - startX;
			const deltaY = endY - startY;

			return {
				id: collider.id,
				motionAuthority: collider.motionAuthority,
				representation: 'box',
				material: 'fixed-boundary',
				centre: [(startX + endX) / 2, (startY + endY) / 2],
				z: 0,
				size: [
					Math.hypot(deltaX, deltaY),
					fixedSegmentPresentation.thickness,
					fixedSegmentPresentation.depth
				],
				orientation: [0, 0, Math.atan2(deltaY, deltaX)]
			};
		}
	}
}

function toRenderTerminationRegion(region: AxisAlignedTerminationRegion): RenderPlane {
	const width = region.maximum[0] - region.minimum[0];
	const height = region.maximum[1] - region.minimum[1];

	return {
		id: region.id,
		motionAuthority: 'static',
		representation: 'plane',
		material: 'termination-region',
		centre: [region.minimum[0] + width / 2, region.minimum[1] + height / 2],
		z: -0.08,
		size: [width, height],
		orientation: [0, 0, 0]
	};
}
