import * as THREE from 'three';
import type { EntityId } from '$lib/simulation/contracts';
import type { RenderSceneObject, RenderSceneViewModel } from './render-scene-data';

interface SceneMaterials {
	readonly dynamicBody: THREE.MeshStandardMaterial;
	readonly fixedPeg: THREE.MeshStandardMaterial;
}

export interface SceneObjectResources {
	readonly meshes: readonly THREE.Mesh[];
	readonly dynamicBodyMeshes: ReadonlyMap<EntityId, THREE.Mesh>;
	dispose(): void;
}

export function createSceneObjectResources(viewModel: RenderSceneViewModel): SceneObjectResources {
	const materials = createSceneMaterials();
	const geometries: THREE.BufferGeometry[] = [];
	const meshes: THREE.Mesh[] = [];
	const dynamicBodyMeshes = new Map<EntityId, THREE.Mesh>();

	for (const object of viewModel.objects) {
		const geometry = createRepresentationGeometry(object);
		const mesh = new THREE.Mesh(geometry, selectMaterial(object, materials));
		mesh.position.set(object.centre[0], object.centre[1], 0);
		mesh.castShadow = true;
		mesh.receiveShadow = true;

		if (object.representation === 'cylinder') {
			mesh.rotation.set(...object.orientation);
		}

		geometries.push(geometry);
		meshes.push(mesh);

		if (object.motionAuthority === 'dynamic') {
			dynamicBodyMeshes.set(object.id, mesh);
		}
	}

	return {
		meshes,
		dynamicBodyMeshes,
		dispose() {
			geometries.forEach((geometry) => geometry.dispose());
			materials.dynamicBody.dispose();
			materials.fixedPeg.dispose();
		}
	};
}

function createRepresentationGeometry(object: RenderSceneObject): THREE.BufferGeometry {
	switch (object.representation) {
		case 'sphere':
			return new THREE.SphereGeometry(object.radius, 40, 24);
		case 'cylinder':
			return new THREE.CylinderGeometry(object.radius, object.radius, object.depth, 40);
	}
}

function createSceneMaterials(): SceneMaterials {
	return {
		dynamicBody: new THREE.MeshStandardMaterial({
			color: 0xff8a4c,
			roughness: 0.28,
			metalness: 0.12
		}),
		fixedPeg: new THREE.MeshStandardMaterial({
			color: 0x70d6ff,
			roughness: 0.42,
			metalness: 0.18
		})
	};
}

function selectMaterial(
	object: RenderSceneObject,
	materials: SceneMaterials
): THREE.MeshStandardMaterial {
	switch (object.material) {
		case 'dynamic-body':
			return materials.dynamicBody;
		case 'fixed-peg':
			return materials.fixedPeg;
	}
}
