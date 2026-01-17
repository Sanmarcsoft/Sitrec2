import {CNode3DGroup} from "./CNode3DGroup";
import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Mesh,
    MeshBasicMaterial,
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
import {CustomManager, FileManager, Globals, guiMenus, NodeMan, setRenderOne, Synth3DManager} from "../Globals";
import {mouseInViewOnly} from "../ViewUtils";
import {getPointBelow, pointAbove} from "../threeExt";
import {EventManager} from "../CEventManager";
import {degrees, radians} from "../utils";

export class CNodeGroundOverlay extends CNode3DGroup {
    constructor(v) {
        super(v);
        
        this.overlayID = v.id;
        this.name = v.name || v.id;
        
        this.north = v.north !== undefined ? v.north : 0;
        this.south = v.south !== undefined ? v.south : 0;
        this.east = v.east !== undefined ? v.east : 0;
        this.west = v.west !== undefined ? v.west : 0;
        this.rotation = v.rotation !== undefined ? v.rotation : 0;
        
        this.imageURL = v.imageURL || "";
        this.heightOffset = v.heightOffset !== undefined ? v.heightOffset : 1;
        this.wireframe = v.wireframe !== undefined ? v.wireframe : false;
        
        this.subdivisions = v.subdivisions !== undefined ? v.subdivisions : 100;
        
        this.overlayMesh = null;
        this.overlayMaterial = null;
        this.overlayGeometry = null;
        this.texture = null;
        
        this.editMode = false;
        this.isDragging = false;
        this.draggingHandle = null;
        this.hoveredHandle = null;
        
        this.cornerHandles = [];
        this.rotationHandle = null;
        
        this.raycaster = new Raycaster();
        this.raycaster.layers.mask = LAYER.MASK_HELPERS;
        
        if (this.imageURL) {
            this.loadTexture();
        }
        
        this.buildMesh();
        this.setupEventListeners();
        this.createGUIFolder();
    }
    
    loadTexture() {
        if (!this.imageURL) return;
        
        const loader = new TextureLoader();
        loader.load(this.imageURL, (texture) => {
            this.texture = texture;
            if (this.overlayMaterial) {
                this.overlayMaterial.map = texture;
                this.overlayMaterial.needsUpdate = true;
            }
            setRenderOne(true);
        }, undefined, (error) => {
            console.error(`Failed to load overlay texture: ${this.imageURL}`, error);
        });
    }
    
    getCornerPositions() {
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        const centerEUS = LLAToEUS(centerLat, centerLon, 0);
        
        const rotationRad = radians(this.rotation);
        const cosR = Math.cos(rotationRad);
        const sinR = Math.sin(rotationRad);
        
        const corners = [
            {lat: this.north, lon: this.west},
            {lat: this.north, lon: this.east},
            {lat: this.south, lon: this.east},
            {lat: this.south, lon: this.west}
        ];
        
        return corners.map(corner => {
            let pos = LLAToEUS(corner.lat, corner.lon, 0);
            
            if (this.rotation !== 0) {
                const offset = pos.clone().sub(centerEUS);
                const localUp = getLocalUpVector(centerEUS);
                
                const east = new Vector3(1, 0, 0).cross(localUp).normalize();
                const north = new Vector3().crossVectors(localUp, east).normalize();
                
                const eastComponent = offset.dot(east);
                const northComponent = offset.dot(north);
                
                const rotatedEast = eastComponent * cosR - northComponent * sinR;
                const rotatedNorth = eastComponent * sinR + northComponent * cosR;
                
                pos = centerEUS.clone()
                    .add(east.clone().multiplyScalar(rotatedEast))
                    .add(north.clone().multiplyScalar(rotatedNorth));
            }
            
            return pos;
        });
    }
    
