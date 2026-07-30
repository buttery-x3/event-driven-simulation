import type { SimulationInput } from './contracts';

export const prototypeSimulationInput = {
	scene: {
		id: 'prototype-scene',
		fixedCircles: [
			{ id: 'peg-left', centre: [-0.8, 1.55], radius: 0.2 },
			{ id: 'peg-centre', centre: [0, 0.75], radius: 0.2 },
			{ id: 'peg-right', centre: [0.8, 1.55], radius: 0.2 }
		]
	},
	initialBodies: [
		{
			id: 'ball',
			position: [0, 2.7],
			velocity: [0, 0],
			radius: 0.34
		}
	],
	settings: {
		gravity: [0, -9.81],
		restitution: 0.8,
		maximumEvents: 1_000,
		maximumSimulationTime: 30,
		tolerances: {
			contactDistance: 1e-9,
			eventTime: 1e-9
		}
	}
} as const satisfies SimulationInput;
