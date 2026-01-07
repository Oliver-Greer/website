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
    select,
    and,
    instanceIndex,
    vertexIndex,
    sin,
    cos,
    pow2,
    pow3,
    PI,
    TWO_PI,
    hash,
    uniform,
    time,
    deltaTime,
    dot,
} from 'three/tsl';

let renderer, scene, camera, backgroundNode;
let agentStorage;
let trailMapWriteTarget, trailMapReadTarget;
let trailMap, agentComputeNode, fadeAndDiffuseComputeNode;
let width = window.innerWidth;
let height = window.innerHeight;

// agent count must be multiple of 64 for GPU thread dispatch
const agentCount = 10_048;
const textureWidth = width / 4;
const textureHeight = height / 4;

// modifiable params min/max
const sensorOffsetDistanceMin = 5.0;
const sensorOffsetDistanceMax = 20.0;
const sensorAngleOffsetMin = Math.PI / 6;
const sensorAngleOffsetMax = Math.PI / 2;
const sensorSizeMin = 2.0;
const sensorSizeMax = 6.0;
const turnSpeedMin = 6.0;
const turnSpeedMax = 10.0;
const moveSpeedMin = 5.0;
const moveSpeedMax = 30.0;

const resolution = uniform(vec2(textureWidth, textureHeight));
const limitX = uniform(textureWidth / 2); 
const limitY = uniform(textureHeight / 2);
const sensorOffsetDistance = uniform(10.0);
const sensorSize = uniform(4.0);
const turnSpeed = uniform(8);
const sensorAngleOffset = uniform(Math.PI / 3);
const moveSpeed = uniform(10);

const resistancePointX = uniform(0);
const resistancePointY = uniform(0);
const resistanceRadius = uniform(10);

const trailColor = uniform(new THREE.Color(Math.random() / 2, Math.random() / 2, Math.random() / 2, 1));
const diffuseFactor = uniform(0.97);

initScene();

async function initScene() {

    // randomize trail color onclick
    document.body.addEventListener('click', (event) => {
        randomizeUniforms();

        // create resistance at mouse pointer
        resistancePointX.value = (event.offsetX) / 4 - limitX.value;
        resistancePointY.value = (height - event.offsetY) / 4 - limitY.value;
        console.log(resistancePointX.value);
        console.log(resistancePointY.value);
    })

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
        agentPositionAngleData[startIndex] = Math.random() * textureWidth * 2 - textureWidth;
        agentPositionAngleData[startIndex + 1] = Math.random() * textureHeight * 2 - textureHeight;
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

    const trailBuffer1 = new THREE.StorageTexture(textureWidth, textureHeight);
    trailBuffer1.type = THREE.FloatType;
    trailBuffer1.minFilter = THREE.NearestFilter;
    trailBuffer1.magFilter = THREE.NearestFilter;

    const trailBuffer2 = new THREE.StorageTexture(textureWidth, textureHeight);
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
    material.colorNode = color(0xFFFFFF00);

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
    renderer.domElement.classList.add("background-canvas");
    document.body.appendChild(renderer.domElement);

    randomizeUniforms()
    onWindowResize();
    agentComputeNode = agentTSL();
    fadeAndDiffuseComputeNode = fadeAndDiffuseTSL();

    window.addEventListener('resize', onWindowResize);

    renderer.setAnimationLoop(animate);
}


