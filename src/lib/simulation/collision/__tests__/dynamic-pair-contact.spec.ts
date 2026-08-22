import { describe, expect, it } from 'vitest';
import type { MotionSegment, Vec2 } from '../../contracts';
import {
	buildDynamicPairContactPolynomial,
	findEarliestDynamicPairContact,
	type DynamicCirclePathParticipant,
	type DynamicPairContactQuery
} from '../dynamic-pair';

describe('continuous dynamic circle-path contact solving', () => {
	it('finds the earliest head-on contact from relative path roots', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [-2, 0], [1, 0]), path('b', [2, 0], [-1, 0]))
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(1.5, 10);
		expect(result.state.normalFromFirstToSecond).toEqual([1, 0]);
		expect(result.state.relativeVelocity).toEqual([-2, 0]);
		expect(result.state.relativeNormalMotion).toBe(-2);
		expect(result.diagnostics.polynomialDegree).toBe(2);
		expect(result.diagnostics.candidates[0]).toMatchObject({
			topology: 'entering',
			classification: 'accepted-impact'
		});
	});

	it('preserves roots, time and classification when participant order is swapped', () => {
		const forward = findEarliestDynamicPairContact(
			query(path('a', [-2, -0.2], [1, 0]), path('b', [2, 0.2], [-1, 0]))
		);
		const swapped = findEarliestDynamicPairContact(
			query(path('b', [2, 0.2], [-1, 0]), path('a', [-2, -0.2], [1, 0]))
		);

		expect(forward.type).toBe('contact');
		expect(swapped.type).toBe('contact');
		if (forward.type !== 'contact' || swapped.type !== 'contact') return;
		expect(swapped.state.time).toBeCloseTo(forward.state.time, 12);
		expect(swapped.state.response).toBe(forward.state.response);
		expect(swapped.diagnostics.isolatedRoots).toEqual(forward.diagnostics.isolatedRoots);
		expect(swapped.diagnostics.polynomialCoefficients).toEqual(
			forward.diagnostics.polynomialCoefficients
		);
		expect(swapped.state.normalFromFirstToSecond[0]).toBeCloseTo(
			-forward.state.normalFromFirstToSecond[0],
			12
		);
		expect(swapped.state.normalFromFirstToSecond[1]).toBeCloseTo(
			-forward.state.normalFromFirstToSecond[1],
			12
		);
	});

	it('constructs swap-invariant relative polynomial coefficients directly', () => {
		const first = participant(path('a', [-1, 2], [3, -1], [0, -9.81]));
		const second = participant(path('b', [4, 3], [-2, 2], [1, -4]));
		const forward = buildDynamicPairContactPolynomial(first, second, 0.25, 2.5);
		const swapped = buildDynamicPairContactPolynomial(second, first, 0.25, 2.5);

		expect(swapped.polynomialCoefficients).toEqual(forward.polynomialCoefficients);
		expect(swapped.relativeCoefficients).toEqual(
			forward.relativeCoefficients.map(([x, y]) => [-x, -y])
		);
	});

	it('reduces equal-gravity free-flight paths to a quadratic equation', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [-2, 3], [1, 0], [0, -9.81]), path('b', [2, 3], [-1, 0], [0, -9.81]))
		);

		expect(result.diagnostics.polynomialDegree).toBe(2);
		expect(result.diagnostics.normalizedPolynomialCoefficients).toHaveLength(3);
		expect(result.type).toBe('contact');
	});

	it('finds a mixed free-flight and linear-contact path root', () => {
		const result = findEarliestDynamicPairContact(
			query(
				path('free', [-2, 1], [1.5, -0.5], [0, -1]),
				path('supported', [1, 0], [-0.25, 0], [0, 0], 'linear-contact')
			)
		);

		expect(result.type).toBe('contact');
		expect(result.diagnostics.pathTypes).toEqual(['free-flight', 'linear-contact']);
		expect(result.diagnostics.polynomialDegree).toBe(4);
	});

	it('reports no contact for a close dynamic near miss', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [-2, -0.51], [1, 0]), path('b', [2, 0.51], [-1, 0]))
		);

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.candidates).toEqual([]);
	});

	it('rejects an external grazing root instead of promoting it to impact', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [-2, 1], [1, 0]), path('b', [0, 0], [0, 0]))
		);

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.candidates[0]).toMatchObject({
			topology: 'grazing',
			classification: 'rejected-grazing'
		});
	});

	it('supports a moving path against a stationary recorded path', () => {
		const stationary = {
			type: 'stationary',
			bodyId: 'resting',
			startTime: 0,
			endTime: 5,
			startPosition: [0, 0],
			startVelocity: [0, 0],
			reason: 'resting-contact',
			componentId: null
		} as const;
		const result = findEarliestDynamicPairContact(
			query(path('moving', [-2, 0], [1, 0], [0, 0], 'free-flight', 0, 5), stationary)
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(1, 12);
		expect(result.diagnostics.pathTypes).toEqual(['free-flight', 'stationary']);
	});

	it('isolates free-flight contact against a circular sustained path without stepping', () => {
		const circular = circularPath('slider', [0, 0], 2, 0, Math.PI / 2, 1);
		const target: Vec2 = [Math.SQRT1_2, 3 * Math.SQRT1_2];
		const free = path('free', target, [0, 0], [0, 0], 'free-flight', 0, Math.PI);
		const result = findEarliestDynamicPairContact({
			first: { ...participant(circular), radius: 0.5 },
			second: { ...participant(free), radius: 0.5 },
			currentTime: 0
		});

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(Math.PI / 2, 7);
		expect(result.state.relativeNormalMotion).toBeLessThan(-0.99);
		expect(result.diagnostics.pathTypes).toEqual(['circular-contact', 'free-flight']);
		expect(result.diagnostics.candidates[0]?.source).toBe('bounded-interval');
	});

	it('isolates linear fixed-world contact against a circular sustained path', () => {
		const circular = circularPath('circular', [0, 0], 2, 0, Math.PI / 2, 1);
		const target: Vec2 = [Math.SQRT1_2, 3 * Math.SQRT1_2];
		const linear = path('linear', target, [0, 0], [0, 0], 'linear-contact', 0, Math.PI);
		const result = findEarliestDynamicPairContact({
			first: participant(circular),
			second: participant(linear),
			currentTime: 0
		});

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(Math.PI / 2, 7);
		expect(result.diagnostics.searchInterval).toEqual([0, Math.PI]);
	});

	it('certifies separated circular paths over their common bounded horizon', () => {
		const result = findEarliestDynamicPairContact({
			first: participant(circularPath('first', [-5, 0], 1, 0, Math.PI / 2, 1)),
			second: participant(circularPath('second', [5, 0], 1, Math.PI, Math.PI / 2, -1)),
			currentTime: 0
		});

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.pathTypes).toEqual(['circular-contact', 'circular-contact']);
	});

	it('clips the search to the earlier local path horizon', () => {
		const first = path('a', [-2, 0], [1, 0], [0, 0], 'free-flight', 0, 1);
		const second = path('b', [2, 0], [-1, 0], [0, 0], 'free-flight', 0, 4);
		const result = findEarliestDynamicPairContact(query(first, second));

		expect(result.type).toBe('no-contact');
		expect(result.diagnostics.searchInterval).toEqual([0, 1]);
		expect(result.diagnostics.localEventHorizons).toEqual([1, 4]);
	});

	it('handles exact zero-duration boundary contact without normalization', () => {
		const result = findEarliestDynamicPairContact({
			...query(
				path('a', [-1.5, 0], [0.5, 0], [0, 0], 'free-flight', 0, 2),
				path('b', [1.5, 0], [-0.5, 0], [0, 0], 'free-flight', 0, 2)
			),
			currentTime: 2
		});

		expect(result.type).toBe('contact');
		expect(result.diagnostics.normalizedIntervalScale).toBe(0);
		expect(result.diagnostics.polynomialCoefficients).toEqual([]);
	});

	it('rejects initial separating contact and accepts a later re-entry root', () => {
		const result = findEarliestDynamicPairContact(
			query(path('a', [0, 0], [0, 0]), path('b', [1, 0], [1, 0], [-2, 0], 'free-flight', 0, 2))
		);

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(1, 10);
		expect(result.diagnostics.candidates.map(({ classification }) => classification)).toEqual([
			'rejected-exiting',
			'accepted-impact'
		]);
	});

	it('rejects penetrating, reversed and unsupported circular input explicitly', () => {
		const overlap = findEarliestDynamicPairContact(
			query(path('a', [0, 0], [0, 0]), path('b', [0.5, 0], [0, 0]))
		);
		expect(overlap).toMatchObject({ type: 'invalid-input' });

		const reversed = findEarliestDynamicPairContact({
			...query(path('a', [-2, 0], [1, 0]), path('b', [2, 0], [-1, 0])),
			currentTime: 11
		});
		expect(reversed).toMatchObject({ type: 'invalid-input' });
	});

	it('isolates the off-axis free-flight and circular-contact pair instead of aborting at the isolation floor', () => {
		const result = findEarliestDynamicPairContact(offAxisFrontierQuery());

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeCloseTo(4.035212, 5);
		expect(result.state.relativeNormalMotion).toBeLessThan(-1e-9);
		expect(result.diagnostics.pathTypes).toEqual(['free-flight', 'circular-contact']);
		expect(result.diagnostics.candidates[0]).toMatchObject({
			topology: 'entering',
			classification: 'accepted-impact'
		});
		expect(result.state.time).toBeGreaterThan(result.diagnostics.searchInterval[0]);
		expect(result.state.time).toBeLessThan(result.diagnostics.searchInterval[1]);
		const residual = Math.hypot(
			result.state.secondPosition[0] - result.state.firstPosition[0],
			result.state.secondPosition[1] - result.state.firstPosition[1]
		);
		expect(Math.abs(residual - 1)).toBeLessThan(1e-9);
	});

	it('certifies a nearby free-flight and circular-contact near miss as no-contact', () => {
		const source = offAxisFrontierQuery();
		const result = findEarliestDynamicPairContact({
			...source,
			first: {
				...source.first,
				path: {
					...source.first.path,
					startPosition: [source.first.path.startPosition[0] + 0.02, 0.5]
				}
			}
		});

		expect(result.type).toBe('no-contact');
	});

	it('certifies an earlier separated approach before accepting a later entering circular root', () => {
		const circular = circularPath('slider', [0, 0], 2, 0, Math.PI, 1);
		const free = path('free', [3, 2], [-1, 0], [0, 0], 'free-flight', 0, Math.PI);
		const result = findEarliestDynamicPairContact({
			first: { ...participant(circular), radius: 0.5 },
			second: { ...participant(free), radius: 0.5 },
			currentTime: 0
		});

		expect(result.type).toBe('contact');
		if (result.type !== 'contact') return;
		expect(result.state.time).toBeGreaterThan(0.5);
		expect(result.state.relativeNormalMotion).toBeLessThan(-1e-9);
		expect(result.diagnostics.candidates[0]?.classification).toBe('accepted-impact');
	});

	it('preserves circular mixed-path contact time and reverses the normal when participant order is swapped', () => {
		const forward = findEarliestDynamicPairContact(offAxisFrontierQuery());
		const source = offAxisFrontierQuery();
		const swapped = findEarliestDynamicPairContact({
			first: source.second,
			second: source.first,
			currentTime: source.currentTime
		});

		expect(forward.type).toBe('contact');
		expect(swapped.type).toBe('contact');
		if (forward.type !== 'contact' || swapped.type !== 'contact') return;
		expect(swapped.state.time).toBeCloseTo(forward.state.time, 12);
		expect(swapped.state.response).toBe(forward.state.response);
		expect(swapped.state.normalFromFirstToSecond[0]).toBeCloseTo(
			-forward.state.normalFromFirstToSecond[0],
			12
		);
		expect(swapped.state.normalFromFirstToSecond[1]).toBeCloseTo(
			-forward.state.normalFromFirstToSecond[1],
			12
		);
	});

	it('returns unresolved when a non-certifiable circular interval exhausts its isolation budget', () => {
		const result = findEarliestDynamicPairContact({
			first: {
				...participant(path('fast', [0, -0.5], [1_000, 0], [0, 0], 'free-flight', 0, 1)),
				radius: 0.5
			},
			second: {
				...participant(circularPath('hover', [0, 1.000000005], 0.5, -Math.PI / 2, Math.PI / 2, 1)),
				radius: 0.5
			},
			currentTime: 0,
			maximumIsolationIntervals: 8
		});

		expect(result.type).toBe('unresolved');
		if (result.type !== 'unresolved') return;
		expect(result.reason).toMatch(/interval bound|numerical progress/i);
		expect(
			result.diagnostics.candidates.some(
				({ classification }) => classification === 'accepted-impact'
			)
		).toBe(false);
	});
});

