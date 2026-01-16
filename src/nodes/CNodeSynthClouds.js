import {CNode3DGroup} from "./CNode3DGroup";
import {
    Color,
    DoubleSide,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    MeshBasicMaterial,
    Plane,
    PlaneGeometry,
    Raycaster,
    ShaderMaterial,
    SphereGeometry,
    TextureLoader,
    Vector3
} from "three";
import * as LAYER from "../LayerMasks";
import {dropFromDistance, getLocalNorthVector, getLocalUpVector} from "../SphericalMath";
import {EUSToLLA, LLAToEUS, wgs84} from "../LLA-ECEF-ENU";
import {makeMouseRay} from "../mouseMoveView";
import {ViewMan} from "../CViewManager";
import {CustomManager, Globals, guiMenus, NodeMan, setRenderOne, Sit, Synth3DManager, UndoManager} from "../Globals";
import {mouseInViewOnly} from "../ViewUtils";
import {f2m, metersPerSecondFromKnots, radians} from "../utils";
import {SITREC_APP} from "../configUtils";
import seedrandom from "seedrandom";
import {sharedUniforms} from "../js/map33/material/SharedUniforms";
import {par} from "../par";

let rng;

function getRandomFloat(min, max) {
    return rng() * (max - min) + min;
}

function buildEdgeRadiusTable(baseRadius, wiggle, frequency, seed) {
    const TABLE_SIZE = 3600;
    const table = new Float32Array(TABLE_SIZE);
    
    if (wiggle <= 0) {
        table.fill(baseRadius);
        return { table, maxRadius: baseRadius };
    }
    
    const rngEdge = seedrandom(seed.toString() + '_edge');
    const phases = new Float32Array(frequency);
    const amps = new Float32Array(frequency);
    
    for (let i = 0; i < frequency; i++) {
        phases[i] = rngEdge() * Math.PI * 2;
        amps[i] = (1 / (i + 1)) * wiggle * baseRadius;
    }
    
    let maxRadius = 0;
    for (let t = 0; t < TABLE_SIZE; t++) {
        const angle = (t / TABLE_SIZE) * Math.PI * 2;
        let offset = 0;
        for (let i = 0; i < frequency; i++) {
            offset += Math.sin(angle * (i + 1) + phases[i]) * amps[i];
        }
        table[t] = baseRadius + offset;
        if (table[t] > maxRadius) maxRadius = table[t];
    }
    
    return { table, maxRadius };
}

function getEdgeRadiusFromTable(table, angle) {
    const TABLE_SIZE = 3600;
    const TWO_PI = Math.PI * 2;
    const normalizedAngle = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
    const indexFloat = (normalizedAngle / TWO_PI) * TABLE_SIZE;
    const index0 = Math.floor(indexFloat) % TABLE_SIZE;
    const index1 = (index0 + 1) % TABLE_SIZE;
    const frac = indexFloat - Math.floor(indexFloat);
    return table[index0] * (1 - frac) + table[index1] * frac;
}

export class CNodeSynthClouds extends CNode3DGroup {
    constructor(v) {
        super(v);
        
        this.cloudsID = v.id;
        this.name = v.name || v.id;
        
        this.centerLat = v.centerLat;
        this.centerLon = v.centerLon;
        this.altitude = v.altitude !== undefined ? v.altitude : f2m(10000);
        this.radius = v.radius !== undefined ? v.radius : 500;
        this.depth = v.depth !== undefined ? v.depth : 0;
        this.edgeWiggle = v.edgeWiggle !== undefined ? v.edgeWiggle : 0;
        this.edgeFrequency = v.edgeFrequency !== undefined ? v.edgeFrequency : 5;
        this.cloudSize = v.cloudSize !== undefined ? v.cloudSize : 200;
        this.density = v.density !== undefined ? v.density : 0.5;
        this.opacity = v.opacity !== undefined ? v.opacity : 0.8;
        this.brightness = v.brightness !== undefined ? v.brightness : 1.0;
        this.seed = v.seed !== undefined ? v.seed : 0;
        
        this.windMode = v.windMode !== undefined ? v.windMode : "No Wind";
        this.windFrom = v.windFrom !== undefined ? v.windFrom : 270;
        this.windKnots = v.windKnots !== undefined ? v.windKnots : 50;
        
        this.basePosition = null;
        
        this.cloudMesh = null;
        this.cloudGeometry = null;
        
        this.cloudTexture = new TextureLoader().load(SITREC_APP + 'data/images/cloud-sprite-flatter.png?v=2');
        
        this.editMode = false;
        this.isDragging = false;
        this.draggingHandle = null;
        this.dragLocalUp = null;
        this.hoveredHandle = null;
        
        this.radiusHandle = null;
        this.altitudeHandle = null;
        this.moveHandle = null;
        
        this.raycaster = new Raycaster();
        this.raycaster.layers.mask = LAYER.MASK_HELPERS;
        
        this.buildCloudMesh();
        this.setupEventListeners();
        this.createGUIFolder();
    }
    
