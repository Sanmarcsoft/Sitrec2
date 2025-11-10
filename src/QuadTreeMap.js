import {wgs84} from "./LLA-ECEF-ENU";
import {Matrix4} from "three/src/math/Matrix4";
import {Frustum} from "three/src/math/Frustum";
import {Vector3} from "three/src/math/Vector3";
import {debugLog, Globals} from "./Globals";
import {isLocal} from "./configUtils";
import {altitudeAboveSphere, distanceToHorizon, hiddenByGlobe} from "./SphericalMath";
import * as LAYER from "./LayerMasks";
import {assert} from "./assert";

// Reusable Vector3 objects to avoid garbage collection pressure
// These are reused across all tile visibility calculations
const _cameraForward = new Vector3();
const _toSphere = new Vector3();
const _cameraPositionClone = new Vector3();

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// QuadTreeMap is the base class of a QuadTreeMapTexture and a QuadTreeMapElevation
export class QuadTreeMap {
    constructor(terrainNode, geoLocation, options) {
        this.options = this.getOptions(options)
        this.nTiles = this.options.nTiles
        this.zoom = this.options.zoom
        this.tileSize = this.options.tileSize
        this.radius = wgs84.RADIUS; // force this
        this.loadedCallback = options.loadedCallback; // function to call when map is all loaded
        this.loaded = false; // mick flag to indicate loading is finished
        this.tileCache = {};
        this.terrainNode = terrainNode
        this.geoLocation = geoLocation
        this.dynamic = options.dynamic || false; // if true, we use a dynamic tile grid
        this.maxZoom = options.maxZoom ?? 15; // default max zoom level
        this.minZoom = options.minZoom ?? 0; // default min zoom level
        this.lastLoggedStats = new Map(); // Track last logged stats per view to reduce console spam
        this.inactiveTileTimeout = 100000; // Time in ms before pruning inactive tiles (100 seconds)
        this.currentStats = new Map(); // Store current stats per view for debug display
        this.parentTiles = new Set(); // Track tiles that have children for efficient iteration

    }

    // Helper methods for nested cache access
    getTile(x, y, z) {
        return this.tileCache[z] && this.tileCache[z][x] && this.tileCache[z][x][y];
    }

    setTile(x, y, z, tile) {
        if (!this.tileCache[z]) this.tileCache[z] = {};
        if (!this.tileCache[z][x]) this.tileCache[z][x] = {};
        this.tileCache[z][x][y] = tile;
    }

    deleteTile(x, y, z) {
        if (this.tileCache[z] && this.tileCache[z][x] && this.tileCache[z][x][y]) {
            const tile = this.tileCache[z][x][y];
            
            // Clean up tree structure: remove from parent's children array
            if (tile.parent && tile.parent.children) {
                const index = tile.parent.children.indexOf(tile);
                if (index !== -1) {
                    tile.parent.children[index] = null;
                }
                // If all children are null, clear the children array
                if (tile.parent.children.every(child => child === null)) {
                    tile.parent.children = null;
                    // Parent no longer has children, remove from parent tracking set
                    this.parentTiles.delete(tile.parent);
                }
            }
            
            // Clean up tree structure: clear children references
            if (tile.children) {
                tile.children.forEach(child => {
                    if (child) child.parent = null;
                });
                tile.children = null;
                // This tile no longer has children, remove from parent tracking set
                this.parentTiles.delete(tile);
            }
            tile.parent = null;
            
            delete this.tileCache[z][x][y];
            // Clean up empty objects to prevent memory leaks
            if (Object.keys(this.tileCache[z][x]).length === 0) {
                delete this.tileCache[z][x];
                if (Object.keys(this.tileCache[z]).length === 0) {
                    delete this.tileCache[z];
                }
            }
        }
    }

    // Helper to get all tiles (for Object.values() replacement)
    getAllTiles() {
        const tiles = [];
        for (const z in this.tileCache) {
            for (const x in this.tileCache[z]) {
                for (const y in this.tileCache[z][x]) {
                    tiles.push(this.tileCache[z][x][y]);
                }
            }
        }
        return tiles;
    }