function query(firstPath: MotionSegment, secondPath: MotionSegment): DynamicPairContactQuery {
	if (firstPath.type === 'circular-contact' || secondPath.type === 'circular-contact') {
		throw new Error('Test helper only accepts polynomial paths.');
	}
	return {
		first: participant(firstPath),
		second: participant(secondPath),
		currentTime: Math.max(firstPath.startTime, secondPath.startTime)
	};
}

function participant<T extends MotionSegment>(
	pathValue: T
): DynamicCirclePathParticipant & { readonly path: T } {
	return {
		bodyId: pathValue.bodyId,
		revision: 0,
		radius: 0.5,
		path: pathValue
	};
}

function offAxisFrontierQuery(): DynamicPairContactQuery {
	const currentTime = 4.0334887421011185;
	return {
		first: {
			bodyId: 'base',
			revision: 31,
			radius: 0.5,
			path: {
				type: 'free-flight',
				bodyId: 'base',
				startTime: currentTime,
				endTime: 4.035839872511614,
				startPosition: [0.8407441226651726, 0.5],
				startVelocity: [0.8088784037562395, 0.0115322946634807],
				acceleration: [0, -9.81]
			}
		},
		second: {
			bodyId: 'joining-02',
			revision: 25,
			radius: 0.5,
			path: {
				type: 'circular-contact',
				bodyId: 'joining-02',
				startTime: 4.025827379793903,
				endTime: 4.164166796854933,
				startPosition: [-0.007801446057311677, 1.0391675024858644],
				startVelocity: [0.3936520349730825, -0.6148982887180198],
				supportingColliderId: 'joining-01',
				supportingBodyId: 'joining-01',
				supportingComponentId: 'dynamic-support:4.025827379793903:joining-02->joining-01',
				centre: [-0.8500000000000001, 0.49999999999999994],
				contactRadius: 1,
				startAngle: 0.5694483149857902,
				endAngle: 0.38715754940640956,
				direction: -1,
				startTangentialSpeed: 0.730110834125065,
				gravity: [0, -9.81]
			}
		},
		currentTime
	};
}

