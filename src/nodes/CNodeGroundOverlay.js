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
        this.moveHandle = null;
        
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
        if (this.editMode && !this.lockShape) {
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

        if (!this.freeTransform) {
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
        }

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
            this.updateGroupPosition();
            if (!this.lockShape) {
                this.createControlPoints();
            }
            CustomManager.showOverlayEditingMenu(this, 100, 100);
        } else {
            if (Globals.editingOverlay === this) {
                Globals.editingOverlay = null;
            }
            this.removeControlPoints();
            
            if (CustomManager.overlayEditMenu) {
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
        if (this.altitude > 0) return;
        
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
        if (this.altitude > 0) return;
        
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
            this.stateBeforeDrag = this.captureState();

            // For rotation or move handle, store initial state for relative dragging
            if (handle.type === 'rotation' || handle.type === 'move') {
                // Store initial bounds for move handle
                this.dragInitialNorth = this.north;
                this.dragInitialSouth = this.south;
                this.dragInitialEast = this.east;
                this.dragInitialWest = this.west;
                this.dragInitialRotation = this.rotation;

                // Get the terrain intersection point for the initial click
                const mouseRay = screenToNDC(view, event.clientX, event.clientY);
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
        
        const mouseRay = screenToNDC(view, mouseX, mouseY);
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
        this.updateMesh();
        this.updateGUIControllers();
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
    
    showHighlightBorder() {
        const corners = this.getCornerPositions();
        const groupPos = this.group.position;
        const points = corners.map(c => c.clone().sub(groupPos));
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
