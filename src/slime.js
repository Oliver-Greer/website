import * as THREE from 'three';
import { 
    textureStore,
    texture,
    int,
    ivec2,
    vec2,
    vec3,
    vec4,
    float,
    color,
    Loop,
    storage,
    Fn,
    If,
    and,
    instanceIndex,
    vertexIndex,
    sin,
    cos,
    PI,
    TWO_PI,
    hash,
    uniform,
    time,
    dot
} from 'three/tsl';

let renderer, scene, camera, backgroundNode;
let agentStorage;
let trailMapWriteTarget, trailMapReadTarget;
let trailMap, agentComputeNode, fadeAndDiffuseComputeNode;

const limitX = uniform(0); 
const limitY = uniform(0);
const agentCount = 1_000;
let width = window.innerWidth;
let height = window.innerHeight;

initScene();

async function initScene() {

    // camera and scene
    scene = new THREE.Scene();
    backgroundNode = color(0x000000);
    camera = new THREE.OrthographicCamera(
        -width / 2, 
        width / 2,
        height / 2,
        -height / 2,
        0.1,              
        1000
    );
    camera.position.set(0, 0, 100);

    // initialize agents
    const agentPositionAngleData = new Float32Array(agentCount * 4);

    for (let count = 0; count < agentCount; count++) {
        const startIndex = count * 4;
        agentPositionAngleData[startIndex] = (Math.random() * 2 - 1) * width / 2;
        agentPositionAngleData[startIndex + 1] = (Math.random() * 2 - 1) * height / 2;
        agentPositionAngleData[startIndex + 2] = Math.random() * Math.PI * 2;
        agentPositionAngleData[startIndex + 3] = 0;
    }

    const agentBufferAttribute = new THREE.InstancedBufferAttribute(agentPositionAngleData, 4);
    agentStorage = storage(agentBufferAttribute, 'vec4', agentCount);

    // initialize trailMap render targets
    // NOTE: cannot read and write to one within the same compute shader so we make two seperate textures (Ping Pong)
    const rtSettings = {
        type: THREE.FloatType,
        magFilter: THREE.NearestFilter,
        minFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false
    };

    const trailBuffer1 = new THREE.StorageTexture(width, height);
    trailBuffer1.type = THREE.FloatType;
    trailBuffer1.minFilter = THREE.NearestFilter;
    trailBuffer1.magFilter = THREE.NearestFilter;

    const trailBuffer2 = new THREE.StorageTexture(width, height);
    trailBuffer2.type = THREE.FloatType;
    trailBuffer2.minFilter = THREE.NearestFilter;
    trailBuffer2.magFilter = THREE.NearestFilter;
    
    trailMapWriteTarget = trailBuffer1;
    trailMapReadTarget = trailBuffer2;

    // agent geometry
    const agentGeometry = new THREE.BufferGeometry();
    agentGeometry.setAttribute('position', agentBufferAttribute);
    agentGeometry.drawRange.count = agentCount;

    const material = new THREE.PointsMaterial();
    material.colorNode = color(0xffffff);

    material.positionNode = vec3(agentStorage.element(vertexIndex).xy, 0.0);
    material.size = 1;

    const agents = new THREE.Points(agentGeometry, material);
    scene.add(agents);

    // trail geometry
    const planeMaterial = new THREE.NodeMaterial();

    trailMap = new THREE.Mesh(new THREE.PlaneGeometry(width, height), planeMaterial);
    scene.add(trailMap);

    renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    onWindowResize();
    agentComputeNode = agentTSL();
    fadeAndDiffuseComputeNode = fadeAndDiffuseTSL();

    window.addEventListener('resize', onWindowResize);

    renderer.setAnimationLoop(animate);
}


