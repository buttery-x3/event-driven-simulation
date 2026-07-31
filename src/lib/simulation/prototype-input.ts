import type { SimulationInput } from './contracts';

export const prototypeSimulationInput = {
	scene: {
		id: 'prototype-scene',
		staticColliders: [
			{
				id: 'peg-left',
				motionAuthority: 'static',
				physicalShape: { type: 'circle', radius: 0.2 },
				centre: [-0.8, 1.55]
			},
			{
				id: 'peg-centre',
				motionAuthority: 'static',
				physicalShape: { type: 'circle', radius: 0.2 },
				centre: [0, 0.75]
			},
			{
				id: 'peg-right',
				motionAuthority: 'static',
				physicalShape: { type: 'circle', radius: 0.2 },
				centre: [0.8, 1.55]
			}
		]
	},
	initialDynamicBodies: [
		{
			id: 'ball',
			motionAuthority: 'dynamic',
			physicalShape: { type: 'circle', radius: 0.34 },
			position: [0, 2.7],
			velocity: [0, 0]
		}
	],
	settings: {
		gravity: [0, -9.81],
		restitution: 0.8,
		maximumEvents: 1_000,
		maximumSimulationTime: 1,
		tolerances: {
			contactDistance: 1e-9,
			eventTime: 1e-9
		}
	}
} as const satisfies SimulationInput;
