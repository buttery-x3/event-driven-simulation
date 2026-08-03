export type EntityId = string;

export type Vec2 = readonly [x: number, y: number];

export interface CirclePhysicalShape {
	readonly type: 'circle';
	readonly radius: number;
}

export interface LineSegmentPhysicalShape {
	readonly type: 'line-segment';
	readonly start: Vec2;
	readonly end: Vec2;
}

export interface StaticCircleCollider {
	readonly id: EntityId;
	readonly motionAuthority: 'static';
	readonly physicalShape: CirclePhysicalShape;
	readonly centre: Vec2;
}

export interface StaticLineSegmentCollider {
	readonly id: EntityId;
	readonly motionAuthority: 'static';
	readonly physicalShape: LineSegmentPhysicalShape;
}

export type StaticCollider = StaticCircleCollider | StaticLineSegmentCollider;

export interface BoardCoordinateSystem {
	readonly origin: 'centre-bottom';
	readonly horizontalAxis: 'right';
	readonly verticalAxis: 'up';
	readonly lengthUnit: 'metre';
}

export interface BoardBounds {
	readonly width: number;
	readonly height: number;
}

export interface AxisAlignedTerminationRegion {
	readonly id: EntityId;
	readonly type: 'axis-aligned-box';
	readonly purpose: 'complete' | 'escape';
	readonly minimum: Vec2;
	readonly maximum: Vec2;
}

export interface SceneDefinition {
	readonly id: string;
	readonly coordinateSystem: BoardCoordinateSystem;
	readonly bounds: BoardBounds;
	readonly staticColliders: readonly StaticCollider[];
	readonly terminationRegions: readonly AxisAlignedTerminationRegion[];
}
