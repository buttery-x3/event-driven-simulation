import * as THREE from 'three';
import type { EntityId } from '$lib/simulation/contracts';
import type { RenderSceneObject, RenderSceneViewModel } from './render-scene-data';

interface SceneMaterials {
	readonly dynamicBody: THREE.MeshStandardMaterial;
	readonly fixedPeg: THREE.MeshStandardMaterial;
	readonly fixedBoundary: THREE.MeshStandardMaterial;
	readonly terminationRegion: THREE.MeshStandardMaterial;
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
		mesh.position.set(object.centre[0], object.centre[1], object.z);
		mesh.rotation.set(...object.orientation);
		mesh.castShadow = object.material !== 'termination-region';
		mesh.receiveShadow = true;

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
			Object.values(materials).forEach((material) => material.dispose());
		}
	};
}

function createRepresentationGeometry(object: RenderSceneObject): THREE.BufferGeometry {
	switch (object.representation) {
		case 'sphere':
			return new THREE.SphereGeometry(object.radius, 40, 24);
		case 'cylinder':
			return new THREE.CylinderGeometry(object.radius, object.radius, object.depth, 40);
		case 'box':
			return new THREE.BoxGeometry(...object.size);
		case 'plane':
			return new THREE.PlaneGeometry(...object.size);
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
		}),
		fixedBoundary: new THREE.MeshStandardMaterial({
			color: 0xa7bad6,
			roughness: 0.5,
			metalness: 0.16
		}),
		terminationRegion: new THREE.MeshStandardMaterial({
			color: 0x41d89b,
			emissive: 0x0a4935,
			transparent: true,
			opacity: 0.72,
			roughness: 0.62,
			metalness: 0
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
		case 'fixed-boundary':
			return materials.fixedBoundary;
		case 'termination-region':
			return materials.terminationRegion;
	}
}
