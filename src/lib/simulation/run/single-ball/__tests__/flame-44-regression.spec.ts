import { describe, expect, it } from 'vitest';
import type {
	ContactManifoldMember,
	RunContactSearchDiagnostic,
	SimulationInput,
	StaticCollider,
	Vec2
} from '../../../contracts';
import type { FixedWorldContactCandidate } from '../../../collision';
import { boardStateScenarios } from '../../../world';
import { constructSingleBallRun } from '../construct';
import { withManifoldEvidence } from '../diagnostics';

const closeContacts = boardStateScenarios.find(({ id }) => id === 'close-contacts')!.input;

describe('FLAME-44 coupled fixed-world impact manifolds', () => {
	it('resolves the symmetric two-peg event and collapses into certified rest', () => {
		const run = constructSingleBallRun(closeContacts);
		const first = run.events.find(({ type }) => type === 'contact');

		expect(run.outcome).toBe('settled');
		expect(run.terminalReason.type).toBe('resting-contact');
		expect(first).toMatchObject({
			type: 'contact',
			contacts: [{ impulse: expect.any(Number) }, { impulse: expect.any(Number) }]
		});
		if (
			!first ||
			first.type !== 'contact' ||
			!first.preContactVelocity ||
			!first.postContactVelocity
		)
			return;
		expect(first.postContactVelocity[0]).toBeCloseTo(0, 12);
		expect(first.postContactVelocity[1]).toBeCloseTo(-0.6 * first.preContactVelocity[1], 10);
		for (const contact of first.contacts ?? []) {
			expect(contact.impulse).toBeGreaterThanOrEqual(0);
			expect(contact.postImpactNormalVelocity).toBeGreaterThanOrEqual(-1e-9);
		}
		if (run.terminalReason.type === 'resting-contact') {
			expect(run.terminalReason.contacts).toHaveLength(2);
			expect(run.terminalReason.supportReactions?.every((value) => value >= 0)).toBe(true);
		}
	});

	it('is invariant under collider order and collider renaming', () => {
		const baseline = constructSingleBallRun(closeContacts);
		const reversed = constructSingleBallRun(
			withColliders([...closeContacts.scene.staticColliders].reverse())
		);
		const renamed = constructSingleBallRun(
			withColliders(
				closeContacts.scene.staticColliders.map((collider, index) => ({
					...collider,
					id: `renamed-${index}`
				}))
			)
		);

		expect(reversed.trajectories).toEqual(baseline.trajectories);
		expect(renamed.trajectories).toEqual(baseline.trajectories);
		expect(reversed.terminalReason.time).toBe(baseline.terminalReason.time);
		expect(renamed.terminalReason.time).toBe(baseline.terminalReason.time);
	});

	it('settles on the first coupled impact when restitution is zero', () => {
		const run = constructSingleBallRun({
			...closeContacts,
			settings: { ...closeContacts.settings, restitution: 0 }
		});
		const contacts = run.events.filter(({ type }) => type === 'contact');

		expect(run.outcome).toBe('settled');
		expect(contacts).toHaveLength(1);
		expect(contacts[0]).toMatchObject({ postContactVelocity: [0, 0], contacts: [{}, {}] });
	});

	it('couples an existing line support with a newly reached wall', () => {
		const floor = line('floor', [-3, 0], [3, 0]);
		const wall = line('wall', [1, 0], [1, 2]);
		const run = constructSingleBallRun(testInput([floor, wall], [-1, 0.1], [1, 0], 0.5));
		const manifold = run.events.filter(({ type }) => type === 'contact')[1];

		expect(manifold).toMatchObject({
			type: 'contact',
			contacts: [
				expect.objectContaining({ colliderId: 'floor', preImpactNormalVelocity: 0 }),
				expect.objectContaining({ colliderId: 'wall', impulse: expect.any(Number) })
			]
		});
		expect(
			run.trajectories[0]!.segments.filter(({ type }) => type === 'linear-contact').length
		).toBeGreaterThan(1);
		const search = run.diagnostics.contactSearches.find((candidate) =>
			candidate.activeColliderIds?.includes('wall')
		);
		expect(
			search?.candidates.find(
				({ colliderId, eventContactSetMember }) => colliderId === 'floor' && eventContactSetMember
			)
		).toMatchObject({
			activeInManifold: true,
			eventContactSetMember: true,
			positiveImpulseContributor: false,
			retainedSupportAfterImpact: true,
			releasedAfterImpact: false,
			impulse: 0
		});
	});

	it('couples a paced circular slide with a second peg', () => {
		const angle = 1;
		const contactPosition: Vec2 = [0.6 * Math.cos(angle), 0.6 * Math.sin(angle)];
		const pegs: readonly StaticCollider[] = [
			{
				id: 'support-peg',
				motionAuthority: 'static',
				physicalShape: { type: 'circle', radius: 0.5 },
				centre: [0, 0]
			},
			{
				id: 'impact-peg',
				motionAuthority: 'static',
				physicalShape: { type: 'circle', radius: 0.5 },
				centre: [contactPosition[0] + 0.6, contactPosition[1]]
			}
		];
		const run = constructSingleBallRun(testInput(pegs, [0, 0.6], [1, 0], 0.5));
		const manifold = run.events.filter(({ type }) => type === 'contact')[1];

		expect(manifold).toMatchObject({ type: 'contact', contacts: [{}, {}] });
		if (!manifold || manifold.type !== 'contact') return;
		const support = manifold.contacts?.find(({ colliderId }) => colliderId === 'support-peg');
		const radius = Math.hypot(...manifold.position);
		const radial: Vec2 = [manifold.position[0] / radius, manifold.position[1] / radius];
		expectVector(support?.normal, radial, 9);
		expect(support?.normal[0]).toBeCloseTo(0.5403023059, 8);
		expect(support?.normal[1]).toBeCloseTo(0.8414709848, 8);
		expect(Math.hypot(...(support?.contactPoint ?? [Infinity, Infinity]))).toBeCloseTo(0.5, 9);
		expect(support?.preImpactNormalVelocity).toBeCloseTo(0, 12);
		expect(support?.postImpactNormalVelocity).toBeCloseTo(0, 12);
		expectVector(manifold.postContactVelocity, [-0.71677674, 0.46023705], 7);

		const segments = run.trajectories[0]!.segments;
		const segmentBefore = segments.find(
			(segment) => segment.type === 'circular-contact' && segment.endTime === manifold.time
		);
		const segmentAfter = segments.find(
			(segment) => segment.type === 'circular-contact' && segment.startTime === manifold.time
		);
		expect(segmentBefore?.endTime).toBe(manifold.time);
		expect(segmentAfter?.startTime).toBe(manifold.time);
		expect(
			segments.some(
				(segment) => segment.type === 'free-flight' && segment.startTime === manifold.time
			)
		).toBe(false);

		const search = run.diagnostics.contactSearches.find(
			(candidate) =>
				candidate.selectedColliderId === 'impact-peg' &&
				candidate.searchInterval[1] === manifold.time
		);
		expect(
			search?.candidates.filter(
				({ colliderId, eventContactSetMember }) =>
					colliderId === 'support-peg' && eventContactSetMember
			)
		).toHaveLength(1);
		expect(
			search?.candidates
				.filter(({ time }) => time > manifold.time)
				.every(
					({ eventContactSetMember, activeInManifold, impulse }) =>
						!eventContactSetMember && !activeInManifold && impulse === undefined
				)
		).toBe(true);
		expect(run.outcome).toBe('settled');
		if (run.terminalReason.type === 'resting-contact') {
			expect(run.terminalReason.contacts?.map(({ colliderId }) => colliderId).sort()).toEqual([
				'impact-peg',
				'support-peg'
			]);
		}
	});

	it('allows a new angled impact to release the old support', () => {
		const normal: Vec2 = [-Math.SQRT1_2, Math.SQRT1_2];
		const impactPosition: Vec2 = [0, 0.1];
		const circle: StaticCollider = {
			id: 'lifting-circle',
			motionAuthority: 'static',
			physicalShape: { type: 'circle', radius: 0.1 },
			centre: [impactPosition[0] - 0.2 * normal[0], impactPosition[1] - 0.2 * normal[1]]
		};
		const run = constructSingleBallRun(
			testInput([line('floor', [-3, 0], [3, 0]), circle], [-1, 0.1], [2, 0], 0.5)
		);
		const manifold = run.events.filter(({ type }) => type === 'contact')[1];

		expect(manifold).toMatchObject({
			type: 'contact',
			postContactVelocity: [expect.any(Number), expect.any(Number)]
		});
		if (!manifold || manifold.type !== 'contact') return;
		expect(manifold.postContactVelocity![1]).toBeGreaterThan(0);
		expect(manifold.contacts?.find(({ colliderId }) => colliderId === 'floor')?.impulse).toBe(0);
		const search = run.diagnostics.contactSearches.find((candidate) =>
			candidate.activeColliderIds?.includes('lifting-circle')
		);
		expect(
			search?.candidates.find(
				({ colliderId, eventContactSetMember }) => colliderId === 'floor' && eventContactSetMember
			)
		).toMatchObject({
			activeInManifold: true,
			positiveImpulseContributor: false,
			retainedSupportAfterImpact: false,
			releasedAfterImpact: true
		});
	});

	it('does not annotate a later root that shares the current collider and feature', () => {
		const current = circleCandidate(1);
		const diagnostic: RunContactSearchDiagnostic = {
			searchInterval: [0, 2],
			outcome: 'contact',
			reason: null,
			selectedColliderId: current.colliderId,
			candidates: [
				{
					colliderId: current.colliderId,
					feature: current.feature,
					time: current.time,
					classification: 'accepted-impact',
					eventContactSetMember: true
				},
				{
					colliderId: current.colliderId,
					feature: current.feature,
					time: 1.5,
					classification: 'future-root'
				}
			]
		};
		const contact: ContactManifoldMember = {
			colliderId: current.colliderId,
			feature: current.feature,
			contactPoint: current.contactPoint,
			normal: current.normal,
			preImpactNormalVelocity: -1,
			postImpactNormalVelocity: 0.5,
			impulse: 1.5
		};
		const annotated = withManifoldEvidence(
			diagnostic,
			[1, 0],
			[-0.5, 0],
			[current],
			[contact],
			[],
			1e-9
		);

		expect(annotated.candidates[0]).toMatchObject({
			classification: 'accepted-impact',
			eventContactSetMember: true,
			positiveImpulseContributor: true
		});
		expect(annotated.candidates[1]).toEqual(diagnostic.candidates[1]);
	});

	it('certifies a mixed circle-line resting manifold', () => {
		const circleNormal: Vec2 = [-0.6, 0.8];
		const lineNormal: Vec2 = [0.6, 0.8];
		const position: Vec2 = [0, 1];
		const circle: StaticCollider = {
			id: 'mixed-circle',
			motionAuthority: 'static',
			physicalShape: { type: 'circle', radius: 0.1 },
			centre: [position[0] - 0.2 * circleNormal[0], position[1] - 0.2 * circleNormal[1]]
		};
		const contactPoint: Vec2 = [
			position[0] - 0.1 * lineNormal[0],
			position[1] - 0.1 * lineNormal[1]
		];
		const tangent: Vec2 = [-lineNormal[1], lineNormal[0]];
		const supportLine = line(
			'mixed-line',
			[contactPoint[0] - tangent[0], contactPoint[1] - tangent[1]],
			[contactPoint[0] + tangent[0], contactPoint[1] + tangent[1]]
		);
		const run = constructSingleBallRun(testInput([circle, supportLine], position, [0, 0], 0));

		expect(run.outcome).toBe('settled');
		if (run.terminalReason.type !== 'resting-contact') return;
		expect(run.terminalReason.contacts?.map(({ colliderId }) => colliderId).sort()).toEqual([
			'mixed-circle',
			'mixed-line'
		]);
		expect(run.terminalReason.supportReactions?.every((reaction) => reaction > 0)).toBe(true);
	});
});

