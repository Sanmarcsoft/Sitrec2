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
import {Line2} from "three/addons/lines/Line2.js";
import {LineGeometry} from "three/addons/lines/LineGeometry.js";
import {disposeMatLine, makeMatLine} from "../MatLines";
import * as LAYER from "../LayerMasks";
import {getLocalDownVector, getLocalUpVector} from "../SphericalMath";
import {EUSToLLA, LLAToEUS} from "../LLA-ECEF-ENU";
import {screenToNDC} from "../mouseMoveView";
import {ViewMan} from "../CViewManager";
import {CustomManager, FileManager, Globals, guiMenus, NodeMan, setRenderOne, Synth3DManager} from "../Globals";
import {undoManager as UndoManager} from "../UndoManager";
import {mouseInViewOnly} from "../ViewUtils";
import {getPointBelow, pointAbove} from "../threeExt";
import {EventManager} from "../CEventManager";
import {degrees, radians, scaleF2M} from "../utils";
import {sharedUniforms} from "../js/map33/material/SharedUniforms";
import {assert} from "../assert";
import {LoadingManager} from "../CLoadingManager";

export class CNodeGroundOverlay extends CNode3DGroup {
    constructor(v) {
        super(v);
        
        this.overlayID = v.id;
        this.name = v.name || v.id;
        this.noGUI = v.noGUI || false;
        
        this.north = v.north !== undefined ? v.north : 0;
        this.south = v.south !== undefined ? v.south : 0;
        this.east = v.east !== undefined ? v.east : 0;
        this.west = v.west !== undefined ? v.west : 0;
        this.rotation = v.rotation !== undefined ? v.rotation : 0;

        this.imageURL = v.imageURL || "";
        this.imageFileID = v.imageFileID || null;
        this.wireframe = v.wireframe !== undefined ? v.wireframe : false;
        this.opacity = v.opacity !== undefined ? v.opacity : 1.0;
        
        this.extractClouds = v.extractClouds !== undefined ? v.extractClouds : false;
        this.cloudColor = v.cloudColor !== undefined ? v.cloudColor : '#E0E0E0';
        this.cloudFuzziness = v.cloudFuzziness !== undefined ? v.cloudFuzziness : 40;
        this.cloudFeather = v.cloudFeather !== undefined ? v.cloudFeather : 40;
        this.altitude = v.altitude !== undefined ? v.altitude : 0;
        this.lockShape = v.lockShape !== undefined ? v.lockShape : false;
        this.showBorder = v.showBorder !== undefined ? v.showBorder : false;
        this.freeTransform = v.freeTransform !== undefined ? v.freeTransform : false;
        this.corners = v.corners || null;
        this.lockPoints = v.lockPoints || [];
        
        this.originalTexture = null;
        this.flatMesh = null;
        this.overlayTileMeshes = new Map();
        this.overlayMaterial = null;
        this.texture = null;
        
        this.editMode = false;
        this.isDragging = false;
        this.draggingHandle = null;
        this.hoveredHandle = null;
        
        this.cornerHandles = [];
        this.rotationHandle = null;
        this.lockPointHandles = [];
        
        this.highlightBorder = null;
        this.highlightBorderMaterial = null;
        
        this.raycaster = new Raycaster();
        this.raycaster.layers.mask = LAYER.MASK_HELPERS;
        
        this.createMaterial();
        this.loadTexture();  // Creates default texture if no imageURL
        this.buildMesh();
        this.setupEventListeners();
        if (!this.noGUI) {
            this.createGUIFolder();
        }
        
        if (this.showBorder) {
            this.showHighlightBorder();
        }
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
        let textureURL = this.imageURL;
        if (this.imageFileID && FileManager.exists(this.imageFileID)) {
            const fileEntry = FileManager.list[this.imageFileID];
            if (fileEntry.blobURL) {
                textureURL = fileEntry.blobURL;
            }
        }

        if (!textureURL) {
            this.texture = this.createDefaultTexture();
            if (this.overlayMaterial) {
                this.overlayMaterial.uniforms.map.value = this.texture;
                this.overlayMaterial.needsUpdate = true;
            }
            setRenderOne(true);
            return;
        }

        const loadingId = `overlay-${this.overlayID}-${Date.now()}`;
        LoadingManager.registerLoading(loadingId, textureURL, "Image");

        const loader = new TextureLoader();
        loader.load(textureURL, (texture) => {
            LoadingManager.completeLoading(loadingId);
            texture.flipY = false;
            this.originalTexture = texture;
            this.applyCloudExtraction();
        }, (progress) => {
            if (progress.lengthComputable) {
                const percent = (progress.loaded / progress.total) * 100;
                LoadingManager.updateProgress(loadingId, percent);
            }
        }, (error) => {
            LoadingManager.completeLoading(loadingId);
            console.error(`Failed to load overlay texture: ${textureURL}`, error);
        });
    }
    
    applyCloudExtraction() {
        if (!this.originalTexture) return;
        
        if (!this.extractClouds) {
            this.texture = this.originalTexture;
            if (this.overlayMaterial) {
                this.overlayMaterial.uniforms.map.value = this.texture;
                this.overlayMaterial.needsUpdate = true;
            }
            setRenderOne(true);
            return;
        }
        
        const image = this.originalTexture.image;
        if (!image || !image.width || !image.height) {
            this.texture = this.originalTexture;
            return;
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        const targetR = parseInt(this.cloudColor.slice(1, 3), 16);
        const targetG = parseInt(this.cloudColor.slice(3, 5), 16);
        const targetB = parseInt(this.cloudColor.slice(5, 7), 16);
        
        const threshold = (this.cloudFuzziness) * 2.55 * Math.sqrt(3);
        const feather = this.cloudFeather * 2.55 * Math.sqrt(3);
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            const distance = Math.sqrt(
                Math.pow(r - targetR, 2) +
                Math.pow(g - targetG, 2) +
                Math.pow(b - targetB, 2)
            );
            
            if (distance <= threshold) {
                data[i + 3] = 255;
            } else if (distance > threshold+feather) {
                data[i + 3] = 0;
            } else {
                const f  = Math.round(255 * (threshold+feather - distance) / feather)
                data[i + 3] = f;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        const processedTexture = new CanvasTexture(canvas);
        processedTexture.flipY = false;
        
        if (this.texture && this.texture !== this.originalTexture) {
            this.texture.dispose();
        }
        
        this.texture = processedTexture;
        if (this.overlayMaterial) {
            this.overlayMaterial.uniforms.map.value = this.texture;
            this.overlayMaterial.needsUpdate = true;
        }
        setRenderOne(true);
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

    setTexture(texture) {
        this.texture = texture;
        if (this.overlayMaterial) {
            this.overlayMaterial.uniforms.map.value = this.texture;
            this.overlayMaterial.needsUpdate = true;
        }
        setRenderOne(true);
    }

    setFreeTransformCorners(corners) {
        this.freeTransform = true;
        this.corners = corners;
        this._cachedHomography = null;
        const lats = corners.map(c => c.lat);
        const lons = corners.map(c => c.lon);
        this.north = Math.max(...lats);
        this.south = Math.min(...lats);
        this.east = Math.max(...lons);
        this.west = Math.min(...lons);
        this.updateMesh();
    }
    
    getCornerPositions() {
        if (this.freeTransform && this.corners) {
            return this.corners.map(corner => LLAToEUS(corner.lat, corner.lon, 0));
        }
        
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
                const offset = pos.clone().sub(centerEUS);
                const up = getLocalUpVector(centerEUS);
                const rotationRad = radians(this.rotation);
                const rotatedOffset = offset.clone().applyAxisAngle(up, rotationRad);
                pos = centerEUS.clone().add(rotatedOffset);
            }

            return pos;
        });
    }
    
