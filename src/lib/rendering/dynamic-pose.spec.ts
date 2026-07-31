import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyDynamicBodyPoses } from './dynamic-pose';

describe('dynamic pose application', () => {
	it('addresses meshes by stable entity ID without depending on their geometry', () => {
		const requestedBody = new THREE.Object3D();
		const unrelatedBody = new THREE.Object3D();
		unrelatedBody.position.set(9, 9, 9);

		applyDynamicBodyPoses(
			{
				time: 0.5,
				bodies: [
					{ bodyId: 'requested-body', position: [1.25, -0.5], segmentIndex: 0 },
					{ bodyId: 'missing-body', position: [3, 4], segmentIndex: 0 }
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
});
