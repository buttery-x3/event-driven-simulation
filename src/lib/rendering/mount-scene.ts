import * as THREE from 'three';
import type { RendererPlaybackInput } from '$lib/simulation/contracts';
import { applyDynamicBodyPoses } from './dynamic-pose';
import { assertRecordedInspectionEligible, getPlaybackFrame, type PlaybackFrame } from './playback';
import { toRenderSceneViewModel } from './render-scene-data';
import { createSceneObjectResources } from './scene-object-resources';

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
	assertRecordedInspectionEligible(input);

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

	const sceneObjectResources = createSceneObjectResources(toRenderSceneViewModel(input));
	scene.add(...sceneObjectResources.meshes);

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
			applyDynamicBodyPoses(frame, sceneObjectResources.dynamicBodyMeshes);

			render();
			return frame;
		},
		destroy() {
			resizeObserver.disconnect();
			sceneObjectResources.dispose();
			boardGeometry.dispose();
			boardMaterial.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