    buildMesh() {
        if (this.overlayMesh) {
            this.group.remove(this.overlayMesh);
            if (this.overlayGeometry) this.overlayGeometry.dispose();
            if (this.overlayMaterial) this.overlayMaterial.dispose();
        }
        
        const corners = this.getCornerPositions();
        
        const nw = corners[0];
        const ne = corners[1];
        const se = corners[2];
        const sw = corners[3];
        
        const subdivs = this.subdivisions;
        const vertices = [];
        const uvs = [];
        const indices = [];
        
        for (let j = 0; j <= subdivs; j++) {
            const v = j / subdivs;
            for (let i = 0; i <= subdivs; i++) {
                const u = i / subdivs;
                
                const topPos = nw.clone().lerp(ne, u);
                const bottomPos = sw.clone().lerp(se, u);
                const pos = topPos.lerp(bottomPos, v);
                
                const groundPos = getPointBelow(pos);
                const adjustedPos = pointAbove(groundPos, this.heightOffset);
                
                vertices.push(adjustedPos.x, adjustedPos.y, adjustedPos.z);
                uvs.push(u, 1 - v);
            }
        }
        
        for (let j = 0; j < subdivs; j++) {
            for (let i = 0; i < subdivs; i++) {
                const a = j * (subdivs + 1) + i;
                const b = a + 1;
                const c = a + (subdivs + 1);
                const d = c + 1;
                
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }
        
        this.overlayGeometry = new BufferGeometry();
        this.overlayGeometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
        this.overlayGeometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
        this.overlayGeometry.setIndex(indices);
        this.overlayGeometry.computeVertexNormals();
        
        this.overlayMaterial = new MeshBasicMaterial({
            map: this.texture,
            side: DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -4,
            wireframe: this.wireframe,
        });
        
        this.overlayMesh = new Mesh(this.overlayGeometry, this.overlayMaterial);
        this.overlayMesh.layers.mask = LAYER.MASK_WORLD;
        this.overlayMesh.frustumCulled = false;
        this.group.add(this.overlayMesh);
        
        setRenderOne(true);
    }
    
    updateMesh() {
        this.buildMesh();
        if (this.editMode) {
            this.createControlPoints();
        }
    }
    
    createControlPoints() {
        this.removeControlPoints();
        
        const corners = this.getCornerPositions();
        const handleSize = 50;
        
        corners.forEach((pos, index) => {
            const groundPos = getPointBelow(pos);
            const adjustedPos = pointAbove(groundPos, this.heightOffset + 5);
            
            const geometry = new SphereGeometry(handleSize, 16, 16);
            const material = new MeshBasicMaterial({color: 0xffff00, transparent: true, opacity: 0.8});
            const handle = new Mesh(geometry, material);
            handle.position.copy(adjustedPos);
            handle.layers.mask = LAYER.MASK_HELPERS;
            handle.userData.cornerIndex = index;
            handle.userData.handleType = 'corner';
            this.group.add(handle);
            this.cornerHandles.push(handle);
        });
        
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        const centerEUS = LLAToEUS(centerLat, centerLon, 0);
        const groundCenter = getPointBelow(centerEUS);
        const adjustedCenter = pointAbove(groundCenter, this.heightOffset + 5);
        
        const rotGeometry = new SphereGeometry(handleSize * 0.8, 16, 16);
        const rotMaterial = new MeshBasicMaterial({color: 0x00ffff, transparent: true, opacity: 0.8});
        this.rotationHandle = new Mesh(rotGeometry, rotMaterial);
        this.rotationHandle.position.copy(adjustedCenter);
        this.rotationHandle.layers.mask = LAYER.MASK_HELPERS;
        this.rotationHandle.userData.handleType = 'rotation';
        this.group.add(this.rotationHandle);
    }
    
    removeControlPoints() {
        this.cornerHandles.forEach(handle => {
            this.group.remove(handle);
            handle.geometry.dispose();
            handle.material.dispose();
        });
        this.cornerHandles = [];
        
        if (this.rotationHandle) {
            this.group.remove(this.rotationHandle);
            this.rotationHandle.geometry.dispose();
            this.rotationHandle.material.dispose();
            this.rotationHandle = null;
        }
    }
    
    setEditMode(enable) {
        if (this.editMode === enable) return;
        
        this.editMode = enable;
        
        if (enable) {
            Globals.editingOverlay = this;
            this.createControlPoints();
        } else {
            if (Globals.editingOverlay === this) {
                Globals.editingOverlay = null;
            }
            this.removeControlPoints();
        }
        
        setRenderOne(true);
    }
    
    setupEventListeners() {
        this.onPointerDownBound = this.onPointerDown.bind(this);
        this.onPointerMoveBound = this.onPointerMove.bind(this);
        this.onPointerUpBound = this.onPointerUp.bind(this);
        
        document.addEventListener('pointerdown', this.onPointerDownBound);
        document.addEventListener('pointermove', this.onPointerMoveBound);
        document.addEventListener('pointerup', this.onPointerUpBound);
        
        EventManager.addEventListener("elevationChanged", () => {
            this.updateMesh();
        });
    }
    
    onPointerDown(event) {
        if (!this.editMode) return;
        
        const view = ViewMan.get("mainView");
        if (!view || !mouseInViewOnly(view, event.clientX, event.clientY)) return;
        
        const mouseYUp = view.heightPx - (event.clientY - view.topPx);
        const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        const handles = [...this.cornerHandles];
        if (this.rotationHandle) handles.push(this.rotationHandle);
        
        const intersects = this.raycaster.intersectObjects(handles, false);
        
        if (intersects.length > 0) {
            this.isDragging = true;
            this.draggingHandle = intersects[0].object;
            event.preventDefault();
            event.stopPropagation();
        }
    }
    
    onPointerMove(event) {
        if (!this.editMode) return;
        
        const view = ViewMan.get("mainView");
        if (!view) return;
        
        if (this.isDragging && this.draggingHandle) {
            const mouseYUp = view.heightPx - (event.clientY - view.topPx);
            const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
            this.raycaster.setFromCamera(mouseRay, view.camera);
            
            if (NodeMan.exists("TerrainModel")) {
                const terrainNode = NodeMan.get("TerrainModel");
                const intersect = terrainNode.getClosestIntersect(this.raycaster);
                if (intersect) {
                    const lla = EUSToLLA(intersect.point);
                    
                    if (this.draggingHandle.userData.handleType === 'corner') {
                        const cornerIndex = this.draggingHandle.userData.cornerIndex;
                        this.updateCorner(cornerIndex, lla.x, lla.y);
                    } else if (this.draggingHandle.userData.handleType === 'rotation') {
                        const centerLat = (this.north + this.south) / 2;
                        const centerLon = (this.east + this.west) / 2;
                        const angle = Math.atan2(lla.y - centerLon, lla.x - centerLat);
                        this.rotation = degrees(angle) - 90;
                    }
                    
                    this.updateMesh();
                    this.updateGUIControllers();
                    CustomManager.saveGlobalSettings();
                }
            }
        }
    }
    
    updateCorner(cornerIndex, lat, lon) {
        switch (cornerIndex) {
            case 0:
                this.north = lat;
                this.west = lon;
                break;
            case 1:
                this.north = lat;
                this.east = lon;
                break;
            case 2:
                this.south = lat;
                this.east = lon;
                break;
            case 3:
                this.south = lat;
                this.west = lon;
                break;
        }
    }
    
    onPointerUp(event) {
        if (this.isDragging) {
            this.isDragging = false;
            this.draggingHandle = null;
            CustomManager.saveGlobalSettings();
        }
    }
    
    updateHandleScales(view) {
        if (!this.editMode || !view || !view.pixelsToMeters) return;
        
        const targetPixels = 10;
        
        this.cornerHandles.forEach(handle => {
            const metersPerPixel = view.pixelsToMeters(handle.position, 1);
            const scale = metersPerPixel * targetPixels;
            handle.scale.set(scale, scale, scale);
        });
        
        if (this.rotationHandle) {
            const metersPerPixel = view.pixelsToMeters(this.rotationHandle.position, 1);
            const scale = metersPerPixel * targetPixels * 0.8;
            this.rotationHandle.scale.set(scale, scale, scale);
        }
    }
    
    createGUIFolder() {
        this.guiFolder = guiMenus.objects.addFolder(this.name);
        
        this.guiFolder.add(this, 'imageURL').name('Image URL').onChange(() => {
            this.loadTexture();
            CustomManager.saveGlobalSettings();
        });
        
        this.guiFolder.add({rehost: () => this.showRehostDialog()}, 'rehost').name('Rehost Local Image');
        
        this.guiFolder.add(this, 'north', -90, 90, 0.0001).name('North').onChange(() => {
            this.updateMesh();
            CustomManager.saveGlobalSettings();
        });
        
        this.guiFolder.add(this, 'south', -90, 90, 0.0001).name('South').onChange(() => {
            this.updateMesh();
            CustomManager.saveGlobalSettings();
        });
        
        this.guiFolder.add(this, 'east', -180, 180, 0.0001).name('East').onChange(() => {
            this.updateMesh();
            CustomManager.saveGlobalSettings();
        });
        
        this.guiFolder.add(this, 'west', -180, 180, 0.0001).name('West').onChange(() => {
            this.updateMesh();
            CustomManager.saveGlobalSettings();
        });
        
        this.guiFolder.add(this, 'rotation', -180, 180, 0.1).name('Rotation').onChange(() => {
            this.updateMesh();
            CustomManager.saveGlobalSettings();
        });
        
        this.guiFolder.add(this, 'heightOffset', 0, 100, 0.1).name('Height Offset').onChange(() => {
            this.updateMesh();
            CustomManager.saveGlobalSettings();
        });
        
        this.guiFolder.add(this, 'wireframe').name('Wireframe').onChange(() => {
            if (this.overlayMaterial) {
                this.overlayMaterial.wireframe = this.wireframe;
                this.overlayMaterial.needsUpdate = true;
            }
            setRenderOne(true);
            CustomManager.saveGlobalSettings();
        });
        
        this.guiFolder.add({edit: () => this.setEditMode(!this.editMode)}, 'edit').name('Toggle Edit Mode');
        
        this.guiFolder.add({goto: () => this.gotoOverlay()}, 'goto').name('Go to Overlay');
        
        this.guiFolder.add({remove: () => {
            if (confirm(`Delete overlay "${this.name}"?`)) {
                Synth3DManager.removeOverlay(this.overlayID);
            }
        }}, 'remove').name('Delete Overlay');
        
        this.guiFolder.close();
    }
    
    showRehostDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const arrayBuffer = await file.arrayBuffer();
                const url = await FileManager.rehoster.rehostFilePromise(file.name, arrayBuffer);
                this.imageURL = url;
                this.loadTexture();
                this.updateGUIControllers();
                CustomManager.saveGlobalSettings();
                console.log(`Rehosted image: ${url}`);
            } catch (error) {
                console.error('Failed to rehost image:', error);
                alert('Failed to upload image. Are you logged in?');
            }
        };
        input.click();
    }
    
    updateGUIControllers() {
        if (this.guiFolder) {
            this.guiFolder.controllers.forEach(controller => {
                controller.updateDisplay();
            });
        }
    }
    
    gotoOverlay() {
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        const centerEUS = LLAToEUS(centerLat, centerLon, 0);
        const groundPos = getPointBelow(centerEUS);
        NodeMan.get("mainCamera").goToPoint(groundPos);
    }
    
    serialize() {
        return {
            id: this.overlayID,
            name: this.name,
            north: this.north,
            south: this.south,
            east: this.east,
            west: this.west,
            rotation: this.rotation,
            imageURL: this.imageURL,
            heightOffset: this.heightOffset,
            wireframe: this.wireframe,
        };
    }
    
    static deserialize(data) {
        return new CNodeGroundOverlay({
            id: data.id,
            name: data.name,
            north: data.north,
            south: data.south,
            east: data.east,
            west: data.west,
            rotation: data.rotation,
            imageURL: data.imageURL,
            heightOffset: data.heightOffset,
            wireframe: data.wireframe,
        });
    }
    
    dispose() {
        document.removeEventListener('pointerdown', this.onPointerDownBound);
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        document.removeEventListener('pointerup', this.onPointerUpBound);
        
        this.removeControlPoints();
        
        if (this.overlayMesh) {
            this.group.remove(this.overlayMesh);
        }
        if (this.overlayGeometry) this.overlayGeometry.dispose();
        if (this.overlayMaterial) this.overlayMaterial.dispose();
        if (this.texture) this.texture.dispose();
        
        if (this.guiFolder) {
            this.guiFolder.destroy();
        }
        
        super.dispose();
    }
}
