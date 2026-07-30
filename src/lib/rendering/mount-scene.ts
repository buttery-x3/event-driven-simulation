import * as THREE from 'three';
import type { SimulationSnapshot } from '$lib/simulation/snapshot';

export function mountScene(host: HTMLElement, snapshot: SimulationSnapshot): () => void {
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b1220);
	scene.fog = new THREE.Fog(0x0b1220, 7, 14);

	const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
	camera.position.set(0, 2, 8.5);
	camera.lookAt(0, 1.25, 0);

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

	const boardGeometry = new THREE.BoxGeometry(5.4, 4.8, 0.3);
	const boardMaterial = new THREE.MeshStandardMaterial({
		color: 0x162238,
		roughness: 0.68,
		metalness: 0.08
	});
	const board = new THREE.Mesh(boardGeometry, boardMaterial);
	board.position.set(0, 1.15, -0.42);
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

	for (const body of snapshot.bodies) {
		const geometry = new THREE.SphereGeometry(body.radius, 40, 24);
		const mesh = new THREE.Mesh(geometry, body.motion === 'dynamic' ? ballMaterial : pegMaterial);
		mesh.position.set(body.position.x, body.position.y, body.position.z);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		bodyGeometries.push(geometry);
		scene.add(mesh);
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
	render();

	return () => {
		resizeObserver.disconnect();
		bodyGeometries.forEach((geometry) => geometry.dispose());
		ballMaterial.dispose();
		pegMaterial.dispose();
		boardGeometry.dispose();
		boardMaterial.dispose();
		renderer.dispose();
		renderer.domElement.remove();
	};
}
