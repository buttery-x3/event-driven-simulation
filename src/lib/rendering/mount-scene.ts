import * as THREE from 'three';
import type { RendererPlaybackInput } from '$lib/simulation/contracts';
import { applyDynamicBodyPoses } from './dynamic-pose';
import { assertRecordedInspectionEligible, getPlaybackFrame, type PlaybackFrame } from './playback';
import { toRenderSceneViewModel } from './render-scene-data';
import { createSceneObjectResources } from './scene-object-resources';

// These values control only camera framing and presentation depth. They cannot affect physical
// results; board width, height and centre still come from the physical scene view model.
const presentationSettings = {
	camera: {
		fieldOfView: 42,
		near: 0.1,
		far: 100,
		padding: 0.65
	},
	backdrop: {
		padding: 0.18,
		z: -0.3
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
	scene.fog = new THREE.Fog(0x0b1220, 9, 22);
	const viewModel = toRenderSceneViewModel(input);

	const camera = new THREE.PerspectiveCamera(
		presentationSettings.camera.fieldOfView,
		1,
		presentationSettings.camera.near,
		presentationSettings.camera.far
	);

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

	const boardGeometry = new THREE.BoxGeometry(
		viewModel.board.size[0] + presentationSettings.backdrop.padding,
		viewModel.board.size[1] + presentationSettings.backdrop.padding,
		viewModel.board.size[2]
	);
	const boardMaterial = new THREE.MeshStandardMaterial({
		color: 0x162238,
		roughness: 0.68,
		metalness: 0.08
	});
	const board = new THREE.Mesh(boardGeometry, boardMaterial);
	board.position.set(
		viewModel.board.centre[0],
		viewModel.board.centre[1],
		presentationSettings.backdrop.z
	);
	board.receiveShadow = true;
	scene.add(board);

	const sceneObjectResources = createSceneObjectResources(viewModel);
	scene.add(...sceneObjectResources.meshes);

	const render = () => {
		const width = Math.max(host.clientWidth, 1);
		const height = Math.max(host.clientHeight, 1);
		camera.aspect = width / height;
		const framedWidth = viewModel.board.size[0] + presentationSettings.camera.padding;
		const framedHeight = viewModel.board.size[1] + presentationSettings.camera.padding;
		const requiredVerticalSpan = Math.max(framedHeight, framedWidth / camera.aspect);
		const cameraDistance =
			requiredVerticalSpan /
			(2 * Math.tan(THREE.MathUtils.degToRad(presentationSettings.camera.fieldOfView / 2)));
		camera.position.set(viewModel.board.centre[0], viewModel.board.centre[1], cameraDistance);
		camera.lookAt(viewModel.board.centre[0], viewModel.board.centre[1], 0);
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