    // Helper to get tile count (more efficient than getAllTileKeys().length)
    getTileCount() {
        let count = 0;
        for (const z in this.tileCache) {
            for (const x in this.tileCache[z]) {
                count += Object.keys(this.tileCache[z][x]).length;
            }
        }
        return count;
    }

    // Helper to get all tile keys (for Object.keys() replacement)
    getAllTileKeys() {
        const keys = [];
        for (const z in this.tileCache) {
            for (const x in this.tileCache[z]) {
                for (const y in this.tileCache[z][x]) {
                    keys.push(`${z}/${x}/${y}`);
                }
            }
        }
        return keys;
    }

    // Helper to iterate over all tiles
    forEachTile(callback) {
        for (const z in this.tileCache) {
            for (const x in this.tileCache[z]) {
                for (const y in this.tileCache[z][x]) {
                    callback(this.tileCache[z][x][y]);
                }
            }
        }
    }

    // // iterate over the tile by traversing the tree starting at 0,0,0
    // forEachTile(callback) {
    //     const root = this.tileCache[0]?.[0]?.[0]; // Start at the root tile (0,0,0)
    //     this.forEachTileRecurse(root, callback);
    // }
    //
    // forEachTileRecurse(node, callback) {
    //     callback(node); // Call the callback for the current node
    //     if (node.children) {
    //         for (let i = 0; i < 4; i++) {
    //             this.forEachTileRecurse(node.children[i], callback);
    //         }
    //     }
    // }


    /**
     * Get the effective maximum zoom level considering both maxZoom and maxDetails settings
     * @returns {number} The effective max zoom level
     */
    getEffectiveMaxZoom() {
        // If maxDetails is set in Globals.settings, use it as an additional limit
        if (Globals.settings && typeof Globals.settings.maxDetails === 'number') {
            return Math.min(this.maxZoom, Globals.settings.maxDetails);
        }
        return this.maxZoom;
    }

    initTiles() {
        if (this.dynamic) {
            this.initTilePositionsDynamic()
         } else {
             this.initTilePositions()
         }
    }

    refreshDebugGeometry(tile) {
        if (this.terrainNode.UI.debugElevationGrid) {
            tile.buildDebugGeometry(this.debugColor, this.debugAltitude)
        }
    }

    refreshDebugGrid(color, altitude = 0) {
        this.getAllTiles().forEach(tile => {
            this.debugColor = color
            this.debugAltitude = altitude
            tile.buildDebugGeometry(this.debugColor, this.debugAltitude)
        })
    }

    removeDebugGrid() {
        this.getAllTiles().forEach(tile => {
            tile.removeDebugGeometry()
        })
    }

    getOptions(providedOptions) {
        const options = Object.assign({}, providedOptions)
        options.tileSegments = Math.min(256, Math.round(options.tileSegments))
        return options
    }

    initTilePositions() {
        this.center = this.options.mapProjection.geo2Tile(this.geoLocation, this.zoom)
        const tileOffset = Math.floor(this.nTiles / 2)
        this.controller = new AbortController();
        for (let i = 0; i < this.nTiles; i++) {
            for (let j = 0; j < this.nTiles; j++) {
                const x = this.center.x + i - tileOffset;
                const y = this.center.y + j - tileOffset;
                // only add tiles that are within the bounds of the map
                // we allow the x values out of range
                // because longitude wraps around
                if (y > 0 && y < Math.pow(2, this.zoom)) {
                    // For initialization, use default mask that includes both main and look views
                    this.activateTile(x, y, this.zoom, LAYER.MASK_MAIN | LAYER.MASK_LOOK) // activate the tile
                }
            }
        }
    }


// dynamic setup just uses 1x1 tile, at 0,0 at zoom 0
    initTilePositionsDynamic(deferLoad = false) {
        this.center = this.options.mapProjection.geo2Tile(this.geoLocation, this.zoom)
        this.controller = new AbortController();

        this.zoom = 0;

        for (let i = 0; i < 1; i++) {
            for (let j = 0; j < 1; j++) {
                // For initialization, use default mask that includes both main and look views
                this.activateTile(i, j, this.zoom, LAYER.MASK_MAIN | LAYER.MASK_LOOK) // activate the tile
            }
        }
    }


