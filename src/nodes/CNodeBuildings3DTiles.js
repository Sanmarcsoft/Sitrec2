// CNodeBuildings3DTiles.js
// Renders 3D building tiles using NASA's 3DTilesRendererJS library.
// Supports Cesium Ion OSM Buildings and Google Photorealistic 3D Tiles.
//
// Each visible 3D view gets its own TilesRenderer instance with independent
// LOD so that views with very different cameras (e.g. close-up mainView vs
// distant lookView) each load tiles at the appropriate resolution without
// competing for budget.

import {CNode} from "./CNode";
import {NodeMan} from "../Globals";
import {GlobalScene} from "../LocalFrame";
import {Group} from "three";
import * as LAYER from "../LayerMasks";
import {TilesRenderer} from "3d-tiles-renderer";
import {GLTFExtensionsPlugin, TilesFadePlugin} from "3d-tiles-renderer/plugins";
import {DRACOLoader} from "three/addons/loaders/DRACOLoader.js";
import {TilesDayNightPlugin} from "../TilesDayNightPlugin";
import {
    getSharedGooglePhotorealisticState,
    SharedGoogleCloudAuthPlugin,
    TrackedCesiumIonAuthPlugin,
} from "../GooglePhotorealisticTilesAuth";

function createDracoLoader() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("./libs/draco/");
    return dracoLoader;
}



// Per-view state: a TilesRenderer instance, its parent group, and the view it tracks.
class PerViewTiles {
    /**
     * @param {Group} parentGroup
     * @param {number} layerMask
     * @param {string} source
     * @param {string|null} cesiumIonToken
     * @param {string|null} googleApiKey
     * @param {Object|null} googleSharedState
     */
    constructor(parentGroup, layerMask, source, cesiumIonToken, googleApiKey, googleSharedState) {
        this.renderer = new TilesRenderer();
        // Monotonic counter used by export settling to detect LOD visibility churn.
        this.visibilityVersion = 0;
        // Timestamp retained for debugging/diagnostics when tracking transitions.
        this.lastVisibilityChangeAt = 0;

        this.dracoLoader = createDracoLoader();
        this.renderer.registerPlugin(new GLTFExtensionsPlugin({
            dracoLoader: this.dracoLoader,
        }));

        if (source === "cesium-osm") {
            this.renderer.registerPlugin(new TrackedCesiumIonAuthPlugin({
                apiToken: cesiumIonToken,
                assetId: 96188, // Cesium OSM Buildings
            }));
        } else if (source === "google-photorealistic") {
            this.renderer.registerPlugin(new SharedGoogleCloudAuthPlugin({
                apiToken: googleApiKey,
                sharedState: googleSharedState,
                autoRefreshToken: true,
            }));
        }

        this.renderer.registerPlugin(new TilesDayNightPlugin({source}));
        // Fade plugin smooths LOD transitions so parent/child tile swaps are less abrupt in exports.
        this.fadePlugin = new TilesFadePlugin({
            fadeDuration: 250,
            fadeRootTiles: true,
            // Keep high enough to avoid forced "pop" fallback when many tiles transition together.
            maximumFadeOutTiles: 400,
        });
        this.renderer.registerPlugin(this.fadePlugin);

        // Track every tile visibility state change so export settle logic can wait for transition quiescence.
        this._onTileVisibilityChange = () => {
            this.visibilityVersion++;
            this.lastVisibilityChangeAt = performance.now();
        };
        this.renderer.addEventListener("tile-visibility-change", this._onTileVisibilityChange);

        this.renderer.group.layers.mask = layerMask;

        // Set layer mask on all tile meshes as they load
        this.renderer.addEventListener('load-model', ({scene}) => {
            scene.traverse(child => {
                if (child.isMesh || child.isLine || child.isPoints) {
                    child.layers.mask = layerMask;
                }
            });
        });

        parentGroup.add(this.renderer.group);
    }

    update(view) {
        if (!view || !view.visible || !view.camera || !view.renderer) return;
        // Ensure the camera's world matrix is current — controllers may not
        // have run yet this frame depending on node update order.
        view.camera.updateMatrixWorld();
        this.renderer.setCamera(view.camera);
        this.renderer.setResolutionFromRenderer(view.camera, view.renderer);
        this.renderer.update();
    }

