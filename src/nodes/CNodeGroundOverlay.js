import {CNode3DGroup} from "./CNode3DGroup";
import {
    BufferGeometry,
    CanvasTexture,
    DoubleSide,
    Float32BufferAttribute,
    Mesh,
    MeshBasicMaterial,
    Raycaster,
    ShaderMaterial,
    SphereGeometry,
    TextureLoader,
    Vector3
} from "three";
import * as LAYER from "../LayerMasks";
import {getLocalDownVector, getLocalUpVector} from "../SphericalMath";
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
        this.imageFileID = v.imageFileID || null;
        this.wireframe = v.wireframe !== undefined ? v.wireframe : false;
        this.opacity = v.opacity !== undefined ? v.opacity : 1.0;
        
        this.overlayTileMeshes = new Map();
        this.overlayMaterial = null;
        this.texture = null;
        
        this.editMode = false;
        this.isDragging = false;
        this.draggingHandle = null;
        this.hoveredHandle = null;
        
        this.cornerHandles = [];
        this.rotationHandle = null;
        this.moveHandle = null;
        
        this.raycaster = new Raycaster();
        this.raycaster.layers.mask = LAYER.MASK_HELPERS;
        
        this.createMaterial();
        this.loadTexture();  // Creates default texture if no imageURL
        this.buildMesh();
        this.setupEventListeners();
        this.createGUIFolder();
    }
    
    createMaterial() {
        const depthBias = -0.00001;
        
        this.overlayMaterial = new ShaderMaterial({
            uniforms: {
                map: { value: this.texture },
                opacity: { value: this.opacity },
                depthBias: { value: depthBias },
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
                uniform float opacity;
                uniform float depthBias;
                uniform float nearPlane;
                uniform float farPlane;
                varying vec2 vUv;
                varying float vDepth;
                void main() {
                    if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) {
                        discard;
                    }
                    vec4 texColor = texture2D(map, vUv);
                    gl_FragColor = vec4(texColor.rgb, texColor.a * opacity);
                    
                    float z = (log2(max(nearPlane, 1.0 + vDepth)) / log2(1.0 + farPlane)) * 2.0 - 1.0;
                    gl_FragDepthEXT = z * 0.5 + 0.5 + depthBias;
                }
            `,
            side: DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            wireframe: this.wireframe,
        });
    }
    
    loadTexture() {
        if (!this.imageURL) {
            // Create default texture: grey background with red circle
            this.texture = this.createDefaultTexture();
            if (this.overlayMaterial) {
                this.overlayMaterial.uniforms.map.value = this.texture;
                this.overlayMaterial.needsUpdate = true;
            }
            setRenderOne(true);
            return;
        }

        const loader = new TextureLoader();
        loader.load(this.imageURL, (texture) => {
            texture.flipY = false;
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

    createDefaultTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Grey background
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, size, size);

        // Red circle outline
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
        ctx.stroke();

        const texture = new CanvasTexture(canvas);
        texture.flipY = false;
        return texture;
    }
    
    getCornerPositions() {
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        const centerEUS = LLAToEUS(centerLat, centerLon, 0);

        const corners = [
            {lat: this.north, lon: this.west},
            {lat: this.north, lon: this.east},
            {lat: this.south, lon: this.east},
            {lat: this.south, lon: this.west}
        ];

        return corners.map(corner => {
            let pos = LLAToEUS(corner.lat, corner.lon, 0);

            if (this.rotation !== 0) {
                // Rotate in EUS space around local up vector
                const offset = pos.clone().sub(centerEUS);
                const up = getLocalUpVector(centerEUS);
                const rotationRad = radians(this.rotation);
                const rotatedOffset = offset.clone().applyAxisAngle(up, rotationRad);
                pos = centerEUS.clone().add(rotatedOffset);
            }

            return pos;
        });
    }
    
    disposeTileMeshes() {
        this.overlayTileMeshes.forEach(entry => {
            if (entry.mesh) {
                this.group.remove(entry.mesh);
                if (entry.mesh.geometry) entry.mesh.geometry.dispose();
            }
            if (entry.skirtMesh) {
                this.group.remove(entry.skirtMesh);
                if (entry.skirtMesh.geometry) entry.skirtMesh.geometry.dispose();
            }
        });
        this.overlayTileMeshes.clear();
    }
    
    disposeTileMesh(tileKey) {
        const entry = this.overlayTileMeshes.get(tileKey);
        if (entry) {

            if (entry.mesh) {
                this.group.remove(entry.mesh);
                if (entry.mesh.geometry) entry.mesh.geometry.dispose();
            }
            if (entry.skirtMesh) {
                this.group.remove(entry.skirtMesh);
                if (entry.skirtMesh.geometry) entry.skirtMesh.geometry.dispose();
            }
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
            // Rotate in EUS space around local up vector, then convert back to lat/lon
            const centerEUS = LLAToEUS(centerLat, centerLon, 0);
            const pos = LLAToEUS(lat, lon, 0);
            const offset = pos.clone().sub(centerEUS);

            const up = getLocalUpVector(centerEUS);
            const rotationRad = radians(-this.rotation);
            const rotatedOffset = offset.clone().applyAxisAngle(up, rotationRad);
            const rotatedPos = centerEUS.clone().add(rotatedOffset);

            const rotatedLLA = EUSToLLA(rotatedPos);
            relLat = rotatedLLA.x - centerLat;
            relLon = rotatedLLA.y - centerLon;
        }

        const latRange = this.north - this.south;
        const lonRange = this.east - this.west;

        const u = (relLon / lonRange) + 0.5;
        const v = 1.0 - ((relLat / latRange) + 0.5);

        return {u, v};
    }
    
    updateGroupPosition() {
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        const centerEUS = LLAToEUS(centerLat, centerLon, 0);
        const groundCenter = getPointBelow(centerEUS);
        this.group.position.copy(groundCenter);
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
        
        this.updateGroupPosition();
        
        terrainMap.forEachTile((tile) => {
            if (!tile.mesh || !tile.mesh.geometry || !tile.loaded) {
                return;
            }
            
            const layerMask = tile.mesh.layers.mask;
            if (layerMask === 0) {
                return;
            }
            
            const tileNorth = mapProjection.getNorthLatitude(tile.y, tile.z);
            const tileSouth = mapProjection.getNorthLatitude(tile.y + 1, tile.z);
            const tileWest = mapProjection.getLeftLongitude(tile.x, tile.z);
            const tileEast = mapProjection.getLeftLongitude(tile.x + 1, tile.z);
            
            if (!this.tilesOverlap(tileNorth, tileSouth, tileEast, tileWest)) {
                return;
            }
            
            this.createOverlayTileFromTerrainTile(tile, mapProjection, layerMask);
        });
        
        setRenderOne(true);
    }
    
    createOverlayTileFromTerrainTile(tile, mapProjection, layerMask) {
        const tileKey = tile.key();
        
        this.disposeTileMesh(tileKey);
        
        const sourceGeometry = tile.mesh.geometry;
        const sourcePositions = sourceGeometry.attributes.position.array;
        const sourceIndex = sourceGeometry.index ? sourceGeometry.index.array : null;
        const tilePosition = tile.mesh.position;
        const groupPosition = this.group.position;
        
        const segments = Globals.settings.tileSegments ?? 64;
        const vertexCount = sourcePositions.length / 3;
        const newPositions = new Float32Array(sourcePositions.length);
        const newUVs = new Float32Array(vertexCount * 2);
        
        for (let i = 0; i < vertexCount; i++) {
            const x = sourcePositions[i * 3];
            const y = sourcePositions[i * 3 + 1];
            const z = sourcePositions[i * 3 + 2];
            
            const worldX = x + tilePosition.x;
            const worldY = y + tilePosition.y;
            const worldZ = z + tilePosition.z;
            
            newPositions[i * 3] = worldX - groupPosition.x;
            newPositions[i * 3 + 1] = worldY - groupPosition.y;
            newPositions[i * 3 + 2] = worldZ - groupPosition.z;
            
            const worldPos = new Vector3(worldX, worldY, worldZ);
            
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
        overlayMesh.layers.mask = layerMask;
        overlayMesh.frustumCulled = false;
        overlayMesh.userData.ignoreContextMenu = true;  // Allow right-clicks to pass through to ground

        this.group.add(overlayMesh);
        
        const skirtMesh = this.createSkirtMesh(newPositions, newUVs, segments, tile, layerMask);
        if (skirtMesh) {
            this.group.add(skirtMesh);
        }
        
        this.overlayTileMeshes.set(tileKey, {mesh: overlayMesh, skirtMesh});
    }
    
    createSkirtMesh(positions, uvs, segments, tile, layerMask) {
        const skirtDepth = tile.size * 0.1;
        
        const tileNorth = tile.map.options.mapProjection.getNorthLatitude(tile.y, tile.z);
        const tileSouth = tile.map.options.mapProjection.getNorthLatitude(tile.y + 1, tile.z);
        const tileWest = tile.map.options.mapProjection.getLeftLongitude(tile.x, tile.z);
        const tileEast = tile.map.options.mapProjection.getLeftLongitude(tile.x + 1, tile.z);
        const centerLat = (tileNorth + tileSouth) / 2;
        const centerLon = (tileWest + tileEast) / 2;
        const centerPosition = LLAToEUS(centerLat, centerLon, 0);
        const downVector = getLocalDownVector(centerPosition);
        
        const skirtVertices = [];
        const skirtUvs = [];
        const skirtIndices = [];
        
        const getVertexIndex = (x, y) => (y * (segments + 1) + x);
        
        const edges = [
            {start: [0, 0], end: [segments, 0], direction: [1, 0]},
            {start: [segments, 0], end: [segments, segments], direction: [0, 1]},
            {start: [segments, segments], end: [0, segments], direction: [-1, 0]},
            {start: [0, segments], end: [0, 0], direction: [0, -1]}
        ];
        
        let vertexIndex = 0;
        
        for (const edge of edges) {
            const [startX, startY] = edge.start;
            const [endX, endY] = edge.end;
            const [dirX, dirY] = edge.direction;
            const edgeLength = Math.abs(endX - startX) + Math.abs(endY - startY);
            
            for (let i = 0; i <= edgeLength; i++) {
                const x = startX + dirX * i;
                const y = startY + dirY * i;
                const mainIdx = getVertexIndex(x, y);
                
                const mainX = positions[mainIdx * 3];
                const mainY = positions[mainIdx * 3 + 1];
                const mainZ = positions[mainIdx * 3 + 2];
                const mainU = uvs[mainIdx * 2];
                const mainV = uvs[mainIdx * 2 + 1];
                
                skirtVertices.push(mainX, mainY, mainZ);
                skirtUvs.push(mainU, mainV);
                
                skirtVertices.push(
                    mainX + downVector.x * skirtDepth,
                    mainY + downVector.y * skirtDepth,
                    mainZ + downVector.z * skirtDepth
                );
                skirtUvs.push(mainU, mainV);
            }
            
            const edgeStartIdx = vertexIndex;
            for (let i = 0; i < edgeLength; i++) {
                const curr = edgeStartIdx + i * 2;
                const next = curr + 2;
                skirtIndices.push(curr, curr + 1, next);
                skirtIndices.push(curr + 1, next + 1, next);
            }
            
            vertexIndex += (edgeLength + 1) * 2;
        }
        
        if (skirtVertices.length === 0) {
            return null;
        }
        
        const skirtGeometry = new BufferGeometry();
        skirtGeometry.setAttribute('position', new Float32BufferAttribute(skirtVertices, 3));
        skirtGeometry.setAttribute('uv', new Float32BufferAttribute(skirtUvs, 2));
        skirtGeometry.setIndex(skirtIndices);
        skirtGeometry.computeVertexNormals();
        
        const skirtMesh = new Mesh(skirtGeometry, this.overlayMaterial);
        skirtMesh.layers.mask = layerMask;
        skirtMesh.frustumCulled = false;
        skirtMesh.userData.ignoreContextMenu = true;  // Allow right-clicks to pass through to ground

        return skirtMesh;
    }
    
    updateMesh() {
        this.buildMesh();
        if (this.editMode) {
            this.createControlPoints();
        }
    }
    
    createHandleMaterial(color) {
        return new MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.8,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
    }

    createControlPoints() {
        this.removeControlPoints();

        const corners = this.getCornerPositions();
        const handleGeometry = new SphereGeometry(3, 16, 16);
        const groupPos = this.group.position;

        corners.forEach((pos, index) => {
            const groundPos = getPointBelow(pos);
            const adjustedPos = pointAbove(groundPos, 5);

            const handle = new Mesh(handleGeometry.clone(), this.createHandleMaterial(0xffff00));
            handle.position.copy(adjustedPos).sub(groupPos);
            handle.layers.mask = LAYER.MASK_HELPERS;
            handle.userData.cornerIndex = index;
            handle.userData.handleType = 'corner';
            this.group.add(handle);
            this.cornerHandles.push(handle);
        });

        // Position rotation handle 90% towards the north edge
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        const centerEUS = LLAToEUS(centerLat, centerLon, 0);

        const northMidEUS = LLAToEUS(this.north, centerLon, 0);
        let rotHandleEUS = northMidEUS.clone();
        if (this.rotation !== 0) {
            const offset = northMidEUS.clone().sub(centerEUS);
            const up = getLocalUpVector(centerEUS);
            const rotatedOffset = offset.clone().applyAxisAngle(up, radians(this.rotation));
            rotHandleEUS = centerEUS.clone().add(rotatedOffset);
        }

        const toNorthMid = rotHandleEUS.clone().sub(centerEUS);
        const rotHandlePos = centerEUS.clone().add(toNorthMid.multiplyScalar(0.9));
        const adjustedRotHandle = pointAbove(getPointBelow(rotHandlePos), 5);

        this.rotationHandle = new Mesh(handleGeometry.clone(), this.createHandleMaterial(0x00ffff));
        this.rotationHandle.position.copy(adjustedRotHandle).sub(groupPos);
        this.rotationHandle.layers.mask = LAYER.MASK_HELPERS;
        this.rotationHandle.userData.handleType = 'rotation';
        this.group.add(this.rotationHandle);

        // Green move handle at center
        const adjustedCenter = pointAbove(getPointBelow(centerEUS), 5);

        this.moveHandle = new Mesh(handleGeometry.clone(), this.createHandleMaterial(0x00ff00));
        this.moveHandle.position.copy(adjustedCenter).sub(groupPos);
        this.moveHandle.layers.mask = LAYER.MASK_HELPERS;
        this.moveHandle.userData.handleType = 'move';
        this.group.add(this.moveHandle);

        handleGeometry.dispose();
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

        if (this.moveHandle) {
            this.group.remove(this.moveHandle);
            this.moveHandle.geometry.dispose();
            this.moveHandle.material.dispose();
            this.moveHandle = null;
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
        
        this.onTileVisibilityChangedBound = this.onTileVisibilityChanged.bind(this);
        this.onTileChangedBound = this.onTileChanged.bind(this);
        
        EventManager.addEventListener("tileVisibilityChanged", this.onTileVisibilityChangedBound);
        EventManager.addEventListener("tileChanged", this.onTileChangedBound);
    }
    
    getTerrainMap() {
        if (!NodeMan.exists("TerrainModel")) return null;
        const terrainNode = NodeMan.get("TerrainModel");
        if (!terrainNode.maps || !terrainNode.UI) return null;
        return terrainNode.maps[terrainNode.UI.mapType]?.map || null;
    }
    
    getMapProjection() {
        const terrainMap = this.getTerrainMap();
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
    
    onTileVisibilityChanged({tile, oldMask, newMask}) {
        const terrainMap = this.getTerrainMap();
        if (!terrainMap || tile.map !== terrainMap) {
            return;
        }
        
        const tileKey = tile.key();
        
        if (newMask === 0) {
            this.disposeTileMesh(tileKey);
            setRenderOne(true);
        } else if (newMask !== 0) {
            const entry = this.overlayTileMeshes.get(tileKey);
            if (entry) {
                if (entry.mesh) entry.mesh.layers.mask = newMask;
                if (entry.skirtMesh) entry.skirtMesh.layers.mask = newMask;
                setRenderOne(true);
            } else {
                const mapProjection = terrainMap.options?.mapProjection;
                if (!mapProjection) return;
                if (!tile.mesh || !tile.mesh.geometry || !tile.loaded) return;
                if (!this.tileOverlapsOverlay(tile, mapProjection)) return;
                
                this.createOverlayTileFromTerrainTile(tile, mapProjection, newMask);
                setRenderOne(true);
            }
        }
    }
    
    onTileChanged(tile) {
        const terrainMap = this.getTerrainMap();
        if (!terrainMap || tile.map !== terrainMap) return;
        
        const mapProjection = terrainMap.options?.mapProjection;
        if (!mapProjection) return;
        if (!tile.mesh || !tile.mesh.geometry || !tile.loaded) return;
        if (!this.tileOverlapsOverlay(tile, mapProjection)) return;
        
        const layerMask = tile.mesh.layers.mask;
        if (layerMask === 0) return;
        
        this.createOverlayTileFromTerrainTile(tile, mapProjection, layerMask);
        setRenderOne(true);
    }
    
    onPointerDown(event) {
        if (!this.editMode) return;
        if (event.button !== 0) return;
        
        let target = event.target;
        while (target) {
            if (target.classList && target.classList.contains('lil-gui')) {
                return;
            }
            target = target.parentElement;
        }
        
        const view = ViewMan.get("mainView");
        if (!view || !mouseInViewOnly(view, event.clientX, event.clientY)) return;
        
        const handle = this.getHandleAtMouse(event.clientX, event.clientY);
        if (handle) {
            this.isDragging = true;
            this.draggingHandle = handle;

            // For rotation or move handle, store initial state for relative dragging
            if (handle.type === 'rotation' || handle.type === 'move') {
                // Store initial bounds for move handle
                this.dragInitialNorth = this.north;
                this.dragInitialSouth = this.south;
                this.dragInitialEast = this.east;
                this.dragInitialWest = this.west;
                this.dragInitialRotation = this.rotation;

                // Get the terrain intersection point for the initial click
                const mouseYUp = view.heightPx - (event.clientY - view.topPx);
                const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
                this.raycaster.setFromCamera(mouseRay, view.camera);

                const savedMask = this.raycaster.layers.mask;
                this.raycaster.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;

                if (NodeMan.exists("TerrainModel")) {
                    const terrainNode = NodeMan.get("TerrainModel");
                    const intersect = terrainNode.getClosestIntersect(this.raycaster);
                    if (intersect) {
                        const centerLat = (this.north + this.south) / 2;
                        const centerLon = (this.east + this.west) / 2;
                        const lla = EUSToLLA(intersect.point);
                        // Store initial click position for move handle
                        this.dragInitialClickLat = lla.x;
                        this.dragInitialClickLon = lla.y;
                        // Store the initial angle from center to click point for rotation handle
                        this.dragInitialAngle = Math.atan2(lla.y - centerLon, lla.x - centerLat);
                    }
                }

                this.raycaster.layers.mask = savedMask;
            }

            if (view.controls) {
                view.controls.enabled = false;
            }

            event.stopPropagation();
            event.preventDefault();
        }
    }
    
    getHandleAtMouse(mouseX, mouseY) {
        const view = ViewMan.get("mainView");
        if (!view) return null;
        
        const mouseYUp = view.heightPx - (mouseY - view.topPx);
        const mouseRay = makeMouseRay(view, mouseX, mouseYUp);
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        const handles = [];
        this.cornerHandles.forEach((mesh, index) => {
            handles.push({mesh, type: 'corner', index});
        });
        if (this.rotationHandle) {
            handles.push({mesh: this.rotationHandle, type: 'rotation'});
        }
        if (this.moveHandle) {
            handles.push({mesh: this.moveHandle, type: 'move'});
        }
        
        let closest = null;
        let closestDist = Infinity;
        
        for (const h of handles) {
            const intersects = this.raycaster.intersectObject(h.mesh, false);
            if (intersects.length > 0 && intersects[0].distance < closestDist) {
                closestDist = intersects[0].distance;
                closest = h;
            }
        }
        
        return closest;
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

                // Temporarily change raycaster layer mask to intersect terrain
                const savedMask = this.raycaster.layers.mask;
                this.raycaster.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;

                const intersect = terrainNode.getClosestIntersect(this.raycaster);

                // Restore raycaster layer mask
                this.raycaster.layers.mask = savedMask;

                if (intersect) {
                    const lla = EUSToLLA(intersect.point);

                    if (this.draggingHandle.type === 'corner') {
                        this.updateCorner(this.draggingHandle.index, lla.x, lla.y);
                    } else if (this.draggingHandle.type === 'rotation') {
                        const centerLat = (this.north + this.south) / 2;
                        const centerLon = (this.east + this.west) / 2;
                        // Calculate current angle from center to mouse
                        const currentAngle = Math.atan2(lla.y - centerLon, lla.x - centerLat);
                        // Apply the delta from initial click angle to initial rotation (negated for correct direction)
                        const angleDelta = currentAngle - this.dragInitialAngle;
                        this.rotation = this.dragInitialRotation - degrees(angleDelta);
                    } else if (this.draggingHandle.type === 'move') {
                        // Calculate the displacement from initial click position
                        const deltaLat = lla.x - this.dragInitialClickLat;
                        const deltaLon = lla.y - this.dragInitialClickLon;

                        // Apply displacement to all bounds
                        this.north = this.dragInitialNorth + deltaLat;
                        this.south = this.dragInitialSouth + deltaLat;
                        this.east = this.dragInitialEast + deltaLon;
                        this.west = this.dragInitialWest + deltaLon;
                    }

                    this.updateMesh();
                    this.updateGUIControllers();
                    setRenderOne(true);
                }
            }
        }
    }
    
    updateCorner(cornerIndex, lat, lon) {
        // Get current corner positions in world space (rotated)
        const corners = this.getCornerPositions();

        // Corner indices: 0=NW, 1=NE, 2=SE, 3=SW
        // Neighbors and opposite for each corner:
        const adjacency = [
            {prev: 3, next: 1, opposite: 2},  // 0 (NW): neighbors SW, NE; opposite SE
            {prev: 0, next: 2, opposite: 3},  // 1 (NE): neighbors NW, SE; opposite SW
            {prev: 1, next: 3, opposite: 0},  // 2 (SE): neighbors NE, SW; opposite NW
            {prev: 2, next: 0, opposite: 1},  // 3 (SW): neighbors SE, NW; opposite NE
        ];

        const {prev, next, opposite} = adjacency[cornerIndex];

        // The opposite corner stays fixed
        const fixedCorner = corners[opposite].clone();

        // New position for the dragged corner
        const newDraggedCorner = LLAToEUS(lat, lon, 0);

        // Calculate displacement of dragged corner
        const oldDraggedCorner = corners[cornerIndex];
        const displacement = newDraggedCorner.clone().sub(oldDraggedCorner);

        // Get local up vector for horizontal projection
        const centerEUS = fixedCorner.clone().add(newDraggedCorner).multiplyScalar(0.5);
        const localUp = getLocalUpVector(centerEUS);

        // Project displacement to horizontal plane
        const horizontalDisp = displacement.clone().sub(
            localUp.clone().multiplyScalar(displacement.dot(localUp))
        );

        // Move prev neighbor along edge from opposite to prev
        const edgeToPrev = corners[prev].clone().sub(fixedCorner);
        const edgeToPrevHoriz = edgeToPrev.clone().sub(
            localUp.clone().multiplyScalar(edgeToPrev.dot(localUp))
        );
        const edgeDirPrev = edgeToPrevHoriz.clone().normalize();
        const projPrev = horizontalDisp.dot(edgeDirPrev);
        const newPrevCorner = corners[prev].clone().add(edgeDirPrev.multiplyScalar(projPrev));

        // Move next neighbor along edge from opposite to next
        const edgeToNext = corners[next].clone().sub(fixedCorner);
        const edgeToNextHoriz = edgeToNext.clone().sub(
            localUp.clone().multiplyScalar(edgeToNext.dot(localUp))
        );
        const edgeDirNext = edgeToNextHoriz.clone().normalize();
        const projNext = horizontalDisp.dot(edgeDirNext);
        const newNextCorner = corners[next].clone().add(edgeDirNext.multiplyScalar(projNext));

        // Now we have 4 new corner positions in world space
        const newCorners = [];
        newCorners[cornerIndex] = newDraggedCorner;
        newCorners[opposite] = fixedCorner;
        newCorners[prev] = newPrevCorner;
        newCorners[next] = newNextCorner;

        // Calculate new center
        const newCenter = newCorners[0].clone()
            .add(newCorners[1])
            .add(newCorners[2])
            .add(newCorners[3])
            .multiplyScalar(0.25);

        // Unrotate corners around the new center to get the axis-aligned bounds
        const up = getLocalUpVector(newCenter);
        const rotationRad = radians(-this.rotation);

        const unrotatedCorners = newCorners.map(corner => {
            const offset = corner.clone().sub(newCenter);
            const unrotatedOffset = offset.clone().applyAxisAngle(up, rotationRad);
            return newCenter.clone().add(unrotatedOffset);
        });

        // Convert unrotated corners to lat/lon and extract bounds
        const llas = unrotatedCorners.map(c => EUSToLLA(c));

        // Find the bounds from unrotated corners
        const lats = llas.map(lla => lla.x);
        const lons = llas.map(lla => lla.y);

        this.north = Math.max(...lats);
        this.south = Math.min(...lats);
        this.east = Math.max(...lons);
        this.west = Math.min(...lons);
    }
    
    onPointerUp(event) {
        if (this.isDragging) {
            const view = ViewMan.get("mainView");
            if (view && view.controls) {
                view.controls.enabled = true;
            }
            this.isDragging = false;
            this.draggingHandle = null;
          //  CustomManager.saveGlobalSettings();
        }
    }
    
    updateHandleScales(view) {
        if (!this.editMode || !view || !view.pixelsToMeters) return;
        
        const handlePixelSize = 20;
        const worldPos = new Vector3();
        
        this.cornerHandles.forEach(handle => {
            handle.getWorldPosition(worldPos);
            const scale = view.pixelsToMeters(worldPos, handlePixelSize);
            handle.scale.set(scale / 3, scale / 3, scale / 3);
        });
        
        if (this.rotationHandle) {
            this.rotationHandle.getWorldPosition(worldPos);
            const scale = view.pixelsToMeters(worldPos, handlePixelSize);
            this.rotationHandle.scale.set(scale / 3, scale / 3, scale / 3);
        }

        if (this.moveHandle) {
            this.moveHandle.getWorldPosition(worldPos);
            const scale = view.pixelsToMeters(worldPos, handlePixelSize);
            this.moveHandle.scale.set(scale / 3, scale / 3, scale / 3);
        }
    }
    
    createGUIFolder() {
        this.guiFolder = guiMenus.objects.addFolder(this.name);
        
        this.guiFolder.add(this, 'imageURL').name('Image URL').onChange(() => {
            this.loadTexture();
        }).onFinishChange(() => {  });
        
        this.guiFolder.add({rehost: () => this.showRehostDialog()}, 'rehost').name('Rehost Local Image');
        
        this.guiFolder.add(this, 'north', -90, 90, 0.0001).name('North').onChange(() => {
            this.updateMesh();
        }).onFinishChange(() => {  });
        
        this.guiFolder.add(this, 'south', -90, 90, 0.0001).name('South').onChange(() => {
            this.updateMesh();
        }).onFinishChange(() => {  });
        
        this.guiFolder.add(this, 'east', -180, 180, 0.0001).name('East').onChange(() => {
            this.updateMesh();
        }).onFinishChange(() => {  });
        
        this.guiFolder.add(this, 'west', -180, 180, 0.0001).name('West').onChange(() => {
            this.updateMesh();
        }).onFinishChange(() => {  });
        
        this.guiFolder.add(this, 'rotation', -180, 180, 0.1).name('Rotation').onChange(() => {
            this.updateMesh();
        }).onFinishChange(() => {  });
        
        this.guiFolder.add(this, 'wireframe').name('Wireframe').onChange(() => {
            if (this.overlayMaterial) {
                this.overlayMaterial.wireframe = this.wireframe;
                this.overlayMaterial.needsUpdate = true;
            }
            setRenderOne(true);

        });
        
        this.guiFolder.add(this, 'opacity', 0, 1, 0.01).name('Opacity').onChange(() => {
            if (this.overlayMaterial) {
                this.overlayMaterial.uniforms.opacity.value = this.opacity;
            }
            setRenderOne(true);
        }).onFinishChange(() => {  });
        
        this.guiFolder.add({edit: () => this.setEditMode(!this.editMode)}, 'edit').name('Toggle Edit Mode');
        
        this.guiFolder.add({goto: () => this.gotoOverlay()}, 'goto').name('Go to Overlay');
        
        this.guiFolder.add({remove: () => {
            if (confirm(`Delete overlay "${this.name}"?`)) {
                Synth3DManager.removeOverlay(this.overlayID);
            }
        }}, 'remove').name('Delete Overlay');
        
        this.guiFolder.add({debug: () => this.dumpState()}, 'debug').name('Debug State');
        
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
        let imageURL = this.imageURL;
        if (this.imageFileID && FileManager.exists(this.imageFileID)) {
            const fileEntry = FileManager.list[this.imageFileID];
            if (fileEntry.staticURL) {
                imageURL = fileEntry.staticURL;
            }
        }
        return {
            id: this.overlayID,
            name: this.name,
            north: this.north,
            south: this.south,
            east: this.east,
            west: this.west,
            rotation: this.rotation,
            imageURL: imageURL,
            wireframe: this.wireframe,
            opacity: this.opacity,
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
            wireframe: data.wireframe,
            opacity: data.opacity,
        });
    }
    
    dumpState() {
        console.log(`[Overlay] ===== ${this.overlayID} state =====`);
        
        const terrainMap = this.getTerrainMap();
        const mapProjection = terrainMap?.options?.mapProjection;
        const terrainTileKeys = new Set();
        const overlayTileKeys = new Set(this.overlayTileMeshes.keys());
        const zoomCounts = {};
        
        if (terrainMap && mapProjection) {
            terrainMap.forEachTile((tile) => {
                if (tile.mesh && tile.mesh.layers.mask !== 0 && tile.loaded) {
                    if (this.tileOverlapsOverlay(tile, mapProjection)) {
                        terrainTileKeys.add(tile.key());
                        zoomCounts[tile.z] = (zoomCounts[tile.z] || 0) + 1;
                    }
                }
            });
        }
        
        const missingOverlays = [...terrainTileKeys].filter(k => !overlayTileKeys.has(k));
        const extraOverlays = [...overlayTileKeys].filter(k => !terrainTileKeys.has(k));
        
        console.log(`[Overlay] Terrain tiles: ${terrainTileKeys.size}, Overlay tiles: ${overlayTileKeys.size}`);
        console.log(`[Overlay] Zoom distribution:`, zoomCounts);
        
        if (missingOverlays.length > 0) {
            console.warn(`[Overlay] MISSING overlays for terrain tiles:`, missingOverlays);
        }
        if (extraOverlays.length > 0) {
            console.warn(`[Overlay] EXTRA overlay tiles (no terrain):`, extraOverlays);
        }
        if (missingOverlays.length === 0 && extraOverlays.length === 0) {
            console.log(`[Overlay] ✓ In sync`);
        }
        
        console.log(`[Overlay] ===========================`);
    }
    
    dispose() {
        document.removeEventListener('pointerdown', this.onPointerDownBound);
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        document.removeEventListener('pointerup', this.onPointerUpBound);
        
        EventManager.removeEventListener("tileVisibilityChanged", this.onTileVisibilityChangedBound);
        EventManager.removeEventListener("tileChanged", this.onTileChangedBound);
        
        this.removeControlPoints();
        this.disposeTileMeshes();
        
        if (this.overlayMaterial) this.overlayMaterial.dispose();
        if (this.texture) this.texture.dispose();
        
        if (this.guiFolder) {
            this.guiFolder.destroy();
        }
        
        const ignoreID = `overlay_${this.north}_${this.south}_${this.east}_${this.west}_${this.rotation}`;
        CustomManager.unignore(ignoreID);
        
        super.dispose();
    }
}