    updateGroupPosition() {
        const centerEUS = LLAToEUS(this.centerLat, this.centerLon, this.altitude);
        this.basePosition = centerEUS.clone();
        this.group.position.copy(centerEUS);
        this.localUp = getLocalUpVector(centerEUS);
    }
    
    buildCloudMesh() {
        if (this.cloudMesh) {
            this.group.remove(this.cloudMesh);
            if (this.cloudGeometry) this.cloudGeometry.dispose();
            if (this.cloudMesh.material) this.cloudMesh.material.dispose();
        }
        
        const centerEUS = LLAToEUS(this.centerLat, this.centerLon, this.altitude);
        this.basePosition = centerEUS.clone();
        this.localUp = getLocalUpVector(centerEUS);
        this.group.position.copy(centerEUS);
        
        const east = new Vector3(1, 0, 0).cross(this.localUp).normalize();
        const north = new Vector3().crossVectors(this.localUp, east).normalize();
        
        rng = seedrandom(this.seed.toString());
        
        const numClouds = Math.floor(this.density * this.radius * this.radius * 0.0001);
        
        const offsets = new Float32Array(numClouds * 3);
        const sizes = new Float32Array(numClouds * 2);
        
        const w = this.cloudSize;
        const h = this.cloudSize * 0.5;
        const hVar = h * 0.3;
        const halfDepth = this.depth / 2;
        
        const ex = east.x, ey = east.y, ez = east.z;
        const nx = north.x, ny = north.y, nz = north.z;
        const ux = this.localUp.x, uy = this.localUp.y, uz = this.localUp.z;
        
        const { table: edgeRadiusTable, maxRadius: sampleRadius } = buildEdgeRadiusTable(this.radius, this.edgeWiggle, this.edgeFrequency, this.seed);
        
        let cloudIndex = 0;
        let attempts = 0;
        const maxAttempts = numClouds * 10;
        
        while (cloudIndex < numClouds && attempts < maxAttempts) {
            attempts++;
            const angle = rng() * Math.PI * 2;
            const dist = Math.sqrt(rng()) * sampleRadius;
            const maxRadius = getEdgeRadiusFromTable(edgeRadiusTable, angle);
            
            if (dist > maxRadius) continue;
            
            const drop = dropFromDistance(dist);

            const offsetX = Math.cos(angle) * dist;
            const offsetZ = Math.sin(angle) * dist;
            const depthOffset = halfDepth > 0 ? (rng() * this.depth - halfDepth) : 0;
            const heightVariation = (rng() * hVar * 2 - hVar) + depthOffset - drop;
            
            const idx3 = cloudIndex * 3;
            offsets[idx3] = ex * offsetX + nx * offsetZ + ux * heightVariation;
            offsets[idx3 + 1] = ey * offsetX + ny * offsetZ + uy * heightVariation;
            offsets[idx3 + 2] = ez * offsetX + nz * offsetZ + uz * heightVariation;
            
            const idx2 = cloudIndex * 2;
            sizes[idx2] = w;
            sizes[idx2 + 1] = h;
            
            cloudIndex++;
        }
        
        const actualCloudCount = cloudIndex;
        
        const baseQuad = new PlaneGeometry(1, 1);
        this.cloudGeometry = new InstancedBufferGeometry();
        this.cloudGeometry.index = baseQuad.index;
        this.cloudGeometry.setAttribute('position', baseQuad.getAttribute('position'));
        this.cloudGeometry.setAttribute('uv', baseQuad.getAttribute('uv'));
        this.cloudGeometry.setAttribute('instanceOffset', new InstancedBufferAttribute(offsets, 3));
        this.cloudGeometry.setAttribute('instanceSize', new InstancedBufferAttribute(sizes, 2));
        this.cloudGeometry.instanceCount = actualCloudCount;
        
        const baseColor = Math.min(this.brightness, 1.0);
        const emissiveIntensity = Math.max(0, this.brightness - 1.0);
        
        const cloudMaterial = new ShaderMaterial({
            uniforms: {
                map: { value: this.cloudTexture },
                opacity: { value: this.opacity },
                color: { value: new Color(baseColor, baseColor, baseColor) },
                emissive: { value: new Color(emissiveIntensity, emissiveIntensity, emissiveIntensity) },
                sunDirection: { value: new Vector3(0, 1, 0) },
                earthCenter: { value: new Vector3(0, -wgs84.RADIUS, 0) },
                ...sharedUniforms,
            },
            vertexShader: `
                attribute vec3 instanceOffset;
                attribute vec2 instanceSize;
                varying vec2 vUv;
                varying float vDepth;
                varying vec3 vWorldPosition;
                
                void main() {
                    vUv = uv;
                    
                    vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                    vec3 cameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                    
                    vec3 vertexPosition = instanceOffset 
                        + cameraRight * position.x * instanceSize.x 
                        + cameraUp * position.y * instanceSize.y;
                    
                    vec4 worldPos = modelMatrix * vec4(instanceOffset, 1.0);
                    vWorldPosition = worldPos.xyz;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(vertexPosition, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    vDepth = gl_Position.w;
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                uniform float opacity;
                uniform vec3 color;
                uniform vec3 emissive;
                uniform float nearPlane;
                uniform float farPlane;
                uniform vec3 sunDirection;
                uniform vec3 earthCenter;
                uniform float sunAmbientIntensity;
                varying vec2 vUv;
                varying float vDepth;
                varying vec3 vWorldPosition;
                
                void main() {
                    vec4 texColor = texture2D(map, vUv);
                    float alpha = texColor.a * opacity;
                    if (alpha < 0.01) discard;
                    
                    vec3 globalNormal = normalize(vWorldPosition - earthCenter);
                    float globalIntensity = max(dot(globalNormal, sunDirection), -0.1);
                    float dayFactor = smoothstep(-0.1, 0.1, globalIntensity);
                    float lighting = mix(sunAmbientIntensity, 1.0, dayFactor);
                    vec3 litColor = texColor.rgb * color * lighting + emissive;
                    gl_FragColor = vec4(litColor, alpha);
                    
                    float z = (log2(max(nearPlane, 1.0 + vDepth)) / log2(1.0 + farPlane)) * 2.0 - 1.0;
                    gl_FragDepthEXT = z * 0.5 + 0.5;
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
        });
        
        this.cloudMesh = new Mesh(this.cloudGeometry, cloudMaterial);
        this.cloudMesh.layers.mask = LAYER.MASK_WORLD;
        this.cloudMesh.frustumCulled = false;
        this.group.add(this.cloudMesh);
    }
    
    getWindVector() {
        if (this.windMode === "No Wind") {
            return new Vector3(0, 0, 0);
        }
        
        let windFrom, windKnots;
        
        if (this.windMode === "Use Local") {
            const localWind = NodeMan.get("localWind", false);
            if (!localWind) return new Vector3(0, 0, 0);
            windFrom = localWind.from;
            windKnots = localWind.knots;
        } else if (this.windMode === "Use Target") {
            const targetWind = NodeMan.get("targetWind", false);
            if (!targetWind) return new Vector3(0, 0, 0);
            windFrom = targetWind.from;
            windKnots = targetWind.knots;
        } else {
            windFrom = this.windFrom;
            windKnots = this.windKnots;
        }
        
        const position = this.basePosition || this.group.position;
        let wind = getLocalNorthVector(position);
        wind.multiplyScalar(metersPerSecondFromKnots(windKnots));
        const posUp = getLocalUpVector(position);
        wind.applyAxisAngle(posUp, radians(180 - windFrom));
        
        return wind;
    }
    
    preRender(view) {
        if (!this.cloudMesh || !this.cloudMesh.material || !this.cloudMesh.material.uniforms) return;
        
        if (Globals.sunLight) {
            this.cloudMesh.material.uniforms.sunDirection.value.copy(Globals.sunLight.position).normalize();
        }
        
        if (this.basePosition) {
            if (this.windMode === "No Wind") {
                this.group.position.copy(this.basePosition);
            } else {
                const wind = this.getWindVector();
                const frame = par.frame || 0;
                const timeSeconds = frame / (Sit.fps || 30);
                const offset = wind.clone().multiplyScalar(timeSeconds);
                this.group.position.copy(this.basePosition).add(offset);
            }
        }
    }
    
    setupEventListeners() {
        this.onPointerDownBound = this.onPointerDown.bind(this);
        this.onPointerMoveBound = this.onPointerMove.bind(this);
        this.onPointerUpBound = this.onPointerUp.bind(this);
        
        document.addEventListener('pointerdown', this.onPointerDownBound);
        document.addEventListener('pointermove', this.onPointerMoveBound);
        document.addEventListener('pointerup', this.onPointerUpBound);
    }
    
    onPointerDown(event) {
        if (!this.editMode) return;
        if (event.button !== 0) return; // Only left mouse button
        
        // Check if clicking on a GUI element - menus should have priority
        let target = event.target;
        while (target) {
            if (target.classList && target.classList.contains('lil-gui')) {
                return; // Click is on GUI, don't handle it
            }
            target = target.parentElement;
        }
        
        const view = ViewMan.get("mainView");
        if (!view) return;
        if (!mouseInViewOnly(view, event.clientX, event.clientY)) return;
        
        const handle = this.getHandleAtMouse(event.clientX, event.clientY);
        if (handle) {
            // Store initial values for relative dragging
            this.dragInitialAltitude = this.altitude;
            this.dragInitialRadius = this.radius;
            this.dragInitialLat = this.centerLat;
            this.dragInitialLon = this.centerLon;
            
            const centerEUS = LLAToEUS(this.centerLat, this.centerLon, this.altitude);
            this.dragLocalUp = getLocalUpVector(centerEUS);
            this.dragInitialCenterEUS = centerEUS.clone();
            
            // Calculate initial intersection point on the drag plane
            const mouseYUp = view.heightPx - (event.clientY - view.topPx);
            const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
            this.raycaster.setFromCamera(mouseRay, view.camera);
            
            const plane = new Plane();
            if (handle === 'altitude') {
                // Create vertical plane facing camera (allows height adjustment)
                const toCamera = view.camera.position.clone().sub(centerEUS).normalize();
                const tangent = new Vector3().crossVectors(this.dragLocalUp, toCamera).normalize();
                const planeNormal = new Vector3().crossVectors(tangent, this.dragLocalUp).normalize();
                plane.setFromNormalAndCoplanarPoint(planeNormal, centerEUS);
            } else {
                plane.setFromNormalAndCoplanarPoint(this.dragLocalUp, centerEUS);
            }
            
            this.dragInitialIntersection = new Vector3();
            const intersected = this.raycaster.ray.intersectPlane(plane, this.dragInitialIntersection);
            if (!intersected) {
                return; // Can't establish drag plane intersection
            }
            
            this.isDragging = true;
            this.draggingHandle = handle;
            
            // Disable camera controls while dragging
            if (view.controls) {
                view.controls.enabled = false;
            }
            
            event.stopPropagation();
            event.preventDefault();
        }
    }
    
    onPointerMove(event) {
        if (!this.editMode) return;
        
        if (this.isDragging && this.draggingHandle) {
            const view = ViewMan.get("mainView");
            if (!view) return;
            
            const mouseYUp = view.heightPx - (event.clientY - view.topPx);
            const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
            this.raycaster.setFromCamera(mouseRay, view.camera);
            
            // Use INITIAL center position for plane - this is key for relative dragging
            const plane = new Plane();
            if (this.draggingHandle === 'altitude') {
                // Create vertical plane facing camera (allows height adjustment)
                const toCamera = view.camera.position.clone().sub(this.dragInitialCenterEUS).normalize();
                const tangent = new Vector3().crossVectors(this.dragLocalUp, toCamera).normalize();
                const planeNormal = new Vector3().crossVectors(tangent, this.dragLocalUp).normalize();
                plane.setFromNormalAndCoplanarPoint(planeNormal, this.dragInitialCenterEUS);
            } else {
                plane.setFromNormalAndCoplanarPoint(this.dragLocalUp, this.dragInitialCenterEUS);
            }
            
            const currentIntersection = new Vector3();
            if (this.raycaster.ray.intersectPlane(plane, currentIntersection)) {
                // Calculate displacement from initial click point
                const displacement = currentIntersection.clone().sub(this.dragInitialIntersection);
                
                if (this.draggingHandle === 'altitude') {
                    const heightDiff = displacement.dot(this.dragLocalUp);
                    const newAltitude = this.dragInitialAltitude + heightDiff;
                    
                    const limits = this.altitudeController?.getSILimits() ?? { min: 0, max: 20000 };
                    if (newAltitude >= limits.min && newAltitude <= limits.max) {
                        this.altitude = newAltitude;
                        this.updateGroupPosition();
                        this.createControlHandles();
                        this.updateGUIControllers();
                    }
                } else if (this.draggingHandle === 'radius') {
                    const newRadius = currentIntersection.distanceTo(this.dragInitialCenterEUS);
                    const limits = this.radiusController?.getSILimits() ?? { min: 100, max: 100000 };
                    if (newRadius >= limits.min && newRadius <= limits.max) {
                        this.radius = newRadius;
                        this.buildCloudMesh();
                        this.createControlHandles();
                        this.updateGUIControllers();
                    }
                } else if (this.draggingHandle === 'move') {
                    // Move center by displacement
                    const newCenterEUS = this.dragInitialCenterEUS.clone().add(displacement);
                    const lla = EUSToLLA(newCenterEUS);
                    this.centerLat = lla.x;
                    this.centerLon = lla.y;
                    this.updateGroupPosition();
                    this.createControlHandles();
                }
            }
            
            setRenderOne(true);
            CustomManager.saveGlobalSettings();
        } else {
            const handle = this.getHandleAtMouse(event.clientX, event.clientY);
            if (handle !== this.hoveredHandle) {
                this.hoveredHandle = handle;
                this.updateHandleColors();
                setRenderOne(true);
            }
        }
    }
    
    onPointerUp(event) {
        if (this.isDragging) {
            const wasMoveHandle = this.draggingHandle === 'move';
            this.isDragging = false;
            this.draggingHandle = null;
            
            if (wasMoveHandle) {
                this.buildCloudMesh();
            }
            
            // Re-enable camera controls
            const view = ViewMan.get("mainView");
            if (view && view.controls) {
                view.controls.enabled = true;
            }
            
            CustomManager.saveGlobalSettings();
        }
    }
    
    getHandleAtMouse(mouseX, mouseY) {
        const view = ViewMan.get("mainView");
        if (!view) return null;
        
        const mouseYUp = view.heightPx - (mouseY - view.topPx);
        const mouseRay = makeMouseRay(view, mouseX, mouseYUp);
        
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        const handles = [];
        if (this.altitudeHandle) handles.push({mesh: this.altitudeHandle, name: 'altitude'});
        if (this.radiusHandle) handles.push({mesh: this.radiusHandle, name: 'radius'});
        if (this.moveHandle) handles.push({mesh: this.moveHandle, name: 'move'});
        
        let closest = null;
        let closestDist = Infinity;
        
        for (const h of handles) {
            const intersects = this.raycaster.intersectObject(h.mesh, false);
            if (intersects.length > 0 && intersects[0].distance < closestDist) {
                closestDist = intersects[0].distance;
                closest = h.name;
            }
        }
        
        return closest;
    }
    
    updateHandleColors() {
        if (this.altitudeHandle) {
            const color = this.hoveredHandle === 'altitude' ? 0x00ff00 : 0xffff00;
            this.altitudeHandle.material.color.setHex(color);
        }
        if (this.radiusHandle) {
            const color = this.hoveredHandle === 'radius' ? 0x00ff00 : 0x00ffff;
            this.radiusHandle.material.color.setHex(color);
        }
        if (this.moveHandle) {
            const color = this.hoveredHandle === 'move' ? 0x00ff00 : 0xff8800;
            this.moveHandle.material.color.setHex(color);
        }
    }
    
    createControlHandles() {
        this.removeControlHandles();
        
        if (!this.editMode) return;
        
        const centerEUS = LLAToEUS(this.centerLat, this.centerLon, this.altitude);
        const localUp = getLocalUpVector(centerEUS);
        const east = new Vector3(1, 0, 0).cross(localUp).normalize();
        
        // Use fixed 3m radius geometry (same as buildings) - scaled dynamically in updateHandleScales
        const handleGeometry = new SphereGeometry(3, 16, 16);
        
        const altitudeMaterial = new MeshBasicMaterial({color: 0xffff00, depthTest: false, transparent: true, opacity: 0.8});
        this.altitudeHandle = new Mesh(handleGeometry.clone(), altitudeMaterial);
        this.altitudeHandle.position.set(0, 0, 0);
        this.altitudeHandle.layers.mask = LAYER.MASK_HELPERS;
        this.group.add(this.altitudeHandle);
        
        const radiusMaterial = new MeshBasicMaterial({color: 0x00ffff, depthTest: false, transparent: true, opacity: 0.8});
        this.radiusHandle = new Mesh(handleGeometry.clone(), radiusMaterial);
        this.radiusHandle.position.copy(east.clone().multiplyScalar(this.radius));
        this.radiusHandle.layers.mask = LAYER.MASK_HELPERS;
        this.group.add(this.radiusHandle);
        
        const moveMaterial = new MeshBasicMaterial({color: 0xff8800, depthTest: false, transparent: true, opacity: 0.8});
        this.moveHandle = new Mesh(handleGeometry.clone(), moveMaterial);
        this.moveHandle.position.copy(east.clone().multiplyScalar(-this.radius * 0.5));
        this.moveHandle.layers.mask = LAYER.MASK_HELPERS;
        this.group.add(this.moveHandle);
        
        handleGeometry.dispose(); // Dispose the template
    }
    
    /**
     * Update handle scales to maintain constant screen size (20px)
     * Should be called from the render loop
     * @param {CNodeView3D} view - The view to use for screen-space scaling
     */
    updateHandleScales(view) {
        if (!this.editMode || !view || !view.pixelsToMeters) {
            return;
        }
        
        const handlePixelSize = 20; // Target size in screen pixels
        const worldPos = new Vector3();
        
        const handles = [this.altitudeHandle, this.radiusHandle, this.moveHandle];
        handles.forEach(handle => {
            if (handle) {
                handle.getWorldPosition(worldPos);
                const scale = view.pixelsToMeters(worldPos, handlePixelSize);
                handle.scale.set(scale / 3, scale / 3, scale / 3);
            }
        });
    }
    
    removeControlHandles() {
        if (this.altitudeHandle) {
            this.group.remove(this.altitudeHandle);
            this.altitudeHandle.geometry.dispose();
            this.altitudeHandle.material.dispose();
            this.altitudeHandle = null;
        }
        if (this.radiusHandle) {
            this.group.remove(this.radiusHandle);
            this.radiusHandle.geometry.dispose();
            this.radiusHandle.material.dispose();
            this.radiusHandle = null;
        }
        if (this.moveHandle) {
            this.group.remove(this.moveHandle);
            this.moveHandle.geometry.dispose();
            this.moveHandle.material.dispose();
            this.moveHandle = null;
        }
    }
    
    setEditMode(enabled) {
        this.editMode = enabled;
        
        if (enabled) {
            Globals.editingClouds = this;
            this.createControlHandles();
        } else {
            if (Globals.editingClouds === this) {
                Globals.editingClouds = null;
            }
            this.removeControlHandles();
            
            // Close the standalone edit menu if it exists
            if (CustomManager.cloudsEditMenu) {
                CustomManager.cloudsEditMenu.destroy();
                CustomManager.cloudsEditMenu = null;
            }
            
            // Clear controller references (created by showCloudsEditingMenu)
            this.altitudeController = null;
            this.radiusController = null;
            this.altitudeProxy = null;
            this.radiusProxy = null;
            this.windModeController = null;
            this.windFromController = null;
            this.windKnotsController = null;
        }
        
        setRenderOne(true);
    }
    
    createGUIFolder() {
        this.guiFolder = guiMenus.objects.addFolder(`Clouds: ${this.name}`);
        
        this.guiFolder.add(this, 'name').name('Name').onChange(() => {
            this.guiFolder.name = `Clouds: ${this.name}`;
            CustomManager.saveGlobalSettings();
        });
        
        const actions = {
            edit: () => {
                this.setEditMode(true);
                CustomManager.showCloudsEditingMenu(100, 100, null);
            },
            delete: () => {
                if (confirm(`Delete cloud layer "${this.name}"?`)) {
                    if (UndoManager) {
                        const cloudsState = this.serialize();
                        const cloudsID = this.cloudsID;
                        
                        UndoManager.add({
                            undo: () => {
                                Synth3DManager.addClouds(cloudsState);
                            },
                            redo: () => {
                                Synth3DManager.removeClouds(cloudsID);
                            },
                            description: `Delete cloud layer "${this.name}"`
                        });
                    }
                    
                    Synth3DManager.removeClouds(this.cloudsID);
                }
            }
        };
        this.guiFolder.add(actions, 'edit').name('Edit');
        this.guiFolder.add(actions, 'delete').name('Delete Clouds');
    }
    
    updateGUIControllers() {
        if (this.altitudeController) {
            this.altitudeController.setSIValue(this.altitude);
        }
        if (this.radiusController) {
            this.radiusController.setSIValue(this.radius);
        }
    }
    
    serialize() {
        return {
            id: this.cloudsID,
            name: this.name,
            centerLat: this.centerLat,
            centerLon: this.centerLon,
            altitude: this.altitude,
            radius: this.radius,
            depth: this.depth,
            edgeWiggle: this.edgeWiggle,
            edgeFrequency: this.edgeFrequency,
            cloudSize: this.cloudSize,
            density: this.density,
            opacity: this.opacity,
            brightness: this.brightness,
            seed: this.seed,
            windMode: this.windMode,
            windFrom: this.windFrom,
            windKnots: this.windKnots
        };
    }
    
    static deserialize(data) {
        return new CNodeSynthClouds({
            id: data.id,
            name: data.name,
            centerLat: data.centerLat,
            centerLon: data.centerLon,
            altitude: data.altitude,
            radius: data.radius,
            depth: data.depth,
            edgeWiggle: data.edgeWiggle,
            edgeFrequency: data.edgeFrequency,
            cloudSize: data.cloudSize,
            density: data.density,
            opacity: data.opacity,
            brightness: data.brightness,
            seed: data.seed,
            windMode: data.windMode,
            windFrom: data.windFrom,
            windKnots: data.windKnots
        });
    }
    
    dispose() {
        document.removeEventListener('pointerdown', this.onPointerDownBound);
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        document.removeEventListener('pointerup', this.onPointerUpBound);
        
        this.removeControlHandles();
        
        if (this.cloudMesh) {
            this.group.remove(this.cloudMesh);
            if (this.cloudGeometry) this.cloudGeometry.dispose();
            if (this.cloudMesh.material) this.cloudMesh.material.dispose();
            this.cloudMesh = null;
        }
        
        if (this.cloudTexture) {
            this.cloudTexture.dispose();
        }
        
        if (this.guiFolder) {
            this.guiFolder.destroy();
            this.guiFolder = null;
        }
        
        super.dispose();
    }
}