    /**
     * Dispose renderer resources and unregister listeners.
     * @param {Group} parentGroup
     */
    dispose(parentGroup) {
        parentGroup.remove(this.renderer.group);
        this.renderer.removeEventListener("tile-visibility-change", this._onTileVisibilityChange);
        this.renderer.dispose();
        if (this.dracoLoader && typeof this.dracoLoader.dispose === "function") {
            this.dracoLoader.dispose();
            this.dracoLoader = null;
        }
        this.fadePlugin = null;
        this._onTileVisibilityChange = null;
    }
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

        this._perView = {}; // keyed by view id
        this._initialized = false;

        this.updateWhilePaused = true;

        this.initTilesRenderers();
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

    initTilesRenderers() {
        this.disposeTilesRenderers();

        const activeSource = this.resolveSource();
        if (!activeSource) {
            console.warn("CNodeBuildings3DTiles: No API keys configured. Buildings will not load.");
            return;
        }

        // One TilesRenderer per view, each with its own LOD and layer mask.
        const viewConfigs = [
            {id: "mainView", mask: LAYER.MASK_MAIN},
            {id: "lookView", mask: LAYER.MASK_LOOK},
        ];
        const googleSharedState = activeSource === "google-photorealistic"
            ? getSharedGooglePhotorealisticState(this.googleApiKey)
            : null;

        for (const {id, mask} of viewConfigs) {
            this._perView[id] = new PerViewTiles(
                this.group, mask, activeSource,
                this.cesiumIonToken, this.googleApiKey, googleSharedState
            );
        }

        this._initialized = true;
        this._activeSource = activeSource;

        console.log("CNodeBuildings3DTiles: Initialized with source=" + activeSource
            + (activeSource !== this.source ? " (requested " + this.source + ")" : ""));
    }

    disposeTilesRenderers() {
        for (const pv of Object.values(this._perView)) {
            pv.dispose(this.group);
        }
        this._perView = {};
        this._initialized = false;
    }

    // Switch between data sources at runtime
    setSource(source) {
        if (source === this.source) return;
        this.source = source;
        this.initTilesRenderers();
    }

    update(f) {
        super.update(f);

        if (!this._initialized) return;

        for (const [viewId, pv] of Object.entries(this._perView)) {
            const view = NodeMan.get(viewId, false);
            pv.update(view);
        }
    }

    /**
     * Return per-view loading/transition state for export frame settling.
     *
     * "Pending" includes both network/parse queue activity and fade transitions.
     * Visibility version fields are provided so callers can detect LOD churn even
     * when queue counters are zero.
     *
     * @param {string[]|null} viewIds - Optional view filter.
     * @returns {{hasPending: boolean, perView: Object<string, Object>}}
     */
    getPendingLoadState(viewIds = null) {
        const filter = Array.isArray(viewIds) && viewIds.length > 0 ? new Set(viewIds) : null;
        const perView = {};
        let hasPending = false;

        for (const [viewId, pv] of Object.entries(this._perView)) {
            if (filter && !filter.has(viewId)) continue;

            const renderer = pv?.renderer;
            if (!renderer) continue;

            const stats = renderer.stats || {};
            const queued = stats.queued || 0;
            const downloading = stats.downloading || 0;
            const parsing = stats.parsing || 0;
            const isLoading = !!renderer.isLoading;
            const fadingTiles = pv.fadePlugin?.fadingTiles || 0;
            const pending = isLoading || queued > 0 || downloading > 0 || parsing > 0 || fadingTiles > 0;

            if (pending) hasPending = true;
            perView[viewId] = {
                queued,
                downloading,
                parsing,
                isLoading,
                fadingTiles,
                visibilityVersion: pv.visibilityVersion || 0,
                lastVisibilityChangeAt: pv.lastVisibilityChangeAt || 0,
            };
        }

        return {hasPending, perView};
    }

    /**
     * Convenience boolean wrapper over getPendingLoadState().
     * @param {string[]|null} viewIds
     * @returns {boolean}
     */
    hasPendingLoads(viewIds = null) {
        return this.getPendingLoadState(viewIds).hasPending;
    }

    dispose() {
        this.disposeTilesRenderers();

        if (this.group) {
            GlobalScene.remove(this.group);
            this.group = null;
        }

        super.dispose();
    }
}
