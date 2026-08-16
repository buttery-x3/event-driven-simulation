import type {
	BodyRunState,
	InitialDynamicCircleBodyState,
	MotionSegment,
	SimulationInput,
	SimulationRunRecord
} from '$lib/simulation/contracts';

export const syntheticSettings = {
	gravity: [0, 0],
	restitution: 1,
	contactCaptureDistance: 1e-9,
	maximumEvents: 100,
	maximumSimulationTime: 8,
	tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
} as const;

export const syntheticScene = {
	id: 'synthetic-multi-body-workbench',
	coordinateSystem: {
		origin: 'centre-bottom',
		horizontalAxis: 'right',
		verticalAxis: 'up',
		lengthUnit: 'metre'
	},
	bounds: { width: 24, height: 12 },
	staticColliders: [
		{
			id: 'floor',
			motionAuthority: 'static',
			physicalShape: { type: 'line-segment', start: [-12, 0], end: [12, 0] }
		}
	],
	terminationRegions: []
} as const;

export function syntheticBody(
	id: string,
	position: readonly [number, number],
	velocity: readonly [number, number] = [0, 0],
	releaseTime = 0,
	overrides: { readonly mass?: number; readonly radius?: number } = {}
): InitialDynamicCircleBodyState {
	return {
		id,
		motionAuthority: 'dynamic',
		physicalShape: { type: 'circle', radius: overrides.radius ?? 0.25 },
		mass: overrides.mass ?? 1,
		position,
		velocity,
		releaseTime
	};
}

export function flight(
	body: InitialDynamicCircleBodyState,
	startTime: number,
	endTime: number,
	startPosition = body.position,
	startVelocity = body.velocity
): MotionSegment {
	return {
		type: 'free-flight',
		bodyId: body.id,
		startTime,
		endTime,
		startPosition,
		startVelocity,
		acceleration: [0, 0]
	};
}

export function stationary(
	body: InitialDynamicCircleBodyState,
	endTime: number,
	componentId: string
): MotionSegment {
	return {
		type: 'stationary',
		bodyId: body.id,
		startTime: body.releaseTime,
		endTime,
		startPosition: body.position,
		startVelocity: [0, 0],
		reason: 'dormant-component',
		componentId
	};
}

export function releasedState(
	body: InitialDynamicCircleBodyState,
	horizon: number,
	lifecycle: 'active' | 'resting' = 'active'
): BodyRunState {
	return {
		bodyId: body.id,
		lifecycle,
		releaseTime: body.releaseTime,
		activeFromTime: body.releaseTime,
		recordedUntilTime: horizon,
		terminalOutcome: null
	};
}

export function terminalState(
	body: InitialDynamicCircleBodyState,
	recordedUntilTime: number,
	lifecycle: 'completed' | 'escaped' | 'invalid' | 'unresolved'
): BodyRunState {
	return {
		bodyId: body.id,
		lifecycle,
		releaseTime: body.releaseTime,
		activeFromTime: body.releaseTime,
		recordedUntilTime,
		terminalOutcome: lifecycle
	};
}

export function releaseEvent(body: InitialDynamicCircleBodyState) {
	return {
		type: 'body-release' as const,
		time: body.releaseTime,
		bodyId: body.id,
		position: body.position,
		velocity: body.velocity,
		status: 'released' as const,
		reason: null
	};
}

type SyntheticRunOverrides = Partial<
	Pick<
		SimulationRunRecord,
		| 'validity'
		| 'outcome'
		| 'terminalReason'
		| 'events'
		| 'dynamicContacts'
		| 'contactComponents'
		| 'componentEvents'
	>
> & {
	readonly bodyEventHorizons?: SimulationRunRecord['diagnostics']['bodyEventHorizons'];
	readonly pairPredictions?: SimulationRunRecord['diagnostics']['pairPredictions'];
	readonly diagnosticEntries?: SimulationRunRecord['diagnostics']['entries'];
};

export function syntheticRun(
	bodies: readonly InitialDynamicCircleBodyState[],
	bodyStates: readonly BodyRunState[],
	trajectories: SimulationRunRecord['trajectories'],
	horizon: number,
	overrides: SyntheticRunOverrides = {}
): SimulationRunRecord {
	const outcome = overrides.outcome ?? 'time-limit';
	const terminalReason =
		overrides.terminalReason ?? ({ type: 'time-limit', time: horizon, limit: horizon } as const);
	const input: SimulationInput = {
		scene: syntheticScene,
		initialDynamicBodies: bodies,
		settings: { ...syntheticSettings, maximumSimulationTime: horizon }
	};
	const events = overrides.events ?? [];
	const diagnosticEntries =
		overrides.diagnosticEntries ??
		([
			{
				severity: outcome === 'unresolved' ? 'error' : 'warning',
				code: outcome === 'unresolved' ? 'RUN_UNRESOLVED' : 'RUN_TIME_LIMIT',
				message: 'Synthetic contract evidence; no production multi-body solver was invoked.',
				time: horizon,
				bodyId: null
			}
		] as const);

	return {
		contractVersion: 7,
		input,
		validity: overrides.validity ?? 'valid',
		outcome,
		terminalReason,
		bodyStates,
		trajectories,
		events,
		releases: bodies.filter((body) => body.releaseTime <= horizon).map(releaseEvent),
		dynamicContacts: overrides.dynamicContacts ?? [],
		contactComponents: overrides.contactComponents ?? [],
		componentEvents: overrides.componentEvents ?? [],
		diagnostics: {
			iterations: 0,
			simulatedUntilTime: horizon,
			eventCount: events.length,
			candidateCount: 0,
			segmentCount: trajectories.reduce(
				(total, trajectory) => total + trajectory.segments.length,
				0
			),
			simulationWallTimeMilliseconds: 0,
			contactSearches: [],
			bodyEventHorizons: overrides.bodyEventHorizons ?? [],
			pairPredictions: overrides.pairPredictions ?? [],
			entries: diagnosticEntries
		}
	};
}