function withColliders(colliders: SimulationInput['scene']['staticColliders']): SimulationInput {
	return { ...closeContacts, scene: { ...closeContacts.scene, staticColliders: colliders } };
}

function line(id: string, start: Vec2, end: Vec2): StaticCollider {
	return { id, motionAuthority: 'static', physicalShape: { type: 'line-segment', start, end } };
}

function circleCandidate(time: number): FixedWorldContactCandidate {
	return {
		type: 'contact-candidate',
		bodyId: 'ball',
		colliderId: 'peg',
		colliderKind: 'circle',
		feature: 'circle',
		time,
		position: [0.6, 0],
		contactPoint: [0.5, 0],
		normal: [1, 0],
		normalVelocity: -1,
		response: 'impact'
	};
}

function expectVector(actual: Vec2 | undefined, expected: Vec2, precision: number): void {
	expect(actual?.[0]).toBeCloseTo(expected[0], precision);
	expect(actual?.[1]).toBeCloseTo(expected[1], precision);
}

function testInput(
	staticColliders: readonly StaticCollider[],
	position: Vec2,
	velocity: Vec2,
	restitution: number
): SimulationInput {
	return {
		scene: {
			id: 'flame-44-test',
			coordinateSystem: closeContacts.scene.coordinateSystem,
			bounds: { width: 10, height: 10 },
			staticColliders,
			terminationRegions: []
		},
		initialDynamicBodies: [
			{
				id: 'ball',
				motionAuthority: 'dynamic',
				physicalShape: { type: 'circle', radius: 0.1 },
				mass: 1,
				position,
				velocity,
				releaseTime: 0
			}
		],
		settings: {
			gravity: [0, -10],
			restitution,
			contactCaptureDistance: 1e-9,
			maximumEvents: 50,
			maximumSimulationTime: 2,
			tolerances: { contactDistance: 1e-9, eventTime: 1e-9 }
		}
	};
}
