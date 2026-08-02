import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { prototypeSimulationInput } from '$lib/simulation/world';
import { defaultCanonicalPlinkoScenario } from '$lib/simulation/world';
import { toRenderSceneViewModel } from './render-scene-data';
import { createSceneObjectResources } from './scene-object-resources';

describe('Three.js scene object resources', () => {
	it('creates representations by renderer shape and registers dynamic meshes by stable ID', () => {
		const resources = createSceneObjectResources(toRenderSceneViewModel(prototypeSimulationInput));

		expect(resources.meshes[0]?.geometry).toBeInstanceOf(THREE.SphereGeometry);
		expect(resources.meshes[1]?.geometry).toBeInstanceOf(THREE.CylinderGeometry);
		expect(resources.dynamicBodyMeshes.get('ball')).toBe(resources.meshes[0]);
		expect(resources.dynamicBodyMeshes.has('peg-left')).toBe(false);

		const pegGeometry = resources.meshes[1]?.geometry as THREE.CylinderGeometry;
		expect(pegGeometry.parameters.radiusTop).toBe(
			prototypeSimulationInput.scene.staticColliders[0]?.physicalShape.radius
		);
		expect(pegGeometry.parameters.height).toBe(0.32);
		expect(resources.meshes[1]?.rotation.x).toBe(Math.PI / 2);

		resources.dispose();
	});

	it('creates Three.js boxes and planes for physical boundaries and termination regions', () => {
		const viewModel = toRenderSceneViewModel(defaultCanonicalPlinkoScenario.input);
		const resources = createSceneObjectResources(viewModel);
		const boundaryIndex = viewModel.objects.findIndex(({ id }) => id === 'boundary-left-wall');
		const exitIndex = viewModel.objects.findIndex(({ id }) => id === 'termination-centre-exit');
		const boundary = resources.meshes[boundaryIndex];
		const exit = resources.meshes[exitIndex];

		expect(boundary?.geometry).toBeInstanceOf(THREE.BoxGeometry);
		expect(boundary?.position.toArray()).toEqual([-2.55, 3.35, 0]);
		expect(boundary?.rotation.z).toBe(Math.PI / 2);
		expect(exit?.geometry).toBeInstanceOf(THREE.PlaneGeometry);
		expect(exit?.position.toArray()).toEqual([0, -0.09, -0.08]);

		resources.dispose();
	});

	it('disposes every owned geometry and shared material', () => {
		const resources = createSceneObjectResources(
			toRenderSceneViewModel(defaultCanonicalPlinkoScenario.input)
		);
		const geometryDisposals = resources.meshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'));
		const materials = new Set(resources.meshes.map((mesh) => mesh.material as THREE.Material));
		const materialDisposals = [...materials].map((material) => vi.spyOn(material, 'dispose'));

		resources.dispose();

		geometryDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
		materialDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
	});
});
