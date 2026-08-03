import type * as THREE from 'three';
import type { EntityId } from '$lib/simulation/contracts';
import type { PlaybackFrame } from './playback';

export function applyDynamicBodyPoses(
	frame: PlaybackFrame,
	meshesByEntityId: ReadonlyMap<EntityId, THREE.Object3D>
): void {
	for (const body of frame.bodies) {
		const mesh = meshesByEntityId.get(body.bodyId);
		if (!mesh) continue;

		mesh.visible = body.position !== null;
		if (body.position) {
			mesh.position.set(body.position[0], body.position[1], 0);
		}
	}
}

export function applyDynamicBodySelection(
	selectedBodyId: EntityId | null,
	meshesByEntityId: ReadonlyMap<EntityId, THREE.Object3D>
): void {
	for (const [bodyId, mesh] of meshesByEntityId) {
		const scale = selectedBodyId === null ? 1 : bodyId === selectedBodyId ? 1.2 : 0.86;
		mesh.scale.setScalar(scale);
	}
}