    /**
     * Perform view-independent tile management operations
     * This should be called once per frame before processing individual views
     * 
     * Operations performed:
     * - Cleanup inactive tiles (cancel pending loads)
     * - Remove inactive tiles from scene
     * - Prune complete sets of inactive tiles
     * 
     * OPTIMIZATION: Combines all three operations into a single forEachTile() iteration
     * to reduce overhead from 3 iterations to 1 (67% reduction in tile iterations)
     */
    subdivideTilesGeneral() {
        // Skip subdivision for flat elevation maps
        if (this.constructor.name === 'QuadTreeMapElevation' && this.options.elevationType === "Flat") {
            return;
        }

        const now = Date.now();
        let prunedCount = 0;
        
        // Collect tiles to prune (can't delete during iteration)
        const tilesToPrune = [];

        // COMBINED PASS: Process all tiles in a single iteration
        this.forEachTile((tile) => {
            // OPERATION 1: Cleanup inactive tiles - cancel pending loads
            if (!tile.tileLayers && (tile.isLoading || tile.isLoadingElevation)) {
                tile.cancelPendingLoads();
            }

            // OPERATION 2: Remove inactive tiles from scene
            if (tile.added && !tile.tileLayers && tile.mesh) {
                const children = this.getChildren(tile);
                if (children) {
                    const allChildrenLoaded = children.every(child => child && child.loaded);
                    if (allChildrenLoaded) {
                        this.scene.remove(tile.mesh);
                        if (tile.skirtMesh) {
                            this.scene.remove(tile.skirtMesh);
                        }
                        tile.added = false;

                        // Reset lazy loading flags when tile is removed from scene
                        if (tile.usingParentData) {
                            tile.needsHighResLoad = false;
                        }

                        this.refreshDebugGeometry(tile);
                    }
                }

                assert(this.areaIsCovered(tile), "Tile removed but area is not covered!");

            }

            // OPERATION 3: Identify tiles to prune (collect for deletion after iteration)
            const children = this.getChildren(tile);
            if (children) {
                // Check if all four children meet pruning criteria
                const allChildrenPrunable = children.every(child => {
                    if (child.tileLayers !== 0) return false; // Still active
                    if (this.hasChildren(child)) return false; // Has children
                    if (!child.inactiveSince) return false; // No timestamp
                    if (now - child.inactiveSince < this.inactiveTileTimeout) return false; // Not old enough
                    return true;
                });
                
                if (allChildrenPrunable) {
                    // Collect children for pruning (delete after iteration completes)
                    tilesToPrune.push(...children);
                }
            }
        });

        // Prune collected tiles after iteration completes (safe to delete now)
        tilesToPrune.forEach(child => {
            // Clean up the tile
            if (child.mesh) {
                this.scene.remove(child.mesh);
                if (child.mesh.geometry) child.mesh.geometry.dispose();
                if (child.mesh.material) {
                    if (child.mesh.material.map) child.mesh.material.map.dispose();
                    child.mesh.material.dispose();
                }
            }
            if (child.skirtMesh) {
                this.scene.remove(child.skirtMesh);
                if (child.skirtMesh.geometry) child.skirtMesh.geometry.dispose();
                if (child.skirtMesh.material) child.skirtMesh.material.dispose();
            }
            
            // Cancel any pending loads
            child.cancelPendingLoads();
            
            // Remove from cache
            this.deleteTile(child.x, child.y, child.z);
            prunedCount++;
        });
        
        if (prunedCount > 0 && isLocal) {
            debugLog(`Pruned ${prunedCount} inactive tiles (${prunedCount / 4} sets of 4)`);
        }
    }

