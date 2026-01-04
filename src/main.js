import * as THREE from "three";
import {
  positionLocal,
  normalLocal,
  normalize,
  modelWorldMatrix,
  cameraProjectionMatrix,
  cameraViewMatrix,
  mix,
  attributeArray,
  clamp,
  time,
  mx_noise_float,
  Fn,
  uint,
  float,
  cross,
  If,
  Continue,
  distance,
  length,
  attribute,
  max,
  exp,
  mat3,
  vec3,
  select,
  Loop,
  instanceIndex,
  uniform
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";

class FlockGeometry extends THREE.BufferGeometry {
  constructor(geo) {
    super();

    const geometry = geo.toNonIndexed();
    const srcPosAttr = geometry.getAttribute( "position" );
    const srcNormAttr = geometry.getAttribute( "normal" );
    const count = srcPosAttr.count;
    const total = count * BOIDS;
    
    const posAttr = new THREE.BufferAttribute(new Float32Array(total * 3), 3); 
    const normAttr = new THREE.BufferAttribute(new Float32Array(total * 3), 3); 
    const instanceIDAttr = new THREE.BufferAttribute(new Uint32Array(total), 1);

    this.setAttribute("instanceID", instanceIDAttr);
    this.setAttribute("position", posAttr);
    this.setAttribute("normal", normAttr);

    for (let b = 0; b < BOIDS; b++) {
      let offset = b * count * 3;
      for (let i = 0; i < count * 3; i++) {
        posAttr.array[offset + i] = srcPosAttr.array[i];
        normAttr.array[offset + i] = srcNormAttr.array[i];
      }
      offset = b * count;
      for (let i = 0; i < count; i++) {
        instanceIDAttr.array[offset + i] = b;
      }
    }
  }
}

let container;

let camera,
  scene,
  renderer,
  options,
  material,
  assetPath,
  clock,
  boid,
  flock,
  deltaTime,
  computeVelocity,
  computePosition,
  computeTest;

const BOIDS = 9;

init();

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  camera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    1,
    100
  );
  camera.position.set(0.0, 1, 2);

  //

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x444488);

  //

  renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setAnimationLoop(render);
  container.appendChild(renderer.domElement);

  //

  //content

  const ambient = new THREE.HemisphereLight(0xaaaaaa, 0x333333);
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(3, 3, 1);
  scene.add(ambient);
  scene.add(light);

  clock = new THREE.Clock();
  
  const controls = new OrbitControls(camera, renderer.domElement);

  assetPath = "https://assets.codepen.io/2666677/";

  loadGLB("boid");

  window.addEventListener("resize", onWindowResize);
}

function loadGLB(name) {
  const loader = new GLTFLoader().setPath(assetPath);
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(
    "https://cdn.jsdelivr.net/npm/three@v0.170.0/examples/jsm/libs/draco/gltf/"
  );
  loader.setDRACOLoader(dracoLoader);

  loader.load(`${name}.glb`, (gltf) => {
    boid = gltf.scene.children[0];
    const scale = 0.2;
    boid.geometry.scale( scale, scale, scale );

    tsl();
    //scene.add(boid);
  });
}

function initStorage() {
  const positionArray = new Float32Array(BOIDS * 3);

  const cellSize = 0.5;
  
  for (let i = 0; i < BOIDS; i++) {
    const offset = i * 3;
    const row = (i % 3) - 1;
    const col = (~~(i / 3)) - 1;
    positionArray[offset + 0] = col * cellSize; 
    positionArray[offset + 1] = row * cellSize; 
  }

  const positionStorage = attributeArray(positionArray, "vec3").label(
    "positionStorage"
  );

  // The Pixel Buffer Object (PBO) is required to get the GPU computed data in the WebGL2 fallback.
  positionStorage.setPBO(true);

  return positionStorage;
}

function tsl() {
  const positionStorage = initStorage();

  const flockVertexTSL = Fn(() => {
    const instanceID = attribute("instanceID");
    
    const finalVert = modelWorldMatrix.mul(positionLocal).add(positionStorage.element(instanceID)).toVar();

    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(finalVert);
  });
  
  const geometry = new FlockGeometry(boid.geometry);
  const material = new THREE.MeshStandardNodeMaterial();

  flock = new THREE.Mesh(geometry, material);
  scene.add(flock);

  material.vertexNode = flockVertexTSL();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

//

function render() {
  renderer.render(scene, camera);
}