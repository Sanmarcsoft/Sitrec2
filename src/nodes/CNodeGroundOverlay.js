import {CNode3DGroup} from "./CNode3DGroup";
import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Mesh,
    Raycaster,
    ShaderMaterial,
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
import {sharedUniforms} from "../js/map33/material/SharedUniforms";

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
        
        this.overlayTileMeshes = new Map();
        this.overlayMaterial = null;
        this.texture = null;
        
        this.editMode = false;
        this.isDragging = false;
        this.draggingHandle = null;
        this.hoveredHandle = null;
        
        this.cornerHandles = [];
        this.rotationHandle = null;
        
        this.raycaster = new Raycaster();
        this.raycaster.layers.mask = LAYER.MASK_HELPERS;
        
        this.createMaterial();
        
        if (this.imageURL) {
            this.loadTexture();
        }
        
        this.buildMesh();
        this.setupEventListeners();
        this.createGUIFolder();
    }
    
    createMaterial() {
        this.overlayMaterial = new ShaderMaterial({
            uniforms: {
                map: { value: this.texture },
                ...sharedUniforms,
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vDepth;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    vDepth = gl_Position.w;
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                uniform float nearPlane;
                uniform float farPlane;
                varying vec2 vUv;
                varying float vDepth;
                void main() {
                    if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) {
                        discard;
                    }
                    gl_FragColor = texture2D(map, vUv);
                    
                    // Logarithmic depth calculation
                    float z = (log2(max(nearPlane, 1.0 + vDepth)) / log2(1.0 + farPlane)) * 2.0 - 1.0;
                    gl_FragDepthEXT = z * 0.5 + 0.5;
                }
            `,
            side: DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -4,
            wireframe: this.wireframe,
        });
    }
    
    loadTexture() {
        if (!this.imageURL) return;
        
        const loader = new TextureLoader();
        loader.load(this.imageURL, (texture) => {
            this.texture = texture;
            if (this.overlayMaterial) {
                this.overlayMaterial.uniforms.map.value = texture;
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
    
    disposeTileMeshes() {
        this.overlayTileMeshes.forEach(mesh => {
            this.group.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
        });
        this.overlayTileMeshes.clear();
    }
    
    disposeTileMesh(tileKey) {
        const mesh = this.overlayTileMeshes.get(tileKey);
        if (mesh) {
            this.group.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            this.overlayTileMeshes.delete(tileKey);
        }
    }
    
    tilesOverlap(tileNorth, tileSouth, tileEast, tileWest) {
        return !(tileEast < this.west || tileWest > this.east ||
                 tileSouth > this.north || tileNorth < this.south);
    }
    
    latLonToUV(lat, lon) {
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        
        let relLat = lat - centerLat;
        let relLon = lon - centerLon;
        
        if (this.rotation !== 0) {
            const rotationRad = radians(-this.rotation);
            const cosR = Math.cos(rotationRad);
            const sinR = Math.sin(rotationRad);
            
            const rotatedLon = relLon * cosR - relLat * sinR;
            const rotatedLat = relLon * sinR + relLat * cosR;
            
            relLon = rotatedLon;
            relLat = rotatedLat;
        }
        
        const latRange = this.north - this.south;
        const lonRange = this.east - this.west;
        
        const u = (relLon / lonRange) + 0.5;
        const v = 1.0 - ((relLat / latRange) + 0.5);
        
        return {u, v};
    }
    
    buildMesh() {
        this.disposeTileMeshes();
        
        if (!NodeMan.exists("TerrainModel")) {
            return;
        }
        
        const terrainNode = NodeMan.get("TerrainModel");
        if (!terrainNode.maps || !terrainNode.UI) {
            return;
        }
        
        const terrainMap = terrainNode.maps[terrainNode.UI.mapType]?.map;
        if (!terrainMap) {
            return;
        }
        
        const mapProjection = terrainMap.options?.mapProjection;
        if (!mapProjection) {
            return;
        }
        
        terrainMap.forEachTile((tile) => {
            if (!tile.mesh || !tile.mesh.geometry || !tile.loaded) {
                return;
            }
            
            const tileNorth = mapProjection.getNorthLatitude(tile.y, tile.z);
            const tileSouth = mapProjection.getNorthLatitude(tile.y + 1, tile.z);
            const tileWest = mapProjection.getLeftLongitude(tile.x, tile.z);
            const tileEast = mapProjection.getLeftLongitude(tile.x + 1, tile.z);
            
            if (!this.tilesOverlap(tileNorth, tileSouth, tileEast, tileWest)) {
                return;
            }
            
            this.createOverlayTileFromTerrainTile(tile, mapProjection);
        });
        
        setRenderOne(true);
    }
    
    createOverlayTileFromTerrainTile(tile, mapProjection) {
        const tileKey = tile.key();
        
        this.disposeTileMesh(tileKey);
        
        const sourceGeometry = tile.mesh.geometry;
        const sourcePositions = sourceGeometry.attributes.position.array;
        const sourceIndex = sourceGeometry.index ? sourceGeometry.index.array : null;
        const tilePosition = tile.mesh.position;
        
        const vertexCount = sourcePositions.length / 3;
        const newPositions = new Float32Array(sourcePositions.length);
        const newUVs = new Float32Array(vertexCount * 2);
        
        for (let i = 0; i < vertexCount; i++) {
            const x = sourcePositions[i * 3];
            const y = sourcePositions[i * 3 + 1];
            const z = sourcePositions[i * 3 + 2];
            
            const worldPos = new Vector3(x + tilePosition.x, y + tilePosition.y, z + tilePosition.z);
            const adjustedPos = pointAbove(worldPos, this.heightOffset);
            
            newPositions[i * 3] = adjustedPos.x;
            newPositions[i * 3 + 1] = adjustedPos.y;
            newPositions[i * 3 + 2] = adjustedPos.z;
            
            const lla = EUSToLLA(worldPos);
            const {u, v} = this.latLonToUV(lla.x, lla.y);
            
            newUVs[i * 2] = u;
            newUVs[i * 2 + 1] = v;
        }
        
        const overlayGeometry = new BufferGeometry();
        overlayGeometry.setAttribute('position', new Float32BufferAttribute(newPositions, 3));
        overlayGeometry.setAttribute('uv', new Float32BufferAttribute(newUVs, 2));
        
        if (sourceIndex) {
            overlayGeometry.setIndex(Array.from(sourceIndex));
        }
        
        overlayGeometry.computeVertexNormals();
        
        const overlayMesh = new Mesh(overlayGeometry, this.overlayMaterial);
        overlayMesh.layers.mask = LAYER.MASK_WORLD;
        overlayMesh.frustumCulled = false;
        
        this.group.add(overlayMesh);
        this.overlayTileMeshes.set(tileKey, overlayMesh);
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
        
        EventManager.addEventListener("terrainLoaded", () => {
            this.updateMesh();
        });
        
        this.onTileOnBound = this.onTileOn.bind(this);
        this.onTileOffBound = this.onTileOff.bind(this);
        this.onTileChangedBound = this.onTileChanged.bind(this);
        
        EventManager.addEventListener("tileOn", this.onTileOnBound);
        EventManager.addEventListener("tileOff", this.onTileOffBound);
        EventManager.addEventListener("tileChanged", this.onTileChangedBound);
    }
    
    getMapProjection() {
        if (!NodeMan.exists("TerrainModel")) return null;
        const terrainNode = NodeMan.get("TerrainModel");
        if (!terrainNode.maps || !terrainNode.UI) return null;
        const terrainMap = terrainNode.maps[terrainNode.UI.mapType]?.map;
        if (!terrainMap) return null;
        return terrainMap.options?.mapProjection;
    }
    
    tileOverlapsOverlay(tile, mapProjection) {
        const tileNorth = mapProjection.getNorthLatitude(tile.y, tile.z);
        const tileSouth = mapProjection.getNorthLatitude(tile.y + 1, tile.z);
        const tileWest = mapProjection.getLeftLongitude(tile.x, tile.z);
        const tileEast = mapProjection.getLeftLongitude(tile.x + 1, tile.z);
        return this.tilesOverlap(tileNorth, tileSouth, tileEast, tileWest);
    }
    
    onTileOn(tile) {
        const mapProjection = this.getMapProjection();
        if (!mapProjection) return;
        if (!tile.mesh || !tile.mesh.geometry || !tile.loaded) return;
        if (!this.tileOverlapsOverlay(tile, mapProjection)) return;
        
        this.createOverlayTileFromTerrainTile(tile, mapProjection);
        setRenderOne(true);
    }
    
    onTileOff(tile) {
        this.disposeTileMesh(tile.key());
        setRenderOne(true);
    }
    
    onTileChanged(tile) {
        const mapProjection = this.getMapProjection();
        if (!mapProjection) return;
        if (!tile.mesh || !tile.mesh.geometry || !tile.loaded) return;
        if (!this.tileOverlapsOverlay(tile, mapProjection)) return;
        if (!this.overlayTileMeshes.has(tile.key())) return;
        
        this.createOverlayTileFromTerrainTile(tile, mapProjection);
        setRenderOne(true);
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
        
        EventManager.removeEventListener("tileOn", this.onTileOnBound);
        EventManager.removeEventListener("tileOff", this.onTileOffBound);
        EventManager.removeEventListener("tileChanged", this.onTileChangedBound);
        
        this.removeControlPoints();
        this.disposeTileMeshes();
        
        if (this.overlayMaterial) this.overlayMaterial.dispose();
        if (this.texture) this.texture.dispose();
        
        if (this.guiFolder) {
            this.guiFolder.destroy();
        }
        
        super.dispose();
    }
}
