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
