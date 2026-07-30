export interface Vector3Snapshot {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface SphereBodySnapshot {
	readonly id: string;
	readonly motion: 'dynamic' | 'fixed';
	readonly radius: number;
	readonly position: Vector3Snapshot;
}

export interface SimulationSnapshot {
	readonly time: number;
	readonly bodies: readonly SphereBodySnapshot[];
}

export function createInitialSnapshot(): SimulationSnapshot {
	return {
		time: 0,
		bodies: [
			{
				id: 'ball',
				motion: 'dynamic',
				radius: 0.34,
				position: { x: 0, y: 2.7, z: 0 }
			},
			{
				id: 'peg-left',
				motion: 'fixed',
				radius: 0.2,
				position: { x: -0.8, y: 1.55, z: 0 }
			},
			{
				id: 'peg-centre',
				motion: 'fixed',
				radius: 0.2,
				position: { x: 0, y: 0.75, z: 0 }
			},
			{
				id: 'peg-right',
				motion: 'fixed',
				radius: 0.2,
				position: { x: 0.8, y: 1.55, z: 0 }
			}
		]
	};
}