function circularPath(
	bodyId: string,
	centre: Vec2,
	contactRadius: number,
	startAngle: number,
	endAngle: number,
	direction: -1 | 1
): Extract<MotionSegment, { type: 'circular-contact' }> {
	const startPosition: Vec2 = [
		centre[0] + contactRadius * Math.cos(startAngle),
		centre[1] + contactRadius * Math.sin(startAngle)
	];
	const startTangentialSpeed = 1;
	const angularDistance = direction * (endAngle - startAngle);
	return {
		type: 'circular-contact',
		bodyId,
		startTime: 0,
		endTime: (contactRadius * angularDistance) / startTangentialSpeed,
		startPosition,
		startVelocity: [
			-Math.sin(startAngle) * direction * startTangentialSpeed,
			Math.cos(startAngle) * direction * startTangentialSpeed
		],
		supportingColliderId: `${bodyId}-support`,
		centre,
		contactRadius,
		startAngle,
		endAngle,
		direction,
		startTangentialSpeed,
		gravity: [0, 0]
	};
}

function path(
	bodyId: string,
	startPosition: Vec2,
	startVelocity: Vec2,
	acceleration: Vec2 = [0, 0],
	type: 'free-flight' | 'linear-contact' = 'free-flight',
	startTime = 0,
	endTime = 10
): Exclude<MotionSegment, { type: 'circular-contact' | 'stationary' }> {
	const base = {
		bodyId,
		startTime,
		endTime,
		startPosition,
		startVelocity,
		acceleration
	};
	return type === 'free-flight'
		? { ...base, type }
		: {
				...base,
				type,
				supportingColliderId: 'support',
				contactNormal: [0, 1]
			};
}
