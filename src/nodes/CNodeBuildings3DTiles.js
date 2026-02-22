// CNodeBuildings3DTiles.js
// Renders 3D building tiles using NASA's 3DTilesRendererJS library.
// Supports Cesium Ion OSM Buildings and Google Photorealistic 3D Tiles.

import {CNode} from "./CNode";
import {Globals, NodeMan, Sit} from "../Globals";
import {GlobalScene} from "../LocalFrame";
import {Group, Matrix4, Vector3} from "three";
import {RLLAToECEF} from "../LLA-ECEF-ENU";
import * as LAYER from "../LayerMasks";
import {TilesRenderer} from "3d-tiles-renderer";
import {CesiumIonAuthPlugin, GoogleCloudAuthPlugin} from "3d-tiles-renderer/plugins";

// Build a Matrix4 that transforms ECEF coordinates to EUS (East-Up-South) local frame.
// This is the matrix form of ECEFToEUS(), applied to the TilesRenderer group
// so all child tiles are automatically positioned in Sitrec's coordinate system.
function buildECEFToEUSMatrix4() {
    const lat = Sit.lat * Math.PI / 180;
    const lon = Sit.lon * Math.PI / 180;

    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);

    // ECEF→ENU rotation matrix (3x3):
    //   [ -sinLon,          cosLon,          0      ]
    //   [ -sinLat*cosLon,  -sinLat*sinLon,   cosLat ]
    //   [  cosLat*cosLon,   cosLat*sinLon,   sinLat ]
    //
    // Then ENU→EUS swap: EUS.x = ENU.x, EUS.y = ENU.z, EUS.z = -ENU.y
    // Combined ECEF→EUS rotation:
    //   Row 0 (EUS.x = ENU.x):  -sinLon,          cosLon,          0
    //   Row 1 (EUS.y = ENU.z):   cosLat*cosLon,    cosLat*sinLon,   sinLat
    //   Row 2 (EUS.z = -ENU.y):  sinLat*cosLon,    sinLat*sinLon,  -cosLat

    // Use WGS84 ellipsoid (not sphere) because the 3D tiles are in ellipsoid ECEF.
    // RLLAToECEFV_Sphere would place the origin ~7km too high at mid-latitudes,
    // causing tiles to render underground.
    const originECEF = RLLAToECEF(lat, lon, 0);

    // Build as a 4x4 matrix: rotation + translation
    // Three.js Matrix4 is column-major: .set(row-major args)
    const rotationMatrix = new Matrix4().set(
        -sinLon,        cosLon,         0,       0,
        cosLat*cosLon,  cosLat*sinLon,  sinLat,  0,
        sinLat*cosLon,  sinLat*sinLon, -cosLat,  0,
        0,              0,              0,       1
    );

    // First translate by -originECEF, then rotate
    const translationMatrix = new Matrix4().makeTranslation(
        -originECEF.x, -originECEF.y, -originECEF.z
    );

    // Combined: rotation * translation
    return rotationMatrix.multiply(translationMatrix);
}


export class CNodeBuildings3DTiles extends CNode {
    constructor(v) {
        super(v);

        this.source = v.source ?? "cesium-osm"; // "cesium-osm" or "google-photorealistic"
        this.cesiumIonToken = v.cesiumIonToken ?? null;
        this.googleApiKey = v.googleApiKey ?? null;

        this.group = new Group();
        this.group.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
        GlobalScene.add(this.group);

        this.tilesRenderer = null;
        this._initialized = false;

        this.updateWhilePaused = true;

        this.initTilesRenderer();
    }

    // Resolve which source to actually use: prefer the requested source,
    // but fall back to whatever has a valid API key configured.
    resolveSource() {
        if (this.source === "cesium-osm" && this.cesiumIonToken) return "cesium-osm";
        if (this.source === "google-photorealistic" && this.googleApiKey) return "google-photorealistic";
        // Requested source not available, try the other one
        if (this.googleApiKey) return "google-photorealistic";
        if (this.cesiumIonToken) return "cesium-osm";
        return null;
    }

    initTilesRenderer() {
        if (this.tilesRenderer) {
            this.disposeTilesRenderer();
        }

        const activeSource = this.resolveSource();
        if (!activeSource) {
            console.warn("CNodeBuildings3DTiles: No API keys configured. Buildings will not load.");
            return;
        }

        this.tilesRenderer = new TilesRenderer();

        if (activeSource === "cesium-osm") {
            this.tilesRenderer.registerPlugin(new CesiumIonAuthPlugin({
                apiToken: this.cesiumIonToken,
                assetId: 96188, // Cesium OSM Buildings
            }));
        } else if (activeSource === "google-photorealistic") {
            this.tilesRenderer.registerPlugin(new GoogleCloudAuthPlugin({
                apiToken: this.googleApiKey,
            }));
        }

        // Apply the ECEF→EUS transform so tiles appear in the correct local position
        const ecefToEUS = buildECEFToEUSMatrix4();
        this.tilesRenderer.group.applyMatrix4(ecefToEUS);

        this.group.add(this.tilesRenderer.group);
        this._initialized = true;
        this._activeSource = activeSource;

        console.log("CNodeBuildings3DTiles: Initialized with source=" + activeSource
            + (activeSource !== this.source ? " (requested " + this.source + ")" : ""));
    }

    disposeTilesRenderer() {
        if (this.tilesRenderer) {
            this.group.remove(this.tilesRenderer.group);
            this.tilesRenderer.dispose();
            this.tilesRenderer = null;
        }
        this._initialized = false;
    }

    // Switch between data sources at runtime
    setSource(source) {
        if (source === this.source) return;
        this.source = source;
        this.initTilesRenderer();
    }

    update(f) {
        super.update(f);

        if (!this._initialized || !this.tilesRenderer) return;

        // Get the main view's camera and renderer for LOD calculations
        const mainView = NodeMan.get("mainView");
        if (!mainView) return;

        const camera = mainView.camera;
        const renderer = mainView.renderer;
        if (!camera || !renderer) return;

        this.tilesRenderer.setCamera(camera);
        this.tilesRenderer.setResolutionFromRenderer(camera, renderer);
        this.tilesRenderer.update();
    }

    dispose() {
        this.disposeTilesRenderer();

        if (this.group) {
            GlobalScene.remove(this.group);
            this.group = null;
        }

        super.dispose();
    }
}
