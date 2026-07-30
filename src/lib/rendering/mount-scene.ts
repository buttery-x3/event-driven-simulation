import * as THREE from 'three';
import type { EntityId, RendererPlaybackInput } from '$lib/simulation/contracts';
import { assertPlaybackEligible, getPlaybackFrame, type PlaybackFrame } from './playback';
import { getRenderableCircles } from './render-scene-data';

// These values control only camera framing and the decorative backdrop. They are not simulation
// geometry and cannot affect physical results.
const presentationSettings = {
	camera: {
		fieldOfView: 42,
		near: 0.1,
		far: 100,
		position: [0, 2, 8.5] as const,
		lookAt: [0, 1.25, 0] as const
	},
	backdrop: {
		size: [5.4, 4.8, 0.3] as const,
		position: [0, 1.15, -0.42] as const
	}
} as const;

export interface MountedPlaybackScene {
	setTime(time: number): PlaybackFrame;
	destroy(): void;
}

export function mountScene(host: HTMLElement, input: RendererPlaybackInput): MountedPlaybackScene {
	assertPlaybackEligible(input);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b1220);
	scene.fog = new THREE.Fog(0x0b1220, 7, 14);

	const camera = new THREE.PerspectiveCamera(
		presentationSettings.camera.fieldOfView,
		1,
		presentationSettings.camera.near,
		presentationSettings.camera.far
	);
	camera.position.set(...presentationSettings.camera.position);
	camera.lookAt(...presentationSettings.camera.lookAt);

	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	host.append(renderer.domElement);

	const ambientLight = new THREE.HemisphereLight(0xb8d8ff, 0x182033, 2.2);
	scene.add(ambientLight);

	const keyLight = new THREE.DirectionalLight(0xffffff, 5);
	keyLight.position.set(4, 7, 6);
	keyLight.castShadow = true;
	scene.add(keyLight);

	const boardGeometry = new THREE.BoxGeometry(...presentationSettings.backdrop.size);
	const boardMaterial = new THREE.MeshStandardMaterial({
		color: 0x162238,
		roughness: 0.68,
		metalness: 0.08
	});
	const board = new THREE.Mesh(boardGeometry, boardMaterial);
	board.position.set(...presentationSettings.backdrop.position);
	board.receiveShadow = true;
	scene.add(board);

	const ballMaterial = new THREE.MeshStandardMaterial({
		color: 0xff8a4c,
		roughness: 0.28,
		metalness: 0.12
	});
	const pegMaterial = new THREE.MeshStandardMaterial({
		color: 0x70d6ff,
		roughness: 0.42,
		metalness: 0.18
	});
	const bodyGeometries: THREE.SphereGeometry[] = [];
	const dynamicBodyMeshes = new Map<EntityId, THREE.Mesh>();

	for (const circle of getRenderableCircles(input)) {
		const geometry = new THREE.SphereGeometry(circle.radius, 40, 24);
		const material = circle.role === 'dynamic-body' ? ballMaterial : pegMaterial;
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(circle.centre[0], circle.centre[1], 0);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		bodyGeometries.push(geometry);
		scene.add(mesh);

		if (circle.role === 'dynamic-body') {
			dynamicBodyMeshes.set(circle.id, mesh);
		}
	}

	const render = () => {
		const width = Math.max(host.clientWidth, 1);
		const height = Math.max(host.clientHeight, 1);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height, false);
		renderer.render(scene, camera);
	};

	const resizeObserver = new ResizeObserver(render);
	resizeObserver.observe(host);

	return {
		setTime(time) {
			const frame = getPlaybackFrame(input, time);

			for (const body of frame.bodies) {
				const mesh = dynamicBodyMeshes.get(body.bodyId);
				if (!mesh) continue;

				mesh.visible = body.position !== null;
				if (body.position) {
					mesh.position.set(body.position[0], body.position[1], 0);
				}
			}

			render();
			return frame;
		},
		destroy() {
			resizeObserver.disconnect();
			bodyGeometries.forEach((geometry) => geometry.dispose());
			ballMaterial.dispose();
			pegMaterial.dispose();
			boardGeometry.dispose();
			boardMaterial.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