function agentTSL() {
    const agentComputeTask = Fn(({ readTexture, writeTexture }) => {

        const position = agentStorage.element(instanceIndex).xy;
        const limit = ivec2(int(width).sub(1), int(height).sub(1));

        const senseAhead = (senseAngleOffset) => {
            const sensorOffsetDistance = float(5);
            const sensorSize = float(2);
            const sensorAngle = agentStorage.element(instanceIndex).z.add(senseAngleOffset);
            const senseDir = vec2(cos(sensorAngle), sin(sensorAngle));

            const coords = ivec2(int(position.x.add(limitX)), int(position.y.add(limitY)));
            const posOfSensor = coords.add(senseDir.mul(sensorOffsetDistance));

            const sum = float(0).toVar();

            Loop({
                start: int(sensorSize.negate()),
                end: int(sensorSize),
                type: 'int',
                condition: '<='
            }, ({ offsetX }) => {
                Loop({
                    start: int(sensorSize.negate()),
                    end: int(sensorSize),
                    type: 'int',
                    condition: '<='
                }, ({ offsetY }) => {
                    const coord = posOfSensor.add(ivec2(int(offsetX), int(offsetY))).clamp(ivec2(0, 0), limit);
                    sum.addAssign(dot(vec4(1,1,1,1), texture(readTexture).load(coord)));
                })
            })

            return sum;
        }
        
        const turnSpeed = float(0.1).mul(TWO_PI);
        const randomTurnStrength = hash(instanceIndex.add(time).mul(position.x).add(position.y)).mul(2).sub(1);
        const sensorAngleOffset = float(PI.div(4));
        const weightForward = senseAhead(0.0);
        const weightLeft = senseAhead(sensorAngleOffset);
        const weightRight = senseAhead(sensorAngleOffset.negate());

        If(and(weightForward.greaterThan(weightLeft), weightForward.greaterThan(weightRight)), () => {
            agentStorage.element(instanceIndex).z.addAssign(0.0);
        }).ElseIf(and(weightForward.lessThan(weightLeft), weightForward.lessThan(weightRight)), () => {
            agentStorage.element(instanceIndex).z.addAssign(randomTurnStrength.sub(0.5).mul(2).mul(turnSpeed));
        }).ElseIf(weightForward.greaterThan(weightLeft), () => {
            agentStorage.element(instanceIndex).z.subAssign(randomTurnStrength.mul(turnSpeed));
        }).ElseIf(weightForward.greaterThan(weightRight), () => {
            agentStorage.element(instanceIndex).z.addAssign(randomTurnStrength.mul(turnSpeed));
        })

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
        
        // reflect at random(ish) angle
        If(didHit.greaterThan(0.5), () => {
            const randomAngleOffset = hash(instanceIndex.add(time)).mul(2).sub(1);
            const newAngle = targetAngle.add(randomAngleOffset);
            agentStorage.element(instanceIndex).z.assign(newAngle);
        })

        agentStorage.element(instanceIndex).xy.assign(vec2(newPositionX, newPositionY));

        // write to trail
        const trailCoords = ivec2(int(position.x.add(limitX)), int(position.y.add(limitY)));
        textureStore(writeTexture, trailCoords, vec4(1,1,1,1));
    });

    return agentComputeTask;
}


function fadeAndDiffuseTSL() {
    const fadeAndDiffuseComputeTask = Fn(({ readTexture, writeTexture}) => {

        const coordX = int(instanceIndex).mod(int(width));
        const coordY = int(instanceIndex).div(int(width));
        const center = ivec2(coordX, coordY);

        const limit = ivec2(int(width).sub(1), int(height).sub(1));
        // values at 5 points
        const getVal = (offset) => {
            const coord = center.add(offset).clamp(ivec2(0, 0), limit);
            return texture(readTexture).load(coord);
        };

        const sum = getVal(ivec2(0, 0))
            .add(getVal(ivec2(0, 1)))
            .add(getVal(ivec2(0, -1)))
            .add(getVal(ivec2(1, 0)))
            .add(getVal(ivec2(-1, 0)));

        const averageFadeAndDiffuse = sum.div(5).mul(0.99);

        textureStore(writeTexture, center, averageFadeAndDiffuse)
    })

    return fadeAndDiffuseComputeTask;
}


function onWindowResize() {

    // TODO fix resize issue with texture (texture must be resized instead of because shader references new width and height)
    width = window.innerWidth;
    height = window.innerHeight;

    if (camera) {
        camera.left = -width / 2;
        camera.right = width / 2;
        camera.top = height / 2;
        camera.bottom = -height / 2;
        camera.updateProjectionMatrix();
    }

    if (renderer) {
        renderer.setSize(width, height);
    }

    limitX.value = width / 2;
    limitY.value = height / 2;
}

function swapTrailMapBuffers() {
    const temp = trailMapReadTarget;
    trailMapReadTarget = trailMapWriteTarget;
    trailMapWriteTarget = temp;
}

function animate() {
    
    renderer.compute(fadeAndDiffuseComputeNode({ 
        readTexture: trailMapReadTarget, writeTexture: trailMapWriteTarget 
    }).compute(width * height))

    renderer.compute(agentComputeNode({ 
        writeTexture: trailMapWriteTarget 
    }).compute(agentCount));

    trailMap.material.colorNode = texture(trailMapWriteTarget);
    
    scene.backgroundNode = backgroundNode;
    renderer.render(scene, camera);

    swapTrailMapBuffers() // Ping Pong Buffers
}