import {CNode3DGroup} from "./CNode3DGroup";
import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Plane,
    Raycaster,
    SphereGeometry,
    TextureLoader,
    Vector3
} from "three";
import * as LAYER from "../LayerMasks";
import {getLocalUpVector} from "../SphericalMath";
import {EUSToLLA, LLAToEUS} from "../LLA-ECEF-ENU";
import {makeMouseRay} from "../mouseMoveView";
import {ViewMan} from "../CViewManager";
import {CustomManager, Globals, guiMenus, setRenderOne, Synth3DManager, UndoManager} from "../Globals";
import {mouseInViewOnly} from "../ViewUtils";
import {f2m} from "../utils";
import {SITREC_APP} from "../configUtils";
import seedrandom from "seedrandom";

let rng;

function getRandomFloat(min, max) {
    return rng() * (max - min) + min;
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
        this.cloudSize = v.cloudSize !== undefined ? v.cloudSize : 200;
        this.density = v.density !== undefined ? v.density : 0.5;
        this.opacity = v.opacity !== undefined ? v.opacity : 0.8;
        this.seed = v.seed !== undefined ? v.seed : Math.floor(Math.random() * 10000);
        
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
    
    buildCloudMesh() {
        if (this.cloudMesh) {
            this.group.remove(this.cloudMesh);
            if (this.cloudGeometry) this.cloudGeometry.dispose();
            if (this.cloudMesh.material) this.cloudMesh.material.dispose();
        }
        
        const centerEUS = LLAToEUS(this.centerLat, this.centerLon, this.altitude);
        const localUp = getLocalUpVector(centerEUS);
        
        const east = new Vector3(1, 0, 0).cross(localUp).normalize();
        const north = new Vector3().crossVectors(localUp, east).normalize();
        
        rng = seedrandom(this.seed.toString());
        
        const indices = [];
        const vertices = [];
        const normals = [];
        const uvs = [];
        
        const numClouds = Math.floor(this.density * this.radius * this.radius * 0.0001);
        const w = this.cloudSize;
        const h = this.cloudSize * 0.5;
        const xz = w / Math.sqrt(2);
        
        let index = 0;
        for (let i = 0; i < numClouds; i++) {
            const angle = getRandomFloat(0, Math.PI * 2);
            const dist = Math.sqrt(getRandomFloat(0, 1)) * this.radius;
            
            const offsetX = Math.cos(angle) * dist;
            const offsetZ = Math.sin(angle) * dist;
            const heightVariation = getRandomFloat(-h * 0.3, h * 0.3);
            
            const pos = centerEUS.clone()
                .add(east.clone().multiplyScalar(offsetX))
                .add(north.clone().multiplyScalar(offsetZ))
                .add(localUp.clone().multiplyScalar(heightVariation));
            
            const eastDir = east.clone().multiplyScalar(xz / 2);
            const northDir = north.clone().multiplyScalar(xz);
            const upDir = localUp.clone().multiplyScalar(h / 2);
            
            const v0 = pos.clone().sub(eastDir).add(upDir).add(northDir);
            const v1 = pos.clone().add(eastDir).add(upDir).sub(northDir);
            const v2 = pos.clone().sub(eastDir).sub(upDir).add(northDir);
            const v3 = pos.clone().add(eastDir).sub(upDir).sub(northDir);
            
            vertices.push(v0.x, v0.y, v0.z);
            vertices.push(v1.x, v1.y, v1.z);
            vertices.push(v2.x, v2.y, v2.z);
            vertices.push(v3.x, v3.y, v3.z);
            
            normals.push(localUp.x, localUp.y, localUp.z);
            normals.push(localUp.x, localUp.y, localUp.z);
            normals.push(localUp.x, localUp.y, localUp.z);
            normals.push(localUp.x, localUp.y, localUp.z);
            
            uvs.push(0, 1);
            uvs.push(1, 1);
            uvs.push(0, 0);
            uvs.push(1, 0);
            
            indices.push(index, index + 2, index + 1);
            indices.push(index + 2, index + 3, index + 1);
            
            index += 4;
        }
        
        this.cloudGeometry = new BufferGeometry();
        this.cloudGeometry.setIndex(indices);
        this.cloudGeometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
        this.cloudGeometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
        this.cloudGeometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
        
        const cloudMaterial = new MeshStandardMaterial({
            map: this.cloudTexture,
            transparent: true,
            opacity: this.opacity,
            side: DoubleSide,
            depthWrite: false,
        });
        
        this.cloudMesh = new Mesh(this.cloudGeometry, cloudMaterial);
        this.cloudMesh.layers.mask = LAYER.MASK_WORLD;
        this.group.add(this.cloudMesh);
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
                    
                    if (newAltitude > 100 && newAltitude < 50000) {
                        this.altitude = newAltitude;
                        this.buildCloudMesh();
                        this.createControlHandles();
                        this.updateGUIControllers();
                    }
                } else if (this.draggingHandle === 'radius') {
                    // Calculate new radius based on distance from initial center to current intersection
                    const newRadius = currentIntersection.distanceTo(this.dragInitialCenterEUS);
                    if (newRadius > 50 && newRadius < 50000) {
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
                    this.buildCloudMesh();
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
            this.isDragging = false;
            this.draggingHandle = null;
            
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
        this.altitudeHandle.position.copy(centerEUS);
        this.altitudeHandle.layers.mask = LAYER.MASK_HELPERS;
        this.group.add(this.altitudeHandle);
        
        const radiusMaterial = new MeshBasicMaterial({color: 0x00ffff, depthTest: false, transparent: true, opacity: 0.8});
        this.radiusHandle = new Mesh(handleGeometry.clone(), radiusMaterial);
        this.radiusHandle.position.copy(centerEUS.clone().add(east.clone().multiplyScalar(this.radius)));
        this.radiusHandle.layers.mask = LAYER.MASK_HELPERS;
        this.group.add(this.radiusHandle);
        
        const moveMaterial = new MeshBasicMaterial({color: 0xff8800, depthTest: false, transparent: true, opacity: 0.8});
        this.moveHandle = new Mesh(handleGeometry.clone(), moveMaterial);
        const movePos = centerEUS.clone().add(east.clone().multiplyScalar(-this.radius * 0.5));
        this.moveHandle.position.copy(movePos);
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
        
        const handles = [this.altitudeHandle, this.radiusHandle, this.moveHandle];
        handles.forEach(handle => {
            if (handle) {
                const scale = view.pixelsToMeters(handle.position, handlePixelSize);
                // SphereGeometry with radius 3m, so scale to get handlePixelSize on screen
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
            cloudSize: this.cloudSize,
            density: this.density,
            opacity: this.opacity,
            seed: this.seed
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
            cloudSize: data.cloudSize,
            density: data.density,
            opacity: data.opacity,
            seed: data.seed
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