function agentTSL() {
    const agentComputeTask = Fn(({ readTexture, writeTexture }) => {

        const position = agentStorage.element(instanceIndex).xy;
        const limit = ivec2(int(resolution.x).sub(1), int(resolution.y).sub(1));

        const senseAhead = (senseAngleOffset) => {
            const sensorAngle = agentStorage.element(instanceIndex).z.add(senseAngleOffset);
            const senseDir = vec2(cos(sensorAngle), sin(sensorAngle));

            const coords = vec2(position.x.add(limitX), position.y.add(limitY));
            const posOfSensor = coords.add(senseDir.mul(sensorOffsetDistance));

            const sum = float(0.0).toVar();

            Loop({
                start: int(sensorSize.negate()),
                end: int(sensorSize).add(1),
                type: 'int',
                condition: '<',
                name: 'offsetX'
            }, ({ offsetX }) => {
                Loop({
                    start: int(sensorSize.negate()),
                    end: int(sensorSize).add(1),
                    type: 'int',
                    condition: '<',
                    name: 'offsetY'
                }, ({ offsetY }) => {
                    const samplePos = ivec2(
                        int(posOfSensor.x.add(float(offsetX))), 
                        int(posOfSensor.y.add(float(offsetY)))
                    );

                    const insideScreen = and(
                        samplePos.x.greaterThanEqual(0),
                        samplePos.x.lessThanEqual(limit.x),
                        samplePos.y.greaterThanEqual(0),
                        samplePos.y.lessThanEqual(limit.y)
                    );

                    const value = select(insideScreen, texture(readTexture).load(samplePos), vec4(0))
                    sum.addAssign(dot(vec4(1,1,1,1), value));
                })
            })

            return sum;
        }
        
        const randomTurnStrength = hash(instanceIndex.add(time)).mul(2).sub(1);
        const weightForward = senseAhead(0.0);
        const weightLeft = senseAhead(sensorAngleOffset);
        const weightRight = senseAhead(sensorAngleOffset.negate());

        If(and(weightForward.greaterThan(weightLeft), weightForward.greaterThan(weightRight)), () => {
            agentStorage.element(instanceIndex).z.addAssign(0.0);
        }).ElseIf(and(weightForward.lessThan(weightLeft), weightForward.lessThan(weightRight)), () => {
            agentStorage.element(instanceIndex).z.addAssign(randomTurnStrength.sub(0.5).mul(turnSpeed).mul(TWO_PI).mul(deltaTime));
        }).ElseIf(weightForward.greaterThan(weightLeft), () => {
            agentStorage.element(instanceIndex).z.subAssign(randomTurnStrength.mul(turnSpeed).mul(deltaTime));
        }).ElseIf(weightForward.greaterThan(weightRight), () => {
            agentStorage.element(instanceIndex).z.addAssign(randomTurnStrength.mul(turnSpeed).mul(deltaTime));
        })

        const newPositionY = position.y.add(sin(agentStorage.element(instanceIndex).z).mul(moveSpeed).mul(deltaTime)).toVar();
        const newPositionX = position.x.add(cos(agentStorage.element(instanceIndex).z).mul(moveSpeed).mul(deltaTime)).toVar();

        // modify position based on resistance point
        const newPos = vec2(newPositionX, newPositionY).toVar();
        const resistancePoint = vec2(resistancePointX, resistancePointY);
        const dist = newPos.distance(resistancePoint);
        const dir = newPos.sub(resistancePoint).normalize();

        If(dist.lessThan(pow2(resistanceRadius)), () => {
            
            const proximity = dist.div(resistanceRadius).saturate();
            const pushChance = pow3(proximity);

            const rand = hash(instanceIndex.add(time));

            If(rand.lessThan(pushChance), () => {
                newPositionX.addAssign(dir.x.mul(moveSpeed));
                newPositionY.addAssign(dir.y.mul(moveSpeed));
            })
        })
        
        const didHit = float(0).toVar();
        const targetAngle = float(0).toVar();

        If(newPositionX.greaterThan(limitX), () => {
            newPositionX.assign(limitX.sub(0.5));
            targetAngle.assign(PI);
            didHit.assign(1);
        })
        If(newPositionX.lessThan(limitX.negate()), () => {
            newPositionX.assign(limitX.negate().add(0.5));
            targetAngle.assign(0);
            didHit.assign(1);
        })
        If(newPositionY.greaterThan(limitY), () => {
            newPositionY.assign(limitY.sub(0.5));
            targetAngle.assign(PI.div(2).negate());
            didHit.assign(1);
        })
        If(newPositionY.lessThan(limitY.negate()), () => {
            newPositionY.assign(limitY.negate().add(0.5));
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
        textureStore(writeTexture, trailCoords, trailColor);
    });

    return agentComputeTask;
}


function fadeAndDiffuseTSL() {
    const fadeAndDiffuseComputeTask = Fn(({ readTexture, writeTexture}) => {

        const coordX = int(instanceIndex).mod(int(resolution.x));
        const coordY = int(instanceIndex).div(int(resolution.x));
        const center = ivec2(coordX, coordY);

        const limit = ivec2(int(resolution.x).sub(1), int(resolution.y).sub(1));
        // values at 5 points
        const getVal = (offset) => {
            const coord = center.add(offset).clamp(ivec2(0, 0), limit);
            return texture(readTexture).load(coord);
        };

        const sum = getVal(ivec2(0, 0))
            .add(getVal(ivec2(0, 1)))
            .add(getVal(ivec2(0, -1)))
            .add(getVal(ivec2(1, 0)))
            .add(getVal(ivec2(-1, 0)))
            .add(getVal(ivec2(1, 1)))
            .add(getVal(ivec2(-1, -1)))
            .add(getVal(ivec2(-1, 1)))
            .add(getVal(ivec2(1, 1)));

        const averageFadeAndDiffuse = sum.div(9).mul(diffuseFactor);

        textureStore(writeTexture, center, averageFadeAndDiffuse)
    })

    return fadeAndDiffuseComputeTask;
}


function randomizeUniforms() {
    trailColor.value = new THREE.Color(Math.random() / 2, Math.random() / 2, Math.random() / 2, 1);

    const getRandVal = (max, min) => {
        return Math.random() * (max - min) + min
    }
    sensorOffsetDistance.value = getRandVal(sensorOffsetDistanceMax, sensorOffsetDistanceMin);
    sensorAngleOffset.value = getRandVal(sensorAngleOffsetMax, sensorAngleOffsetMin);
    turnSpeed.value = getRandVal(turnSpeedMax, turnSpeedMin);
    moveSpeed.value = getRandVal(moveSpeedMax, moveSpeedMin);
    sensorSize.value = getRandVal(sensorSizeMax, sensorSizeMin);
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
        readTexture: trailMapReadTarget, writeTexture: trailMapWriteTarget 
    }).compute(agentCount));

    swapTrailMapBuffers() // Ping Pong Buffers

    trailMap.material.colorNode = texture(trailMapWriteTarget);
    
    scene.backgroundNode = backgroundNode;
    renderer.render(scene, camera);
}