    getCornerLLAs() {
        if (this.freeTransform && this.corners) {
            return this.corners.map(c => ({lat: c.lat, lon: c.lon}));
        }
        
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;

        const corners = [
            {lat: this.north, lon: this.west},
            {lat: this.north, lon: this.east},
            {lat: this.south, lon: this.east},
            {lat: this.south, lon: this.west}
        ];

        if (this.rotation !== 0) {
            const centerEUS = LLAToEUS(centerLat, centerLon, 0);
            const up = getLocalUpVector(centerEUS);
            const rotationRad = radians(this.rotation);
            
            return corners.map(corner => {
                const pos = LLAToEUS(corner.lat, corner.lon, 0);
                const offset = pos.clone().sub(centerEUS);
                const rotatedOffset = offset.clone().applyAxisAngle(up, rotationRad);
                const rotatedPos = centerEUS.clone().add(rotatedOffset);
                const lla = EUSToLLA(rotatedPos);
                return {lat: lla.x, lon: lla.y};
            });
        }
        
        return corners;
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
        if (this.freeTransform && this.corners) {
            return this.inverseHomography(lat, lon, this.corners);
        }
        
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;

        let relLat = lat - centerLat;
        let relLon = lon - centerLon;

        if (this.rotation !== 0) {
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
    
    /**
     * Computes the inverse homography matrix for perspective-correct texture mapping.
     *
     * A homography (projective transformation) is a 3x3 matrix that maps points between
     * two planes. Unlike bilinear interpolation, homography preserves straight lines and
     * produces perspective-correct results - this is what users expect from "Free Transform"
     * tools like in Photoshop.
     *
     * The forward homography H maps UV coordinates (unit square) to lat/lon coordinates:
     *   [x']   [a b c]   [u]
     *   [y'] = [d e f] * [v]
     *   [w']   [g h 1]   [1]
     *
     *   lon = x'/w',  lat = y'/w'
     *
     * This function computes H from the 4-point correspondence, then inverts it to get H^-1
     * which maps lat/lon back to UV coordinates.
     *
     * Corner correspondence (UV -> lat/lon):
     *   (0,0) -> corners[0] (NW)
     *   (1,0) -> corners[1] (NE)
     *   (1,1) -> corners[2] (SE)
     *   (0,1) -> corners[3] (SW)
     *
     * @param {Array} corners - Array of 4 corner objects with {lat, lon} properties
     * @returns {Object|null} Inverse homography matrix elements, or null if degenerate
     */
    computeInverseHomography(corners) {
        // Source points (UV space): unit square
        // (0,0), (1,0), (1,1), (0,1)

        // Destination points (lat/lon space): corners
        // corners[0]=NW, corners[1]=NE, corners[2]=SE, corners[3]=SW
        const x0 = corners[0].lon, y0 = corners[0].lat;
        const x1 = corners[1].lon, y1 = corners[1].lat;
        const x2 = corners[2].lon, y2 = corners[2].lat;
        const x3 = corners[3].lon, y3 = corners[3].lat;

        // Compute the forward homography H that maps UV to lat/lon
        // Using the standard 4-point homography computation
        const dx1 = x1 - x2, dy1 = y1 - y2;
        const dx2 = x3 - x2, dy2 = y3 - y2;
        const sx = x0 - x1 + x2 - x3;
        const sy = y0 - y1 + y2 - y3;

        const denom = dx1 * dy2 - dx2 * dy1;
        if (Math.abs(denom) < 1e-10) {
            // Degenerate case - fall back to affine
            return null;
        }

        const g = (sx * dy2 - sy * dx2) / denom;
        const h = (dx1 * sy - dy1 * sx) / denom;

        const a = x1 - x0 + g * x1;
        const b = x3 - x0 + h * x3;
        const c = x0;
        const d = y1 - y0 + g * y1;
        const e = y3 - y0 + h * y3;
        const f = y0;
        // g and h already computed, i = 1

        // Forward homography H maps (u,v) to (x,y):
        // x = (a*u + b*v + c) / (g*u + h*v + 1)
        // y = (d*u + e*v + f) / (g*u + h*v + 1)

        // Compute inverse homography H^-1
        // H = [a b c; d e f; g h 1]
        // H^-1 = adjugate(H) / det(H)

        const det = a * (e - f * h) - b * (d - f * g) + c * (d * h - e * g);
        if (Math.abs(det) < 1e-15) {
            return null;
        }

        // Adjugate matrix elements (for inverse)
        const ai = (e - f * h) / det;
        const bi = (c * h - b) / det;
        const ci = (b * f - c * e) / det;
        const di = (f * g - d) / det;
        const ei = (a - c * g) / det;
        const fi = (c * d - a * f) / det;
        const gi = (d * h - e * g) / det;
        const hi = (b * g - a * h) / det;
        const ii = (a * e - b * d) / det;

        return {ai, bi, ci, di, ei, fi, gi, hi, ii};
    }

    /**
     * Maps a lat/lon coordinate to UV texture coordinates using inverse homography.
     *
     * This provides perspective-correct texture mapping for arbitrary quadrilaterals,
     * producing results similar to Photoshop's "Free Transform" tool. The homography
     * matrix is cached for performance and automatically invalidated when corners change.
     *
     * The transformation uses homogeneous coordinates:
     *   u' = ai*lon + bi*lat + ci
     *   v' = di*lon + ei*lat + fi
     *   w' = gi*lon + hi*lat + ii
     *
     *   u = u'/w',  v = v'/w'
     *
     * Key differences from bilinear interpolation:
     * - Bilinear: Texture stretches/compresses based on edge lengths (trapezoid effect)
     * - Homography: Texture appears as if viewing a flat plane in perspective
     *
     * @param {number} lat - Latitude of the point to map
     * @param {number} lon - Longitude of the point to map
     * @param {Array} corners - Array of 4 corner objects with {lat, lon} properties
     * @returns {Object} UV coordinates {u, v} where 0-1 is inside the quad
     */
    inverseHomography(lat, lon, corners) {
        // Use cached homography if available, otherwise compute it
        if (!this._cachedHomography || this._cachedHomographyCorners !== corners) {
            this._cachedHomography = this.computeInverseHomography(corners);
            this._cachedHomographyCorners = corners;
        }

        const H = this._cachedHomography;
        if (!H) {
            // Fallback to simple linear interpolation for degenerate cases
            return {u: 0.5, v: 0.5};
        }

        // Apply inverse homography: (x,y) -> (u,v)
        // u' = ai*x + bi*y + ci
        // v' = di*x + ei*y + fi
        // w' = gi*x + hi*y + ii
        // u = u'/w', v = v'/w'

        const x = lon, y = lat;
        const up = H.ai * x + H.bi * y + H.ci;
        const vp = H.di * x + H.ei * y + H.fi;
        const wp = H.gi * x + H.hi * y + H.ii;

        if (Math.abs(wp) < 1e-10) {
            return {u: -999, v: -999};
        }

        return {u: up / wp, v: vp / wp};
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
        this.disposeFlatMesh();

        if (this.altitude > 0) {
            this.buildFlatMesh();
            setRenderOne(true);
            return;
        }

        this.updateGroupPosition();
        this.syncOverlayTiles();
        setRenderOne(true);
    }

    getDesiredOverlayTiles() {
        const terrainMap = this.getTerrainMap();
        if (!terrainMap) return new Map();

        const mapProjection = terrainMap.options?.mapProjection;
        if (!mapProjection) return new Map();

        const desired = new Map();
        terrainMap.forEachTile((tile) => {
            if (!tile.mesh || !tile.mesh.geometry || !tile.loaded) return;
            const layerMask = tile.mesh.layers.mask;
            if (layerMask === 0) return;
            if (!this.tileOverlapsOverlay(tile, mapProjection)) return;
            desired.set(tile.key(), { tile, layerMask });
        });

        return desired;
    }

    syncOverlayTiles() {
        if (this.altitude > 0) return;

        const terrainMap = this.getTerrainMap();
        if (!terrainMap) return;

        const mapProjection = terrainMap.options?.mapProjection;
        if (!mapProjection) return;

        const desired = this.getDesiredOverlayTiles();

        for (const key of [...this.overlayTileMeshes.keys()]) {
            if (!desired.has(key)) {
                this.disposeTileMesh(key);
            }
        }

        for (const [key, { tile, layerMask }] of desired) {
            const existing = this.overlayTileMeshes.get(key);
            if (existing) {
                if (existing.mesh) existing.mesh.layers.mask = layerMask;
                if (existing.skirtMesh) existing.skirtMesh.layers.mask = layerMask;
            } else {
                this.createOverlayTileFromTerrainTile(tile, mapProjection, layerMask);
            }
        }

        setRenderOne(true);
    }

    disposeFlatMesh() {
        if (this.flatMesh) {
            this.group.remove(this.flatMesh);
            if (this.flatMesh.geometry) this.flatMesh.geometry.dispose();
            this.flatMesh = null;
        }
    }
    
    buildFlatMesh() {
        const segments = 100;
        const altitudeMeters = this.altitude * scaleF2M;
        
        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        const centerEUS = LLAToEUS(centerLat, centerLon, altitudeMeters);
        this.group.position.copy(centerEUS);
        
        const positions = [];
        const uvs = [];
        const indices = [];
        
        const cornerLLAs = this.getCornerLLAs();
        
        for (let j = 0; j <= segments; j++) {
            for (let i = 0; i <= segments; i++) {
                const u = i / segments;
                const v = j / segments;
                
                let lat, lon;
                if (this.freeTransform && this.corners) {
                    const lat0 = cornerLLAs[0].lat * (1 - u) + cornerLLAs[1].lat * u;
                    const lat1 = cornerLLAs[3].lat * (1 - u) + cornerLLAs[2].lat * u;
                    lat = lat0 * (1 - v) + lat1 * v;
                    
                    const lon0 = cornerLLAs[0].lon * (1 - u) + cornerLLAs[1].lon * u;
                    const lon1 = cornerLLAs[3].lon * (1 - u) + cornerLLAs[2].lon * u;
                    lon = lon0 * (1 - v) + lon1 * v;
                } else {
                    lat = this.south + (this.north - this.south) * (1 - v);
                    lon = this.west + (this.east - this.west) * u;
                    
                    if (this.rotation !== 0) {
                        const relLat = lat - centerLat;
                        const relLon = lon - centerLon;
                        const cos = Math.cos(radians(this.rotation));
                        const sin = Math.sin(radians(this.rotation));
                        lat = centerLat + relLat * cos - relLon * sin;
                        lon = centerLon + relLat * sin + relLon * cos;
                    }
                }
                
                const pos = LLAToEUS(lat, lon, altitudeMeters);
                positions.push(pos.x - centerEUS.x, pos.y - centerEUS.y, pos.z - centerEUS.z);
                uvs.push(u, v);
            }
        }
        
        for (let j = 0; j < segments; j++) {
            for (let i = 0; i < segments; i++) {
                const a = j * (segments + 1) + i;
                const b = a + 1;
                const c = a + (segments + 1);
                const d = c + 1;
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }
        
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        this.flatMesh = new Mesh(geometry, this.overlayMaterial);
        this.flatMesh.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
        this.flatMesh.frustumCulled = false;
        this.flatMesh.userData.ignoreContextMenu = true;
        this.group.add(this.flatMesh);
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
        this._cachedHomography = null; // Invalidate homography cache
        this.buildMesh();
        if (this.editMode) {
            if (!this.lockShape) {
                this.createControlPoints();
            }
            this.updateLockPointHandles();
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
        assert(!this.lockShape, "Cannot create control points when shape is locked");
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

        const centerLat = (this.north + this.south) / 2;
        const centerLon = (this.east + this.west) / 2;
        const centerEUS = LLAToEUS(centerLat, centerLon, 0);

        const northMidEUS = this.freeTransform && this.corners
            ? LLAToEUS((this.corners[0].lat + this.corners[1].lat) / 2, (this.corners[0].lon + this.corners[1].lon) / 2, 0)
            : LLAToEUS(this.north, centerLon, 0);
        let rotHandleEUS = northMidEUS.clone();
        if (!this.freeTransform && this.rotation !== 0) {
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
        
        this.removeLockPointHandles();
    }
    
    removeLockPointHandles() {
        this.lockPointHandles.forEach(handle => {
            this.group.remove(handle);
            if (handle.geometry) handle.geometry.dispose();
            if (handle.material) handle.material.dispose();
        });
        this.lockPointHandles = [];
    }
    
    updateLockPointHandles() {
        this.removeLockPointHandles();
        if (!this.editMode) return;
        
        const handleGeometry = new SphereGeometry(3, 16, 16);
        const groupPos = this.group.position;
        
        this.lockPoints.forEach((lockPoint, index) => {
            const worldPos = LLAToEUS(lockPoint.worldLLA.lat, lockPoint.worldLLA.lon, 0);
            const groundPos = getPointBelow(worldPos);
            const adjustedPos = pointAbove(groundPos, 5);
            
            const handle = new Mesh(handleGeometry.clone(), this.createHandleMaterial(0xff00ff));
            handle.position.copy(adjustedPos).sub(groupPos);
            handle.layers.mask = LAYER.MASK_HELPERS;
            handle.userData.handleType = 'lockPoint';
            handle.userData.lockPointIndex = index;
            this.group.add(handle);
            this.lockPointHandles.push(handle);
        });
        
        handleGeometry.dispose();
    }
    
    setEditMode(enable) {
        if (this.editMode === enable) return;
        
        this.editMode = enable;
        
        if (enable) {
            Globals.editingOverlay = this;
            this.updateGroupPosition();
            if (!this.lockShape) {
                this.createControlPoints();
            }
            this.updateLockPointHandles();
            CustomManager.showOverlayEditingMenu(this, 100, 100);
        } else {
            if (Globals.editingOverlay === this) {
                Globals.editingOverlay = null;
            }
            this.removeControlPoints();
            
            if (!window._menuBeingDestroyed && CustomManager.overlayEditMenu) {
                CustomManager.overlayEditMenu.destroy();
                CustomManager.overlayEditMenu = null;
            }
        }
        
        if (this.editModeController) {
            this.editModeController.setValue(enable);
        }
        
        setRenderOne(true);
    }
    
    setupEventListeners() {
        this.onPointerDownBound = this.onPointerDown.bind(this);
        this.onPointerMoveBound = this.onPointerMove.bind(this);
        this.onPointerUpBound = this.onPointerUp.bind(this);
        this.onContextMenuBound = this.onContextMenu.bind(this);
        
        document.addEventListener('pointerdown', this.onPointerDownBound);
        document.addEventListener('pointermove', this.onPointerMoveBound);
        document.addEventListener('pointerup', this.onPointerUpBound);
        // Use capture phase to run before the global context menu blocker in index.js
        document.addEventListener('contextmenu', this.onContextMenuBound, { capture: true });
        
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
        if (this.altitude > 0) return;
        const terrainMap = this.getTerrainMap();
        if (!terrainMap || tile.map !== terrainMap) return;

        const mapProjection = terrainMap.options?.mapProjection;
        if (!mapProjection) return;

        const tileKey = tile.key();
        const isDesired = tile.mesh && tile.mesh.geometry && tile.loaded
            && newMask !== 0
            && this.tileOverlapsOverlay(tile, mapProjection);

        const existing = this.overlayTileMeshes.get(tileKey);

        if (isDesired) {
            if (existing) {
                if (existing.mesh) existing.mesh.layers.mask = newMask;
                if (existing.skirtMesh) existing.skirtMesh.layers.mask = newMask;
            } else {
                this.createOverlayTileFromTerrainTile(tile, mapProjection, newMask);
            }
        } else if (existing) {
            this.disposeTileMesh(tileKey);
        }

        setRenderOne(true);
    }
    
    onTileChanged(tile) {
        if (this.altitude > 0) return;
        const terrainMap = this.getTerrainMap();
        if (!terrainMap || tile.map !== terrainMap) return;
        const mapProjection = terrainMap.options?.mapProjection;
        if (!mapProjection) return;
        if (!this.tileOverlapsOverlay(tile, mapProjection)) return;

        this.disposeTileMesh(tile.key());

        if (tile.mesh && tile.mesh.geometry && tile.loaded) {
            const layerMask = tile.mesh.layers.mask;
            if (layerMask !== 0) {
                this.createOverlayTileFromTerrainTile(tile, mapProjection, layerMask);
            }
        }

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
        
        let handle = this.getHandleAtMouse(event.clientX, event.clientY);

        if (!handle) {
            const overlayHit = this.getOverlayAtMouse(event.clientX, event.clientY);
            if (overlayHit) {
                handle = {type: 'move'};
            }
        }

        // Lock point constraints disabled for now
        // if (handle && handle.type === 'corner' && this.lockPoints.length >= 3) {
        //     return;
        // }

        if (handle) {
            this.isDragging = true;
            this.draggingHandle = handle;
            this.stateBeforeDrag = this.captureState();

            if (handle.type === 'lockPoint') {
                // Store initial state for lock point dragging
                this.dragInitialLockPoints = this.lockPoints.map(lp => ({
                    uv: {u: lp.uv.u, v: lp.uv.v},
                    worldLLA: {lat: lp.worldLLA.lat, lon: lp.worldLLA.lon}
                }));
                if (this.freeTransform && this.corners) {
                    this.dragInitialCornersEUS = this.corners.map(c => LLAToEUS(c.lat, c.lon, 0));
                }
            }

            if (handle.type === 'corner' && this.lockPoints.length > 0) {
                // Store lock point data for constrained corner dragging
                this.dragInitialLockPoints = this.lockPoints.map(lp => ({
                    uv: {u: lp.uv.u, v: lp.uv.v},
                    worldLLA: {lat: lp.worldLLA.lat, lon: lp.worldLLA.lon},
                    worldEUS: LLAToEUS(lp.worldLLA.lat, lp.worldLLA.lon, 0)
                }));
                if (this.freeTransform && this.corners) {
                    this.dragInitialCornersEUS = this.corners.map(c => LLAToEUS(c.lat, c.lon, 0));
                }
            }

            if (handle.type === 'rotation' || handle.type === 'move') {
                this.dragInitialNorth = this.north;
                this.dragInitialSouth = this.south;
                this.dragInitialEast = this.east;
                this.dragInitialWest = this.west;
                this.dragInitialRotation = this.rotation;
                this.dragInitialLockPoints = this.lockPoints.map(lp => ({
                    uv: {u: lp.uv.u, v: lp.uv.v},
                    worldLLA: {lat: lp.worldLLA.lat, lon: lp.worldLLA.lon},
                    worldEUS: LLAToEUS(lp.worldLLA.lat, lp.worldLLA.lon, 0)
                }));
                if (this.freeTransform && this.corners) {
                    this.dragInitialCorners = this.corners.map(c => ({lat: c.lat, lon: c.lon}));
                    this.dragInitialCornersEUS = this.corners.map(c => LLAToEUS(c.lat, c.lon, 0));
                    this.dragCenterEUS = this.dragInitialCornersEUS.reduce(
                        (acc, p) => acc.add(p), new Vector3()
                    ).multiplyScalar(0.25);
                }

                const mouseRay = screenToNDC(view, event.clientX, event.clientY);
                this.raycaster.setFromCamera(mouseRay, view.camera);

                const savedMask = this.raycaster.layers.mask;
                this.raycaster.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;

                if (NodeMan.exists("TerrainModel")) {
                    const terrainNode = NodeMan.get("TerrainModel");
                    const intersect = terrainNode.getClosestIntersect(this.raycaster);
                    if (intersect) {
                        const lla = EUSToLLA(intersect.point);
                        this.dragInitialClickLat = lla.x;
                        this.dragInitialClickLon = lla.y;
                        this.dragInitialClickEUS = intersect.point.clone();
                        
                        if (this.freeTransform && this.dragCenterEUS) {
                            const up = getLocalUpVector(this.dragCenterEUS);
                            const toClick = intersect.point.clone().sub(this.dragCenterEUS);
                            const toClickFlat = toClick.clone().sub(up.clone().multiplyScalar(toClick.dot(up)));
                            this.dragInitialAngleEUS = Math.atan2(toClickFlat.z, toClickFlat.x);
                        } else {
                            const centerLat = (this.north + this.south) / 2;
                            const centerLon = (this.east + this.west) / 2;
                            this.dragInitialAngle = Math.atan2(lla.y - centerLon, lla.x - centerLat);
                        }
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
    
    getOverlayAtMouse(mouseX, mouseY) {
        const view = ViewMan.get("mainView");
        if (!view) return null;
        
        const corners = this.getCornerPositions();
        if (corners.length !== 4) return null;
        
        const terrainCorners = corners.map(c => {
            const groundPos = getPointBelow(c);
            return pointAbove(groundPos, 5);
        });
        
        const mouseRay = screenToNDC(view, mouseX, mouseY);
        this.raycaster.setFromCamera(mouseRay, view.camera);
        const ray = this.raycaster.ray;
        
        const target = new Vector3();
        const hit1 = ray.intersectTriangle(terrainCorners[0], terrainCorners[1], terrainCorners[2], false, target);
        if (hit1) {
            return {point: target.clone()};
        }
        
        const hit2 = ray.intersectTriangle(terrainCorners[0], terrainCorners[2], terrainCorners[3], false, target);
        if (hit2) {
            return {point: target.clone()};
        }
        
        return null;
    }
    
    getHandleAtMouse(mouseX, mouseY) {
        const view = ViewMan.get("mainView");
        if (!view) return null;
        
        const mouseRay = screenToNDC(view, mouseX, mouseY);
        this.raycaster.setFromCamera(mouseRay, view.camera);

        const handles = [];
        this.cornerHandles.forEach((mesh, index) => {
            handles.push({mesh, type: 'corner', index});
        });
        if (this.rotationHandle) {
            handles.push({mesh: this.rotationHandle, type: 'rotation'});
        }
        this.lockPointHandles.forEach((mesh, index) => {
            handles.push({mesh, type: 'lockPoint', index});
        });
        
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
            const mouseRay = screenToNDC(view, event.clientX, event.clientY);
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
                        if (this.freeTransform && this.dragInitialCornersEUS && this.dragCenterEUS) {
                            const up = getLocalUpVector(this.dragCenterEUS);
                            const toMouse = intersect.point.clone().sub(this.dragCenterEUS);
                            const toMouseFlat = toMouse.clone().sub(up.clone().multiplyScalar(toMouse.dot(up)));
                            const currentAngle = Math.atan2(toMouseFlat.z, toMouseFlat.x);
                            const angleDelta = currentAngle - this.dragInitialAngleEUS;

                            this.corners = this.dragInitialCornersEUS.map(pos => {
                                const offset = pos.clone().sub(this.dragCenterEUS);
                                const rotatedOffset = offset.clone().applyAxisAngle(up, -angleDelta);
                                const rotatedPos = this.dragCenterEUS.clone().add(rotatedOffset);
                                const groundPos = getPointBelow(rotatedPos);
                                const finalLLA = EUSToLLA(groundPos);
                                return {lat: finalLLA.x, lon: finalLLA.y};
                            });
                            this._cachedHomography = null;
                            this.updateBoundsFromCorners();

                            // Rotate lock points around the same center
                            this.lockPoints = this.dragInitialLockPoints.map(lp => {
                                const lpWorld = LLAToEUS(lp.worldLLA.lat, lp.worldLLA.lon, 0);
                                const offset = lpWorld.clone().sub(this.dragCenterEUS);
                                const rotatedOffset = offset.clone().applyAxisAngle(up, -angleDelta);
                                const rotatedPos = this.dragCenterEUS.clone().add(rotatedOffset);
                                const groundPos = getPointBelow(rotatedPos);
                                const finalLLA = EUSToLLA(groundPos);
                                return {
                                    uv: {u: lp.uv.u, v: lp.uv.v},
                                    worldLLA: {lat: finalLLA.x, lon: finalLLA.y}
                                };
                            });
                            this.updateLockPointHandles();
                        } else {
                            const centerLat = (this.north + this.south) / 2;
                            const centerLon = (this.east + this.west) / 2;
                            const currentAngle = Math.atan2(lla.y - centerLon, lla.x - centerLat);
                            const angleDelta = currentAngle - this.dragInitialAngle;
                            this.rotation = this.dragInitialRotation - degrees(angleDelta);

                            // Rotate lock points around center
                            const centerEUS = LLAToEUS(centerLat, centerLon, 0);
                            const up = getLocalUpVector(centerEUS);
                            this.lockPoints = this.dragInitialLockPoints.map(lp => {
                                const lpWorld = lp.worldEUS.clone();
                                const offset = lpWorld.clone().sub(centerEUS);
                                const rotatedOffset = offset.clone().applyAxisAngle(up, angleDelta);
                                const rotatedPos = centerEUS.clone().add(rotatedOffset);
                                const groundPos = getPointBelow(rotatedPos);
                                const finalLLA = EUSToLLA(groundPos);
                                return {
                                    uv: {u: lp.uv.u, v: lp.uv.v},
                                    worldLLA: {lat: finalLLA.x, lon: finalLLA.y}
                                };
                            });
                            this.updateLockPointHandles();
                        }
                    } else if (this.draggingHandle.type === 'move') {
                        if (this.freeTransform && this.dragInitialCornersEUS && this.dragInitialClickEUS) {
                            const displacement = intersect.point.clone().sub(this.dragInitialClickEUS);

                            this.corners = this.dragInitialCornersEUS.map(pos => {
                                const movedPos = pos.clone().add(displacement);
                                const groundPos = getPointBelow(movedPos);
                                const finalLLA = EUSToLLA(groundPos);
                                return {lat: finalLLA.x, lon: finalLLA.y};
                            });
                            this._cachedHomography = null;
                            this.updateBoundsFromCorners();

                            // Move lock points by same displacement
                            this.lockPoints = this.dragInitialLockPoints.map(lp => {
                                const movedPos = lp.worldEUS.clone().add(displacement);
                                const groundPos = getPointBelow(movedPos);
                                const finalLLA = EUSToLLA(groundPos);
                                return {
                                    uv: {u: lp.uv.u, v: lp.uv.v},
                                    worldLLA: {lat: finalLLA.x, lon: finalLLA.y}
                                };
                            });
                            this.updateLockPointHandles();
                        } else {
                            const deltaLat = lla.x - this.dragInitialClickLat;
                            const deltaLon = lla.y - this.dragInitialClickLon;
                            this.north = this.dragInitialNorth + deltaLat;
                            this.south = this.dragInitialSouth + deltaLat;
                            this.east = this.dragInitialEast + deltaLon;
                            this.west = this.dragInitialWest + deltaLon;

                            // Move lock points by same delta
                            this.lockPoints = this.dragInitialLockPoints.map(lp => ({
                                uv: {u: lp.uv.u, v: lp.uv.v},
                                worldLLA: {
                                    lat: lp.worldLLA.lat + deltaLat,
                                    lon: lp.worldLLA.lon + deltaLon
                                }
                            }));
                            this.updateLockPointHandles();
                        }
                    } else if (this.draggingHandle.type === 'lockPoint') {
                        this.handleLockPointDrag(this.draggingHandle.index, lla.x, lla.y);
                    }

                    this.updateMesh();
                    this.updateGUIControllers();
                    setRenderOne(true);
                }
            }
        }
    }
    
    updateCorner(cornerIndex, lat, lon) {
        // Lock point constraints disabled for now
        // if (this.lockPoints.length > 0) {
        //     this.updateCornerWithLockPoints(cornerIndex, lat, lon);
        //     return;
        // }

        if (this.freeTransform && this.corners) {
            this.corners[cornerIndex] = {lat, lon};
            this._cachedHomography = null; // Invalidate homography cache
            this.updateBoundsFromCorners();
            return;
        }
        
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
    
    updateBoundsFromCorners() {
        if (!this.corners) return;
        const lats = this.corners.map(c => c.lat);
        const lons = this.corners.map(c => c.lon);
        this.north = Math.max(...lats);
        this.south = Math.min(...lats);
        this.east = Math.max(...lons);
        this.west = Math.min(...lons);
    }

    /**
     * Handle dragging a lock point to a new world position.
     * The lock point's UV stays fixed, but its world position changes.
     * Corners are recomputed to maintain all lock points' UV-to-world mappings.
     */
    handleLockPointDrag(lockPointIndex, newLat, newLon) {
        if (!this.freeTransform || !this.corners) {
            // Convert to free transform mode first
            this.corners = this.getCornerLLAs();
            this.freeTransform = true;
            this.rotation = 0;
        }

        // Update the dragged lock point's world position
        this.lockPoints[lockPointIndex].worldLLA = {lat: newLat, lon: newLon};

        // Recompute corners based on lock points
        this.solveCornersFromLockPoints();
        this.updateLockPointHandles();
    }

    /**
     * Solve for new corners given the current lock points.
     * Uses different strategies based on number of lock points.
     */
    solveCornersFromLockPoints() {
        if (this.lockPoints.length === 0) return;

        if (this.lockPoints.length === 3) {
            this.solveCornersFrom3LockPoints();
        } else if (this.lockPoints.length === 2) {
            this.solveCornersFrom2LockPoints();
        } else if (this.lockPoints.length === 1) {
            this.solveCornersFrom1LockPoint();
        }

        this._cachedHomography = null;
        this.updateBoundsFromCorners();
    }

    /**
     * With 3 lock points, we have 3 UV-to-world correspondences.
     * Combined with the quad constraint (4th corner derivable), this fully determines the corners.
     */
    solveCornersFrom3LockPoints() {
        // Convert lock points to EUS for computation
        const lockEUS = this.lockPoints.map(lp => ({
            uv: lp.uv,
            world: LLAToEUS(lp.worldLLA.lat, lp.worldLLA.lon, 0)
        }));

        // UV corners: (0,0), (1,0), (1,1), (0,1) for NW, NE, SE, SW
        // We need to find 4 world positions that satisfy the 3 lock point constraints
        // and maintain quad shape (opposite edges parallel in UV space maps to parallelogram-ish in world)

        // Compute the homography from 3 points using a projective approach
        // Since we have 3 points, we can solve for an affine transform (6 DOF)
        // which maps UV to world (lon, lat proxy using local EUS x, z)

        const uv1 = lockEUS[0].uv, w1 = lockEUS[0].world;
        const uv2 = lockEUS[1].uv, w2 = lockEUS[1].world;
        const uv3 = lockEUS[2].uv, w3 = lockEUS[2].world;

        // Solve affine transform: world = A * uv + b
        // Using 3 points gives us exactly 6 equations for 6 unknowns (a11, a12, a21, a22, bx, bz)
        // w.x = a11 * u + a12 * v + bx
        // w.z = a21 * u + a22 * v + bz

        // Set up matrix equation
        const matrix = [
            [uv1.u, uv1.v, 1, 0, 0, 0],
            [0, 0, 0, uv1.u, uv1.v, 1],
            [uv2.u, uv2.v, 1, 0, 0, 0],
            [0, 0, 0, uv2.u, uv2.v, 1],
            [uv3.u, uv3.v, 1, 0, 0, 0],
            [0, 0, 0, uv3.u, uv3.v, 1]
        ];
        const rhs = [w1.x, w1.z, w2.x, w2.z, w3.x, w3.z];

        const solution = this.solveLinearSystem(matrix, rhs);
        if (!solution) return;

        const [a11, a12, bx, a21, a22, bz] = solution;

        // Calculate corners using the affine transform
        const uvCorners = [
            {u: 0, v: 0},  // NW
            {u: 1, v: 0},  // NE
            {u: 1, v: 1},  // SE
            {u: 0, v: 1}   // SW
        ];

        // Get reference Y from first lock point (assumes flat ground)
        const refY = w1.y;

        this.corners = uvCorners.map(uv => {
            const x = a11 * uv.u + a12 * uv.v + bx;
            const z = a21 * uv.u + a22 * uv.v + bz;
            const worldPos = new Vector3(x, refY, z);
            const groundPos = getPointBelow(worldPos);
            const lla = EUSToLLA(groundPos);
            return {lat: lla.x, lon: lla.y};
        });
    }

    /**
     * With 2 lock points, the overlay can shear parallel to the lock point line
     * and scale perpendicular to it. Corner dragging will be constrained accordingly.
     */
    solveCornersFrom2LockPoints() {
        // Get the two lock points in EUS
        const lp1 = this.lockPoints[0];
        const lp2 = this.lockPoints[1];
        const w1 = LLAToEUS(lp1.worldLLA.lat, lp1.worldLLA.lon, 0);
        const w2 = LLAToEUS(lp2.worldLLA.lat, lp2.worldLLA.lon, 0);

        // Direction from lock point 1 to 2 in both UV and world space
        const uvDir = {u: lp2.uv.u - lp1.uv.u, v: lp2.uv.v - lp1.uv.v};
        const worldDir = w2.clone().sub(w1);

        // Lengths
        const uvLen = Math.sqrt(uvDir.u * uvDir.u + uvDir.v * uvDir.v);
        const worldLen = worldDir.length();

        if (uvLen < 1e-10 || worldLen < 1e-10) return;

        // Scale factor from UV to world
        const scale = worldLen / uvLen;

        // Rotation: angle from UV direction to world direction (in horizontal plane)
        const uvAngle = Math.atan2(uvDir.v, uvDir.u);
        const worldAngle = Math.atan2(worldDir.z, worldDir.x);
        const rotAngle = worldAngle - uvAngle;

        // Build transformation: scale + rotate around uv1, then translate
        const cos = Math.cos(rotAngle);
        const sin = Math.sin(rotAngle);

        // Apply transform to UV corners
        const uvCorners = [
            {u: 0, v: 0},
            {u: 1, v: 0},
            {u: 1, v: 1},
            {u: 0, v: 1}
        ];

        const refY = w1.y;

        this.corners = uvCorners.map(uv => {
            // Translate to origin at lp1.uv
            const du = uv.u - lp1.uv.u;
            const dv = uv.v - lp1.uv.v;

            // Scale and rotate
            const x = (du * cos - dv * sin) * scale;
            const z = (du * sin + dv * cos) * scale;

            // Translate to world position of lp1
            const worldPos = new Vector3(w1.x + x, refY, w1.z + z);
            const groundPos = getPointBelow(worldPos);
            const lla = EUSToLLA(groundPos);
            return {lat: lla.x, lon: lla.y};
        });
    }

    /**
     * With 1 lock point, it acts as a pivot. Preserve relative positions from current corners.
     */
    solveCornersFrom1LockPoint() {
        const lp = this.lockPoints[0];
        const targetWorld = LLAToEUS(lp.worldLLA.lat, lp.worldLLA.lon, 0);

        // Calculate where the lock point currently maps to based on current corners
        const currentCorners = this.corners.map(c => LLAToEUS(c.lat, c.lon, 0));
        const currentWorld = this.uvToWorldFromCorners(lp.uv, currentCorners);

        // Displacement needed to move current mapping to target
        const displacement = targetWorld.clone().sub(currentWorld);

        // Move all corners by this displacement
        this.corners = currentCorners.map(pos => {
            const movedPos = pos.clone().add(displacement);
            const groundPos = getPointBelow(movedPos);
            const lla = EUSToLLA(groundPos);
            return {lat: lla.x, lon: lla.y};
        });
    }

    /**
     * Convert UV to world position using bilinear interpolation of corners.
     */
    uvToWorldFromCorners(uv, cornersEUS) {
        // Bilinear interpolation
        // corners: 0=NW(0,0), 1=NE(1,0), 2=SE(1,1), 3=SW(0,1)
        const u = uv.u, v = uv.v;
        const top = cornersEUS[0].clone().lerp(cornersEUS[1], u);
        const bottom = cornersEUS[3].clone().lerp(cornersEUS[2], u);
        return top.clone().lerp(bottom, v);
    }

    /**
     * Solve a linear system Ax = b using Gaussian elimination with partial pivoting.
     */
    solveLinearSystem(A, b) {
        const n = b.length;
        const aug = A.map((row, i) => [...row, b[i]]);

        for (let col = 0; col < n; col++) {
            // Find pivot
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
                    maxRow = row;
                }
            }
            [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

            if (Math.abs(aug[col][col]) < 1e-12) return null; // Singular

            // Eliminate below
            for (let row = col + 1; row < n; row++) {
                const factor = aug[row][col] / aug[col][col];
                for (let j = col; j <= n; j++) {
                    aug[row][j] -= factor * aug[col][j];
                }
            }
        }

        // Back substitution
        const x = new Array(n);
        for (let i = n - 1; i >= 0; i--) {
            x[i] = aug[i][n];
            for (let j = i + 1; j < n; j++) {
                x[i] -= aug[i][j] * x[j];
            }
            x[i] /= aug[i][i];
        }
        return x;
    }

    /**
     * Update a corner position while respecting lock point constraints.
     *
     * TRANSFORMATION-BASED APPROACH:
     * Instead of adjusting individual corners, we compute the transformation
     * that best maps all control points (lock points + dragged corner) from
     * UV space to world space, then apply it to all corner UVs.
     *
     * With 1 lock point + 1 dragged corner = 2 point correspondences:
     *   → Solve for SIMILARITY transform (rotation + uniform scale + translation)
     *
     * With 2 lock points + 1 dragged corner = 3 point correspondences:
     *   → Solve for AFFINE transform (can handle shear, non-uniform scale)
     */
    updateCornerWithLockPoints(cornerIndex, lat, lon) {
        // Ensure we're in free transform mode
        if (!this.freeTransform || !this.corners) {
            this.corners = this.getCornerLLAs();
            this.freeTransform = true;
            this.rotation = 0;
        }

        if (!this.dragInitialCornersEUS || !this.dragInitialLockPoints) {
            this.corners[cornerIndex] = {lat, lon};
            this._cachedHomography = null;
            this.updateBoundsFromCorners();
            return;
        }

        const newCornerWorld = LLAToEUS(lat, lon, 0);

        // Corner UVs: 0=NW(0,0), 1=NE(1,0), 2=SE(1,1), 3=SW(0,1)
        const cornerUVs = [
            {u: 0, v: 0},
            {u: 1, v: 0},
            {u: 1, v: 1},
            {u: 0, v: 1}
        ];

        // Build point correspondences: UV → World (using X-Z plane, Y=0)
        // Each correspondence: {u, v, x, z}
        const correspondences = [];

        // Add lock points as correspondences (these are fixed)
        for (const lp of this.dragInitialLockPoints) {
            const world = LLAToEUS(lp.worldLLA.lat, lp.worldLLA.lon, 0);
            correspondences.push({
                u: lp.uv.u,
                v: lp.uv.v,
                x: world.x,
                z: world.z
            });
        }

        // Add dragged corner as a correspondence
        const draggedUV = cornerUVs[cornerIndex];
        correspondences.push({
            u: draggedUV.u,
            v: draggedUV.v,
            x: newCornerWorld.x,
            z: newCornerWorld.z
        });

        // Solve for transformation based on number of correspondences
        let transform;
        if (correspondences.length === 2) {
            // 2 points → Similarity transform (4 DOF: a, b, tx, tz)
            // x' = a*u - b*v + tx
            // z' = b*u + a*v + tz
            transform = this.solveSimilarityTransform(correspondences);
        } else if (correspondences.length >= 3) {
            // 3+ points → Affine transform (6 DOF)
            // x' = a*u + b*v + tx
            // z' = c*u + d*v + tz
            transform = this.solveAffineTransform(correspondences);
        } else {
            // 1 point - just translation, not useful for corner drag
            this.corners[cornerIndex] = {lat, lon};
            this._cachedHomography = null;
            this.updateBoundsFromCorners();
            return;
        }

        if (!transform) {
            // Fallback if solve fails
            this.corners[cornerIndex] = {lat, lon};
            this._cachedHomography = null;
            this.updateBoundsFromCorners();
            return;
        }

        // Apply transformation to all 4 corner UVs to get new world positions
        const refY = this.dragInitialCornersEUS[0].y;
        this.corners = cornerUVs.map(uv => {
            const world = transform(uv.u, uv.v);
            const pos = new Vector3(world.x, refY, world.z);
            const groundPos = getPointBelow(pos);
            const lla = EUSToLLA(groundPos);
            return {lat: lla.x, lon: lla.y};
        });

        this._cachedHomography = null;
        this.updateBoundsFromCorners();
        this.updateLockPointHandles();
    }

    /**
     * Solve for similarity transform from 2 point correspondences.
     * Similarity = rotation + uniform scale + translation (4 DOF)
     *
     * Transform: x' = a*u - b*v + tx
     *            z' = b*u + a*v + tz
     *
     * Where a = s*cos(θ), b = s*sin(θ), s = scale, θ = rotation
     *
     * @returns {Function} transform(u, v) → {x, z}
     */
    solveSimilarityTransform(correspondences) {
        const p1 = correspondences[0];
        const p2 = correspondences[1];

        // Compute differences
        const du = p2.u - p1.u;
        const dv = p2.v - p1.v;
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;

        // Solve 2x2 system:
        // [du  -dv] [a]   [dx]
        // [dv   du] [b] = [dz]
        const det = du * du + dv * dv;
        if (det < 1e-12) return null;

        const a = (du * dx + dv * dz) / det;
        const b = (du * dz - dv * dx) / det;

        // Compute translation using first point
        const tx = p1.x - a * p1.u + b * p1.v;
        const tz = p1.z - b * p1.u - a * p1.v;

        // Return transform function
        return (u, v) => ({
            x: a * u - b * v + tx,
            z: b * u + a * v + tz
        });
    }

    /**
     * Solve for affine transform from 3+ point correspondences.
     * Affine = scale (non-uniform) + rotation + shear + translation (6 DOF)
     *
     * Transform: x' = a*u + b*v + tx
     *            z' = c*u + d*v + tz
     *
     * @returns {Function} transform(u, v) → {x, z}
     */
    solveAffineTransform(correspondences) {
        // With exactly 3 points, we can solve directly
        // With more points, we'd use least squares (not implemented here)
        const p1 = correspondences[0];
        const p2 = correspondences[1];
        const p3 = correspondences[2];

        // Set up system: for each point, x = a*u + b*v + tx
        // Matrix form: [u1 v1 1] [a ]   [x1]
        //              [u2 v2 1] [b ] = [x2]
        //              [u3 v3 1] [tx]   [x3]
        // Same for z with unknowns c, d, tz

        const M = [
            [p1.u, p1.v, 1],
            [p2.u, p2.v, 1],
            [p3.u, p3.v, 1]
        ];

        const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
                  - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
                  + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

        if (Math.abs(det) < 1e-12) return null;

        // Compute inverse of M using cofactors
        const invDet = 1 / det;
        const Minv = [
            [
                (M[1][1] * M[2][2] - M[1][2] * M[2][1]) * invDet,
                (M[0][2] * M[2][1] - M[0][1] * M[2][2]) * invDet,
                (M[0][1] * M[1][2] - M[0][2] * M[1][1]) * invDet
            ],
            [
                (M[1][2] * M[2][0] - M[1][0] * M[2][2]) * invDet,
                (M[0][0] * M[2][2] - M[0][2] * M[2][0]) * invDet,
                (M[0][2] * M[1][0] - M[0][0] * M[1][2]) * invDet
            ],
            [
                (M[1][0] * M[2][1] - M[1][1] * M[2][0]) * invDet,
                (M[0][1] * M[2][0] - M[0][0] * M[2][1]) * invDet,
                (M[0][0] * M[1][1] - M[0][1] * M[1][0]) * invDet
            ]
        ];

        // Solve for x coefficients: [a, b, tx] = Minv * [x1, x2, x3]
        const xVec = [p1.x, p2.x, p3.x];
        const a  = Minv[0][0] * xVec[0] + Minv[0][1] * xVec[1] + Minv[0][2] * xVec[2];
        const b  = Minv[1][0] * xVec[0] + Minv[1][1] * xVec[1] + Minv[1][2] * xVec[2];
        const tx = Minv[2][0] * xVec[0] + Minv[2][1] * xVec[1] + Minv[2][2] * xVec[2];

        // Solve for z coefficients: [c, d, tz] = Minv * [z1, z2, z3]
        const zVec = [p1.z, p2.z, p3.z];
        const c  = Minv[0][0] * zVec[0] + Minv[0][1] * zVec[1] + Minv[0][2] * zVec[2];
        const d  = Minv[1][0] * zVec[0] + Minv[1][1] * zVec[1] + Minv[1][2] * zVec[2];
        const tz = Minv[2][0] * zVec[0] + Minv[2][1] * zVec[1] + Minv[2][2] * zVec[2];

        // Return transform function
        return (u, v) => ({
            x: a * u + b * v + tx,
            z: c * u + d * v + tz
        });
    }

    onPointerUp(event) {
        if (this.isDragging) {
            const view = ViewMan.get("mainView");
            if (view && view.controls) {
                view.controls.enabled = true;
            }
            
            if (this.stateBeforeDrag && UndoManager) {
                const stateAfterDrag = this.captureState();
                const stateBefore = this.stateBeforeDrag;
                const stateChanged = JSON.stringify(stateBefore) !== JSON.stringify(stateAfterDrag);
                
                if (stateChanged) {
                    const handleType = this.draggingHandle?.type || 'edit';
                    const actionDescription = handleType === 'rotation' 
                        ? `Rotate overlay "${this.name}"`
                        : handleType === 'move'
                        ? `Move overlay "${this.name}"`
                        : `Resize overlay "${this.name}"`;
                    
                    UndoManager.add({
                        undo: () => {
                            this.restoreState(stateBefore);
                        },
                        redo: () => {
                            this.restoreState(stateAfterDrag);
                        },
                        description: actionDescription
                    });
                }
            }
            
            this.stateBeforeDrag = null;
            this.isDragging = false;
            this.draggingHandle = null;
        }
    }
    
    onContextMenu(event) {
        if (!this.editMode) return;
        
        const view = ViewMan.get("mainView");
        if (!view || !mouseInViewOnly(view, event.clientX, event.clientY)) return;
        
        const overlayHit = this.getOverlayAtMouse(event.clientX, event.clientY);
        if (!overlayHit) return;
        
        event.preventDefault();
        event.stopPropagation();
        
        const hitLLA = EUSToLLA(overlayHit.point);
        const hitLat = hitLLA.x;
        const hitLon = hitLLA.y;
        
        if (event.altKey) {
            const lockPointIndex = this.getLockPointAtMouse(event.clientX, event.clientY);
            if (lockPointIndex !== -1) {
                this.lockPoints.splice(lockPointIndex, 1);
                this.updateLockPointHandles();
                setRenderOne(true);
            }
            return;
        }
        
        if (this.lockPoints.length >= 3) return;
        
        const uv = this.latLonToUV(hitLat, hitLon);
        if (!uv || uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1) return;
        
        this.lockPoints.push({
            uv: {u: uv.u, v: uv.v},
            worldLLA: {lat: hitLat, lon: hitLon}
        });
        
        this.updateLockPointHandles();
        setRenderOne(true);
    }
    
    getLockPointAtMouse(mouseX, mouseY) {
        const view = ViewMan.get("mainView");
        if (!view) return -1;
        
        const mouseRay = screenToNDC(view, mouseX, mouseY);
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        for (let i = 0; i < this.lockPointHandles.length; i++) {
            const handle = this.lockPointHandles[i];
            const intersects = this.raycaster.intersectObject(handle, false);
            if (intersects.length > 0) {
                return i;
            }
        }
        return -1;
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
        
        this.lockPointHandles.forEach(handle => {
            handle.getWorldPosition(worldPos);
            const scale = view.pixelsToMeters(worldPos, handlePixelSize);
            handle.scale.set(scale / 3, scale / 3, scale / 3);
        });
    }
    
    createGUIFolder() {
        this.guiFolder = guiMenus.objects.addFolder(`Overlay: ${this.name}`);
        
        this.guiFolder.add(this, 'name').name('Name').onChange(() => {
            this.guiFolder.title = `Overlay: ${this.name}`;
        });
        
        const editModeData = {editMode: this.editMode};
        this.editModeController = this.guiFolder.add(editModeData, 'editMode').name('Edit Mode').onChange((value) => {
            this.setEditMode(value);
        });
        
        this.guiFolder.add(this, 'lockShape').name('Lock Shape').onChange(() => {
            if (this.editMode) {
                if (this.lockShape) {
                    this.removeControlPoints();
                } else {
                    this.createControlPoints();
                }
                setRenderOne(true);
            }
        });
        
        this.guiFolder.add(this, 'freeTransform').name('Free Transform').onChange(() => {
            if (this.freeTransform) {
                this.corners = this.getCornerLLAs();
                this.rotation = 0;
            } else {
                this.corners = null;
            }
            this.updateMesh();
        });
        
        this.guiFolder.add(this, 'showBorder').name('Show Border').onChange(() => {
            if (this.showBorder) {
                this.showHighlightBorder();
            } else {
                this.hideHighlightBorder();
            }
        });
        
        const propsFolder = this.guiFolder.addFolder('Properties').close();
        
        propsFolder.add(this, 'imageURL').name('Image URL').onChange(() => {
            this.loadTexture();
        });
        
        propsFolder.add({rehost: () => this.showRehostDialog()}, 'rehost').name('Rehost Local Image');
        
        propsFolder.add(this, 'north', -90, 90, 0.0001).name('North').onChange(() => {
            this.updateMesh();
        });
        
        propsFolder.add(this, 'south', -90, 90, 0.0001).name('South').onChange(() => {
            this.updateMesh();
        });
        
        propsFolder.add(this, 'east', -180, 180, 0.0001).name('East').onChange(() => {
            this.updateMesh();
        });
        
        propsFolder.add(this, 'west', -180, 180, 0.0001).name('West').onChange(() => {
            this.updateMesh();
        });
        
        propsFolder.add(this, 'rotation', -180, 180, 0.1).name('Rotation').onChange(() => {
            this.updateMesh();
        });
        
        propsFolder.add(this, 'altitude', 0, 50000, 100).name('Altitude (ft)').onChange(() => {
            this.updateMesh();
        });
        
        propsFolder.add(this, 'wireframe').name('Wireframe').onChange(() => {
            if (this.overlayMaterial) {
                this.overlayMaterial.wireframe = this.wireframe;
                this.overlayMaterial.needsUpdate = true;
            }
            setRenderOne(true);
        });
        
        propsFolder.add(this, 'opacity', 0, 1, 0.01).name('Opacity').onChange(() => {
            if (this.overlayMaterial) {
                this.overlayMaterial.uniforms.opacity.value = this.opacity;
            }
            setRenderOne(true);
        });
        
        const cloudFolder = this.guiFolder.addFolder('Cloud Extraction').close();
        
        cloudFolder.add(this, 'extractClouds').name('Extract Clouds').onChange(() => {
            this.applyCloudExtraction();
        });
        
        cloudFolder.addColor(this, 'cloudColor').name('Cloud Color').onChange(() => {
            if (this.extractClouds) this.applyCloudExtraction();
        });
        
        cloudFolder.add(this, 'cloudFuzziness', 0, 100, 1).name('Fuzziness').onChange(() => {
            if (this.extractClouds) this.applyCloudExtraction();
        });
        
        cloudFolder.add(this, 'cloudFeather', 0, 100, 1).name('Feather').onChange(() => {
            if (this.extractClouds) this.applyCloudExtraction();
        });
        
        this.guiFolder.add({goto: () => this.gotoOverlay()}, 'goto').name('Go to Overlay');
        
        this.guiFolder.add({remove: () => this.deleteOverlay()}, 'remove').name('Delete Overlay');
        
        this.guiFolder.domElement.addEventListener('mouseenter', () => {
            this.showHighlightBorder();
        });
        this.guiFolder.domElement.addEventListener('mouseleave', () => {
            this.hideHighlightBorder();
        });
        
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
        
        const northEUS = LLAToEUS(this.north, centerLon, 0);
        const southEUS = LLAToEUS(this.south, centerLon, 0);
        const eastEUS = LLAToEUS(centerLat, this.east, 0);
        const westEUS = LLAToEUS(centerLat, this.west, 0);
        
        const nsDistance = northEUS.distanceTo(southEUS);
        const ewDistance = eastEUS.distanceTo(westEUS);
        const longestEdge = Math.max(nsDistance, ewDistance);
        
        const above = longestEdge * 5;
        const back = longestEdge * 0.1;
        
        NodeMan.get("mainCamera").goToPoint(groundPos, above, back);
    }
    
    captureState() {
        return {
            north: this.north,
            south: this.south,
            east: this.east,
            west: this.west,
            rotation: this.rotation,
            freeTransform: this.freeTransform,
            corners: this.corners ? this.corners.map(c => ({lat: c.lat, lon: c.lon})) : null,
            lockPoints: this.lockPoints.map(lp => ({
                uv: {u: lp.uv.u, v: lp.uv.v},
                worldLLA: {lat: lp.worldLLA.lat, lon: lp.worldLLA.lon}
            })),
        };
    }
    
    restoreState(state) {
        this.north = state.north;
        this.south = state.south;
        this.east = state.east;
        this.west = state.west;
        this.rotation = state.rotation;
        this.freeTransform = state.freeTransform || false;
        this.corners = state.corners ? state.corners.map(c => ({lat: c.lat, lon: c.lon})) : null;
        this.lockPoints = state.lockPoints ? state.lockPoints.map(lp => ({
            uv: {u: lp.uv.u, v: lp.uv.v},
            worldLLA: {lat: lp.worldLLA.lat, lon: lp.worldLLA.lon}
        })) : [];
        this.updateMesh();
        this.updateGUIControllers();
        this.updateLockPointHandles();
        setRenderOne(true);
    }

    /**
     * Delete this overlay with confirmation and undo support
     */
    deleteOverlay() {
        if (confirm(`Delete overlay "${this.name}"?`)) {
            if (UndoManager) {
                const overlayState = this.serialize();
                const overlayID = this.overlayID;

                UndoManager.add({
                    undo: () => {
                        Synth3DManager.addOverlay(overlayState);
                    },
                    redo: () => {
                        Synth3DManager.removeOverlay(overlayID);
                    },
                    description: `Delete overlay "${this.name}"`
                });
            }

            Synth3DManager.removeOverlay(this.overlayID);
        }
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
            imageFileID: this.imageFileID,
            wireframe: this.wireframe,
            opacity: this.opacity,
            extractClouds: this.extractClouds,
            cloudColor: this.cloudColor,
            cloudFuzziness: this.cloudFuzziness,
            cloudFeather: this.cloudFeather,
            altitude: this.altitude,
            lockShape: this.lockShape,
            showBorder: this.showBorder,
            freeTransform: this.freeTransform,
            corners: this.corners,
            lockPoints: this.lockPoints.map(lp => ({
                uv: {u: lp.uv.u, v: lp.uv.v},
                worldLLA: {lat: lp.worldLLA.lat, lon: lp.worldLLA.lon}
            })),
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
            altitude: data.altitude,
            imageURL: data.imageURL,
            imageFileID: data.imageFileID,
            wireframe: data.wireframe,
            opacity: data.opacity,
            extractClouds: data.extractClouds,
            cloudColor: data.cloudColor,
            cloudFuzziness: data.cloudFuzziness,
            cloudFeather: data.cloudFeather,
            lockShape: data.lockShape,
            freeTransform: data.freeTransform,
            corners: data.corners,
            lockPoints: data.lockPoints || [],
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
            const desired = this.getDesiredOverlayTiles();
            for (const [key, { tile }] of desired) {
                terrainTileKeys.add(key);
                zoomCounts[tile.z] = (zoomCounts[tile.z] || 0) + 1;
            }
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
    
    showHighlightBorder() {
        const corners = this.getCornerPositions();
        const groupPos = this.group.position;
        const points = corners.map(c => {
            const groundPos = getPointBelow(c);
            const adjustedPos = pointAbove(groundPos, 5);
            return adjustedPos.clone().sub(groupPos);
        });
        points.push(points[0].clone());
        
        const positions = [];
        for (const p of points) {
            positions.push(p.x, p.y, p.z);
        }
        
        if (!this.highlightBorder) {
            this.highlightBorderMaterial = makeMatLine(0xff0000, 3);
            const geometry = new LineGeometry();
            geometry.setPositions(positions);
            this.highlightBorder = new Line2(geometry, this.highlightBorderMaterial);
            this.highlightBorder.computeLineDistances();
            this.highlightBorder.renderOrder = 999999;
            this.highlightBorder.material.depthTest = false;
            this.group.add(this.highlightBorder);
        } else {
            this.highlightBorder.geometry.dispose();
            const geometry = new LineGeometry();
            geometry.setPositions(positions);
            this.highlightBorder.geometry = geometry;
            this.highlightBorder.computeLineDistances();
        }
        
        this.highlightBorder.visible = true;
        setRenderOne(true);
    }
    
    hideHighlightBorder() {
        if (this.highlightBorder && !this.showBorder) {
            this.highlightBorder.visible = false;
            setRenderOne(true);
        }
    }
    
    disposeHighlightBorder() {
        if (this.highlightBorder) {
            this.group.remove(this.highlightBorder);
            this.highlightBorder.geometry.dispose();
            this.highlightBorder = null;
        }
        if (this.highlightBorderMaterial) {
            disposeMatLine(this.highlightBorderMaterial);
            this.highlightBorderMaterial = null;
        }
    }
    
    dispose() {
        document.removeEventListener('pointerdown', this.onPointerDownBound);
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        document.removeEventListener('pointerup', this.onPointerUpBound);
        document.removeEventListener('contextmenu', this.onContextMenuBound, { capture: true });

        EventManager.removeEventListener("tileVisibilityChanged", this.onTileVisibilityChangedBound);
        EventManager.removeEventListener("tileChanged", this.onTileChangedBound);
        
        this.removeControlPoints();
        this.disposeTileMeshes();
        this.disposeFlatMesh();
        this.disposeHighlightBorder();
        
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
