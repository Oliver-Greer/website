import * as THREE from 'three';
import { textureStore, textureLoad, texture, int, ivec2, max, color, storage, Fn, If, instanceIndex, vertexIndex, sin, vec2, mod, float, PI, hash, cos, uniform, vec3, vec4, time} from 'three/tsl';

let renderer, scene, camera, backgroundNode;

let agentComputeTask, limitX, limitY;
let trailMap;
let fadeComputeTask;

const agentCount = 1_00;

init();

async function init() {

    
    scene = new THREE.Scene();
    backgroundNode = color(0x000000);
    camera = new THREE.OrthographicCamera(
        -window.innerWidth / 2, 
        window.innerWidth / 2,
        window.innerHeight / 2,
        -window.innerHeight / 2,
        0.1,              
        1000
    );
    camera.position.set(0, 0, 100);

    // initialize agents
    const agentPositionAngleData = new Float32Array(agentCount * 4);

    for (let count = 0; count < agentCount; count++) {
        const startIndex = count * 4;
        agentPositionAngleData[startIndex] = (Math.random() * 2 - 1) * window.innerWidth / 2;
        agentPositionAngleData[startIndex + 1] = (Math.random() * 2 - 1) * window.innerHeight / 2;
        agentPositionAngleData[startIndex + 2] = Math.random() * Math.PI * 2;
        agentPositionAngleData[startIndex + 3] = 0;
    }

    const agentBufferAttribute = new THREE.StorageInstancedBufferAttribute(agentPositionAngleData, 4);
    const agentStorage = storage(agentBufferAttribute, 'vec4', agentCount);

    // initialize trailMap
    trailMap = new THREE.StorageTexture(window.innerWidth, window.innerHeight);
    trailMap.type = THREE.FloatType;
    trailMap.minFilter = THREE.NearestFilter;
    trailMap.magFilter = THREE.NearestFilter;

    agentComputeTask = Fn(([ trailTexture ]) => {

        const position = agentStorage.element(instanceIndex).xy;
        const newPositionY = position.y.add(sin(agentStorage.element(instanceIndex).z)).toVar();
        const newPositionX = position.x.add(cos(agentStorage.element(instanceIndex).z)).toVar();
        const didHit = float(0).toVar();
        const targetAngle = float(0).toVar();

        If(newPositionX.greaterThan(limitX), () => {
            newPositionX.assign(newPositionX.sub(0.5));
            targetAngle.assign(PI);
            didHit.assign(1);
        })
        If(newPositionX.lessThan(limitX.negate()), () => {
            newPositionX.assign(newPositionX.add(0.5));
            targetAngle.assign(0);
            didHit.assign(1);
        })
        If(newPositionY.greaterThan(limitY), () => {
            newPositionY.assign(newPositionY.sub(0.5));
            targetAngle.assign(PI.div(2).negate());
            didHit.assign(1);
        })
        If(newPositionY.lessThan(limitY.negate()), () => {
            newPositionY.assign(newPositionY.add(0.5));
            targetAngle.assign(PI.div(2));
            didHit.assign(1);
        })
        
        If(didHit.greaterThan(0.5), () => {
            const randomAngleOffset = hash(instanceIndex.add(time)).mul(2).sub(1);
            const newAngle = targetAngle.add(randomAngleOffset);
            agentStorage.element(instanceIndex).z.assign(newAngle);
        })

        agentStorage.element(instanceIndex).xy.assign(vec2(newPositionX, newPositionY));

        // write to trail
        const trailCoords = ivec2(int(position.x.add(limitX)), int(position.y.add(limitY)));
        textureStore(trailTexture, trailCoords, vec4(1,1,1,1));
    });

    fadeComputeTask = Fn(([ trailTexture ]) => {

        const x = int(instanceIndex.mod(int(window.innerWidth)));
        const y = int(instanceIndex.div(int(window.innerWidth)));
        const coords = ivec2(x, y);

        const currentColor = textureLoad(trailTexture, coords);

        const newColor = max(currentColor.sub(0.2), 0.0);

        textureStore(trailTexture, coords, newColor);
    })

    // agent geometry
    const agentGeometry = new THREE.BufferGeometry();
    agentGeometry.setAttribute('position', agentBufferAttribute);
    agentGeometry.drawRange.count = agentCount;

    const material = new THREE.PointsNodeMaterial();
    material.colorNode = color(0xffffff);

    material.positionNode = vec3(agentStorage.element(vertexIndex).xy, 0.0);
    material.size = 1;

    const agents = new THREE.Points(agentGeometry, material);
    scene.add(agents);

    // trail geometry
    const planeMaterial = new THREE.NodeMaterial();
    planeMaterial.colorNode = texture(trailMap); 

    const screenQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(window.innerWidth, window.innerHeight),
        planeMaterial
    );
    scene.add(screenQuad);

    renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);
    onWindowResize();
}

function onWindowResize() {

    // TODO: Need to write a shader here to handle resizing and transfering the texture
    camera.left = -window.innerWidth / 2;
    camera.right = window.innerWidth / 2;
    camera.top = window.innerHeight / 2;
    camera.bottom = -window.innerHeight / 2;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

    limitX = uniform(window.innerWidth / 2);
    limitY = uniform(window.innerHeight / 2);
    
}

function animate() {
    const agentCompute = agentComputeTask(trailMap).compute(agentCount);
    const fadeCompute = fadeComputeTask(trailMap).compute(window.innerWidth * window.innerHeight);
    renderer.compute(agentCompute);
    renderer.compute(fadeCompute);
    scene.backgroundNode = backgroundNode;
    renderer.render(scene, camera);
}