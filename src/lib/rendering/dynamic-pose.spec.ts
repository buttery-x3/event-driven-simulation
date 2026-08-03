import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyDynamicBodyPoses, applyDynamicBodySelection } from './dynamic-pose';

describe('dynamic pose application', () => {
	it('addresses meshes by stable entity ID without depending on their geometry', () => {
		const requestedBody = new THREE.Object3D();
		const unrelatedBody = new THREE.Object3D();
		unrelatedBody.position.set(9, 9, 9);

		applyDynamicBodyPoses(
			{
				time: 0.5,
				bodies: [
					{
						bodyId: 'requested-body',
						position: [1.25, -0.5],
						velocity: [0, 0],
						segmentIndex: 0,
						motionMode: 'free-flight',
						lifecycle: 'active',
						contactComponentIds: []
					},
					{
						bodyId: 'missing-body',
						position: [3, 4],
						velocity: [0, 0],
						segmentIndex: 0,
						motionMode: 'free-flight',
						lifecycle: 'active',
						contactComponentIds: []
					}
				],
				mostRecentEvent: null
			},
			new Map([
				['unrelated-body', unrelatedBody],
				['requested-body', requestedBody]
			])
		);

		expect(requestedBody.position.toArray()).toEqual([1.25, -0.5, 0]);
		expect(unrelatedBody.position.toArray()).toEqual([9, 9, 9]);
	});

	it('highlights one selected body without changing recorded positions', () => {
		const selected = new THREE.Object3D();
		const other = new THREE.Object3D();
		const meshes = new Map([
			['selected', selected],
			['other', other]
		]);

		applyDynamicBodySelection('selected', meshes);
		expect(selected.scale.toArray()).toEqual([1.2, 1.2, 1.2]);
		expect(other.scale.toArray()).toEqual([0.86, 0.86, 0.86]);

		applyDynamicBodySelection(null, meshes);
		expect(selected.scale.toArray()).toEqual([1, 1, 1]);
		expect(other.scale.toArray()).toEqual([1, 1, 1]);
	});
});