    /**
     * Subdivide or merge tiles based on view visibility and screen size
     * 
     * This method is called every frame from the update loop and manages the quadtree
     * structure by subdividing tiles that are too large on screen and merging tiles
     * that are too small.
     * 
     * LAZY LOADING & RACE CONDITION FIX:
     * For texture maps, this method implements deferred subdivision to fix a race condition
     * where child tiles would be created before parent textures finished loading. The fix:
     * 
     * 1. When a tile needs subdivision, check if parent is still loading (tile.isLoading)
     * 2. If loading, defer subdivision by returning early (retry next frame)
     * 3. Track deferred frames to implement a 60-frame timeout (~1 second)
     * 4. Once parent loads, subdivision proceeds and children can use parent texture data
     * 5. This ensures consistent lazy loading behavior regardless of page load speed
     * 
     * The deferred subdivision approach works because this method runs every frame,
     * so deferring just means "try again next frame when parent might be ready".
     * 
     * @param {Object} view - The view containing camera and viewport info
     * @param {number} subdivideSize - Screen size threshold for subdivision (default: 2000)
     */
    subdivideTilesViewSpecific(view, subdivideSize = 2000) {
        // Skip subdivision for flat elevation maps
        if (this.constructor.name === 'QuadTreeMapElevation' && this.options.elevationType === "Flat") {
            return;
        }

        // debug code - check for holes in the map
        // the root tile covers the whole world, so if it's not active, then check if it's covered by the descendants
        if (isLocal) {
            if (this.constructor.name === 'QuadTreeMapTexture') {
                const rootTile = this.getTile(0, 0, 0);

                if (!(rootTile.mesh.layers.mask & view.tileLayers)) {
                    if (!this.areaCoveredByDescendants(rootTile, view.tileLayers)) {
                        this.dumpChildren(rootTile);
                        console.log(this.areaCoveredByDescendants(rootTile, view.tileLayers));
                        // root tile is not active in this view - so check area coverage
                        assert(0, "Root tile area is not covered!");
                    }
                }
            }
        }

        const camera = view.cameraNode.camera;
        const tileLayers = view.tileLayers;
        const isTextureMap = this.constructor.name === 'QuadTreeMapTexture';

        // Setup camera frustum for visibility checks
        camera.updateMatrixWorld();
        const frustum = new Frustum();
        frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        ));
        camera.viewFrustum = frustum;

        // PASS 1: Debug logging (view-specific)
        if (Globals.showTileStats) {
           this.logDebugStats(tileLayers, view.id);
        } else {
            // Clear stats when flag is disabled
            this.currentStats.clear();
        }

        // PASS 2: Deactivate parent tiles whose children are fully loaded (texture maps only, view-specific)
        if (isTextureMap) {
            this.deactivateParentsWithLoadedChildren(tileLayers);
        }

        // PASS 3: Process each tile for subdivision/merging and lazy loading
        this.forEachTile((tile) => {
            if (!this.canSubdivide(tile)) return;

            const hasChildren = this.hasChildren(tile);
            
            // Skip inactive tiles without children
            if (!tile.tileLayers && !hasChildren) return;

            // OPTIMIZATION #7: Early exit for tiles not active in this view
            // Only process tiles that are either:
            // 1. Active in this view (for subdivision/lazy loading), OR
            // 2. Have children (for potential merging)
            const isActiveInView = (tile.tileLayers & tileLayers) !== 0;
            if (!isActiveInView && !hasChildren) return;

            // Calculate visibility and screen size
            // This is expensive, so we only do it after early exit checks
            const visibility = this.calculateTileVisibility(tile, camera);
            
            // OPTIMIZATION #7: Early exit for invisible tiles without children
            // If tile is not visible and has no children to merge, skip further processing
            if (!visibility.visible && !hasChildren) return;
            
            // Handle lazy loading for visible tiles using parent data
            if (isTextureMap && visibility.actuallyVisible) {
                this.triggerLazyLoadIfNeeded(tile, tileLayers);
            }

            // Determine if subdivision is needed
            const shouldSubdivide = this.shouldSubdivideTile(tile, visibility, subdivideSize);

            if (shouldSubdivide && isActiveInView && tile.z < this.maxZoom) {
                // RACE CONDITION FIX: Defer subdivision while parent tile is loading
                // 
                // Problem: On page reload (with cached resources), parent tiles are created and
                // immediately start loading textures asynchronously. If subdivideTiles() runs
                // before the parent texture finishes loading, child tiles can't extract parent
                // data and fall back to normal loading (0 lazy tiles).
                //
                // Solution: Wait for parent tile to finish loading before subdividing. This gives
                // child tiles access to the parent's loaded texture for lazy loading.
                //
                // Safety: Don't wait forever - after 60 frames (~1 second at 60fps), subdivide
                // anyway to prevent blocking the UI if a tile load is slow or fails.
                if (isTextureMap && tile.isLoading) {
                    // Track how many frames we've deferred subdivision
                    if (!tile.subdivisionDeferredFrames) {
                        tile.subdivisionDeferredFrames = 0;
                    }
                    tile.subdivisionDeferredFrames++;
                    
                    // Timeout: If we've waited 60 frames, proceed anyway
                    // Most texture loads complete in 1-10 frames, so this is a safety net
                    if (tile.subdivisionDeferredFrames < 60) {
                        return; // Defer subdivision until next frame (when parent may be loaded)
                    }
                    // Fall through: subdivide without parent data after timeout
                    // Child tiles will load normally, can still be upgraded later via triggerLazyLoadIfNeeded()
                }
                
                // Reset the deferred frames counter when we actually subdivide
                tile.subdivisionDeferredFrames = 0;
                
                this.subdivideTile(tile, tileLayers, isTextureMap);
                return; // Process one subdivision at a time
            }

            // Check for merging children back to parent
            if (!shouldSubdivide && hasChildren) {
                this.mergeChildrenIfPossible(tile, tileLayers);
            }
        });
    }

    /**
     * Log debug statistics about tile states
     */
    logDebugStats(tileLayers, viewId) {
        let totalTileCount = this.getTileCount();
        let pendingLoads = 0;
        let lazyLoading = 0;
        let activeTileCount = 0;
        let inactiveTileCount = 0;

        this.forEachTile((tile) => {
            if (tile.tileLayers && (tile.tileLayers & tileLayers)) {
                activeTileCount++;
            } else {
                inactiveTileCount++;
            }
            if (tile.isLoading) pendingLoads++;
            // Count active tiles using parent data (whether load is pending or not)
            if (tile.usingParentData && (tile.tileLayers & tileLayers)) {
                lazyLoading++;
            }
        });

        // Store current stats for debug display
        const viewKey = viewId || 'View';
        const currentStats = { totalTileCount, activeTileCount, inactiveTileCount, pendingLoads, lazyLoading };
        this.currentStats.set(viewKey, currentStats);
        
        // Only log if counts changed from last time
        if (pendingLoads > 0 || lazyLoading > 0) {
            const lastStats = this.lastLoggedStats.get(viewKey);
            
            // Check if any value changed
            if (!lastStats || 
                lastStats.totalTileCount !== totalTileCount ||
                lastStats.activeTileCount !== activeTileCount ||
                lastStats.inactiveTileCount !== inactiveTileCount ||
                lastStats.pendingLoads !== pendingLoads ||
                lastStats.lazyLoading !== lazyLoading) {
                
                debugLog(`[${viewKey}] Total: ${totalTileCount}, Active: ${activeTileCount}, Inactive: ${inactiveTileCount}, Pending: ${pendingLoads}, Lazy: ${lazyLoading}`);
                this.lastLoggedStats.set(viewKey, currentStats);
            }
        }
    }

    /**
     * Deactivate parent tiles when their descendants cover the parent's area.
     * OPTIMIZATION: Only iterates over tiles that have children (tracked in parentTiles Set)
     * instead of all tiles. With 100 tiles, typically only 10-25 are parents (75-90% reduction).
     */
    deactivateParentsWithLoadedChildren(tileLayers) {
        // Iterate only over parent tiles (tiles that have children)
        // This is much more efficient than iterating all tiles
        this.parentTiles.forEach((tile) => {
            if (tile.z >= this.maxZoom) return;
            if (tile.isLoading) return;

            const allChildrenReady = this.areaCoveredByDescendants(tile, tileLayers)
            
            if (allChildrenReady) {
                this.deactivateTile(tile, tileLayers, true);
            }
        });
    }

    /**
     * Calculate visibility and screen size for a tile
     */
    calculateTileVisibility(tile, camera) {
        const worldSphere = tile.getWorldSphere();
        let screenSize = 0;
        let visible = false;
        let actuallyVisible = false;

        // Check frustum intersection
        const frustumIntersects = camera.viewFrustum.intersectsSphere(worldSphere);
        
        if (frustumIntersects) {
            const radius = worldSphere.radius;
            const distance = camera.position.distanceTo(worldSphere.center);
            
            // Check if sphere center is behind the camera FIRST
            // Project sphere center onto camera's forward direction
            const cameraForward = camera.getWorldDirection(_cameraForward);
            const toSphere = _toSphere.copy(worldSphere.center).sub(camera.position);
            const projectionOnForward = toSphere.dot(cameraForward);
            
            // If center is behind camera (negative projection) but frustum intersects,
            // the tile wraps around the camera - skip horizon checks and force subdivision
            if (projectionOnForward < 0) {
                screenSize = 1000000; // Force subdivision for tiles wrapping around camera
                visible = true;
                // Don't mark as actuallyVisible - this prevents premature lazy loading
                // The visible parts (children) will be actuallyVisible when their centers are in front
                actuallyVisible = false;
            } else {
                // Normal case: center is in front of camera
                // Now perform horizon and globe occlusion checks
                const cameraAltitude = altitudeAboveSphere(_cameraPositionClone.copy(camera.position));
                const closestDistance = Math.max(0, distance - radius);
                const horizon = distanceToHorizon(cameraAltitude);

                // Check if visible over horizon
                if (horizon > closestDistance || 
                    hiddenByGlobe(cameraAltitude, closestDistance) <= tile.highestAltitude) {
                    
                    const fov = camera.getEffectiveFOV() * Math.PI / 180;
                    const height = 2 * Math.tan(fov / 2) * distance;
                    const screenFraction = (2 * radius) / height;
                    screenSize = screenFraction * 1024;
                    visible = true;
                    actuallyVisible = true;
                }
            }
        }

        // Force subdivision for first 3 zoom levels
        if (tile.z < 3) {
            screenSize = 10000000000;
            visible = true;
            // actuallyVisible remains unchanged - used for lazy loading
        }

        return { 
            screenSize, 
            visible, 
            actuallyVisible, 
            frustumIntersects 
        };
    }

    /**
     * Trigger lazy loading for tiles using parent data
     * This is called only for tiles that are actuallyVisible (not forced visible for subdivision)
     */
    triggerLazyLoadIfNeeded(tile, tileLayers) {
        // Only load if tile is using parent data, needs high-res, not currently loading, and active in this view
        const needsLoad = tile.usingParentData && 
                         tile.needsHighResLoad &&
                         !tile.isLoading && 
                         !tile.isCancelling &&
                         (tile.tileLayers & tileLayers);

        // Trigger high-res load if all conditions are met
        if (needsLoad) {
            tile.needsHighResLoad = false; // Clear flag to prevent repeated triggers
            const key = `${tile.z}/${tile.x}/${tile.y}`;

            const materialPromise = tile.applyMaterial().then(() => {
                tile.usingParentData = false; // Mark as using high-res data now
            }).catch(error => {
                // Reset flag to retry - whether it's an abort or real error
                tile.needsHighResLoad = true;
            });
            
            this.trackTileLoading(`${key}-highres`, materialPromise);
        }
    }

    /**
     * Determine if a tile should be subdivided
     */
    shouldSubdivideTile(tile, visibility, subdivideSize) {
        // Don't subdivide if we're at or beyond the effective max zoom
        const effectiveMaxZoom = this.getEffectiveMaxZoom();
        if (tile.z >= effectiveMaxZoom) {
            return false;
        }
        
        return visibility.visible && visibility.screenSize > subdivideSize;
    }

    /**
     * Subdivide a tile into 4 children
     */
    subdivideTile(tile, tileLayers, isTextureMap) {
        // Check if parent tile has usable texture data for lazy loading
        // We need:
        // 1. A mesh with material (tile is initialized)
        // 2. A texture map (material.map exists)
        // 3. Not a wireframe material (actual texture is loaded, not placeholder)
        //
        // This check ensures we only use parent data when the texture has actually loaded.
        // During loading, tiles have a wireframe material, so this check will be false.
        // After the deferred subdivision logic above, this should be true (parent loaded).
        const useParentData = isTextureMap && tile.mesh && tile.mesh.material && 
                             tile.mesh.material.map && !tile.mesh.material.wireframe;
        
        // Create 4 child tiles (standard quadtree subdivision)
        // note activateTile will set the parent tile automatically
        const child1 = this.activateTile(tile.x * 2, tile.y * 2, tile.z + 1, tileLayers, useParentData);
        const child2 = this.activateTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1, tileLayers, useParentData);
        const child3 = this.activateTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1, tileLayers, useParentData);
        const child4 = this.activateTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1, tileLayers, useParentData);

        tile.children = [child1, child2, child3, child4];
        // Track this tile as a parent for efficient iteration
        this.parentTiles.add(tile);

        // For texture maps: Deactivate parent if all children are loaded and added
        // (even if using parent data - that's valid for display, just lower quality)
        if (isTextureMap) {
            if (this.areaCoveredByDescendants(tile, tileLayers)) {
                this.deactivateTile(tile, tileLayers, true); // instant=true to hide parent immediately
            }
            // Otherwise parent stays active until children are ready
            // (deactivateParentsWithLoadedChildren will handle it on next frame)
        } else {
            // Elevation maps: always deactivate parent immediately
            this.deactivateTile(tile, tileLayers);
        }
    }

    /**
     * Merge children back to parent if they're all active in this view
     */
    mergeChildrenIfPossible(tile, tileLayers) {

        // THIS NEEDS TO CONSIDER ALL THE DESCENDANTS, NOT JUST THE IMMEDIATE CHILDREN
        // AND DEACTIVE THEM ALL
        // also fixe where it's not finding any elevation data!!!!!


        const children = this.getChildren(tile);
        if (!children) return;

        const allChildrenActiveInView = children.every(child =>
            child && (child.tileLayers & tileLayers)
        );

        if (allChildrenActiveInView) {
            this.activateTile(tile.x, tile.y, tile.z, tileLayers);
            children.forEach(child => {
                if (child) {
                    this.deactivateBranch(child, tileLayers, true);
                }
            });
        }
    }

    deactivateBranch(tile, layerMask = 0, instant = false) {
        // deactivate this tile
        this.deactivateTile(tile, layerMask, instant);
        if (tile.children) {
            // recursively deactivate children
            for (let child of tile.children) {
                this.deactivateBranch(child, layerMask, instant);
            }
        }
    }

    /**
     * Check if tile has children
     * All tiles have either 0 or 4 children, so we can simply check if children array is null
     */
    hasChildren(tile) {
        return tile.children !== null;
    }

    /**
     * Get all 4 children of a tile (returns null if any are missing)
     */
    getChildren(tile) {
        return tile.children;
    }
    
    /**
     * Get the parent of a tile
     * If tile.parent is already set, return it (fast path)
     * Otherwise, calculate parent coordinates and look it up in the cache
     */
    getParent(tile) {
        // Fast path: if parent is already set in tree structure, return it
        if (tile.parent) {
            return tile.parent;
        }
        
        // Fallback: calculate parent coordinates and look it up
        // This is needed when setting up the tree structure for newly created tiles
        if (tile.z === 0) {
            return null; // Root tile has no parent
        }
        
        const parentX = Math.floor(tile.x / 2);
        const parentY = Math.floor(tile.y / 2);
        const parentZ = tile.z - 1;
        return this.getTile(parentX, parentY, parentZ);
    }

    // Set the layer mask on a tile's mesh objects
    setTileLayerMask(tile, layerMask) {
        if (tile.mesh) {
            tile.mesh.layers.disableAll();
            tile.mesh.layers.mask = layerMask;
        }
        if (tile.skirtMesh) {
            tile.skirtMesh.layers.disableAll();
            tile.skirtMesh.layers.mask = layerMask;
        }
    }


}




