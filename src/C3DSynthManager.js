// Manager for Synthetic 3D Objects (buildings, structures, etc.)
// Handles creation, editing, deletion, and persistence

import {CManager} from "./CManager";
import {CNodeSynthBuilding} from "./nodes/CNodeSynthBuilding";
import {CNodeSynthClouds} from "./nodes/CNodeSynthClouds";
import {Globals, NodeMan, setRenderOne} from "./Globals";
import {ViewMan} from "./CViewManager";
import {makeMouseRay} from "./mouseMoveView";
import {V3} from "./threeUtils";
import {getLocalUpVector} from "./SphericalMath";
import {Sphere, Vector3} from "three";
import {EUSToLLA, wgs84} from "./LLA-ECEF-ENU";
import {f2m} from "./utils";

export class C3DSynthManager extends CManager {
    constructor() {
        super();
        this.nextBuildingID = 1;
        this.nextCloudsID = 1;
        this.cloudsList = {};
        
        console.log("C3DSynthManager initialized");
    }
    
    /**
     * Add a new building
     */
    addBuilding(buildingData) {
        const id = buildingData.id || `synthBuilding_${this.nextBuildingID++}`;
        const building = new CNodeSynthBuilding({
            ...buildingData,
            id: id
        });
        
        // Note: CNodeSynthBuilding extends CNode, which automatically adds itself to NodeMan in its constructor
        
        // Add to manager using inherited CManager.add() method
        this.add(id, building);
        console.log(`Added building: ${id}`);
        setRenderOne(true);
        return building;
    }
    
    /**
     * Remove a building
     */
    removeBuilding(buildingID) {
        if (this.exists(buildingID)) {
            const building = this.get(buildingID);
            
            // First, exit edit mode if this building is being edited
            // This will clean up control points, handles, menu, and Globals.editingBuilding
            if (building.editMode || Globals.editingBuilding === building) {
                console.log(`  Exiting edit mode for building ${buildingID} before removal`);
                building.setEditMode(false);
            }
            
            // Use NodeMan.disposeRemove which handles both disposal and removal from NodeMan
            NodeMan.disposeRemove(building);
            
            // Remove from this manager using inherited method
            this.remove(buildingID);
            
            console.log(`Removed building: ${buildingID}`);
            setRenderOne(true);
        }
    }
    
    /**
     * Get a building by ID
     */
    getBuilding(buildingID) {
        return this.exists(buildingID) ? this.get(buildingID) : undefined;
    }
    
    /**
     * Create a 15x15x4 meter building centered at the given point
     * @param {Vector3} centerPoint - The center point on the ground (in EUS coordinates)
     * @returns {CNodeSynthBuilding} The created building
     */
    createBuildingAtPoint(centerPoint) {
        if (Globals.editingBuilding) {
            alert("Please exit edit mode before creating a new building");
            return null;
        }
        
        // Get local coordinate system at the center point
        const localUp = getLocalUpVector(centerPoint);
        
        // Create local north and east directions
        // East is perpendicular to up and points roughly eastward
        const east = new Vector3(1, 0, 0).cross(localUp).normalize();
        const north = new Vector3().crossVectors(localUp, east).normalize();
        
        // Apply saved rotation from last building (if any)
        const savedRotation = Globals.settings?.lastBuildingRotation || 0;
        if (savedRotation !== 0) {
            // Rotate the north and east vectors by the saved rotation
            // Note: Negated to match Three.js applyAxisAngle convention
            const angle = -savedRotation;
            const rotatedNorth = north.clone().multiplyScalar(Math.cos(angle))
                                     .add(east.clone().multiplyScalar(Math.sin(angle)));
            const rotatedEast = east.clone().multiplyScalar(Math.cos(angle))
                                    .sub(north.clone().multiplyScalar(Math.sin(angle)));
            
            north.copy(rotatedNorth.normalize());
            east.copy(rotatedEast.normalize());
            
            console.log(`Applied saved rotation to new building: ${(savedRotation * 180 / Math.PI).toFixed(1)}°`);
        }
        
        // Create a 15x15 meter footprint centered at the point
        const halfSize = 7.5; // Half of 15 meters
        const corners = [
            centerPoint.clone().add(north.clone().multiplyScalar(-halfSize))
                                .add(east.clone().multiplyScalar(-halfSize)),
            centerPoint.clone().add(north.clone().multiplyScalar(halfSize))
                                .add(east.clone().multiplyScalar(-halfSize)),
            centerPoint.clone().add(north.clone().multiplyScalar(halfSize))
                                .add(east.clone().multiplyScalar(halfSize)),
            centerPoint.clone().add(north.clone().multiplyScalar(-halfSize))
                                .add(east.clone().multiplyScalar(halfSize))
        ];
        
        // Create building with 4 meter height
        const building = this.addBuilding({
            footprint: corners,
            height: 4,
            name: `Building ${this.nextBuildingID}`
        });
        
        console.log(`Created building: ${building.buildingID} at center point`);
        return building;
    }
    
    /**
     * Get ground intersection point from mouse position
     */
    getGroundPoint(view, mouseX, mouseY) {
        const mouseYUp = view.heightPx - (mouseY - view.topPx);
        const mouseRay = makeMouseRay(view, mouseX, mouseYUp);
        
        view.raycaster.setFromCamera(mouseRay, view.camera);
        
        // Try to intersect with terrain first
        let closestPoint = V3();
        let found = false;
        
        if (NodeMan.exists("TerrainModel")) {
            const terrainNode = NodeMan.get("TerrainModel");
            const firstIntersect = terrainNode.getClosestIntersect(view.raycaster);
            if (firstIntersect) {
                closestPoint.copy(firstIntersect.point);
                found = true;
            }
        }
        
        // If terrain intersection found, return it
        if (found) {
            return closestPoint.clone();
        }
        
        // Fallback: intersect with spherical ground
        const groundSphere = new Sphere(new Vector3(0, -wgs84.RADIUS, 0), wgs84.RADIUS);
        const intersectPoint = new Vector3();
        
        if (view.raycaster.ray.intersectSphere(groundSphere, intersectPoint)) {
            return intersectPoint;
        }
        
        return null;
    }
    
    /**
     * Check if mouse is over a building (for context menu)
     */
    getBuildingAtMouse(mouseX, mouseY) {
        const view = ViewMan.get("mainView");
        if (!view) return null;
        
        const mouseYUp = view.heightPx - (mouseY - view.topPx);
        const mouseRay = makeMouseRay(view, mouseX, mouseYUp);
        
        view.raycaster.setFromCamera(mouseRay, view.camera);
        view.raycaster.layers.mask = view.camera.layers.mask; // Use camera's layer mask
        
        // Check intersection with building meshes
        let closestBuilding = null;
        let closestDistance = Infinity;
        
        this.iterate((id, building) => {
            if (building.solidMesh) {
                const intersects = view.raycaster.intersectObject(building.solidMesh, false);
                if (intersects.length > 0 && intersects[0].distance < closestDistance) {
                    closestDistance = intersects[0].distance;
                    closestBuilding = building;
                }
            }
        });
        
        return closestBuilding;
    }
    
    /**
     * Add a new cloud layer
     */
    addClouds(cloudsData) {
        const id = cloudsData.id || `synthClouds_${this.nextCloudsID++}`;
        const clouds = new CNodeSynthClouds({
            ...cloudsData,
            id: id
        });
        
        this.cloudsList[id] = clouds;
        console.log(`Added clouds: ${id}`);
        setRenderOne(true);
        return clouds;
    }
    
    /**
     * Remove a cloud layer
     */
    removeClouds(cloudsID) {
        if (this.cloudsList[cloudsID]) {
            const clouds = this.cloudsList[cloudsID];
            
            if (clouds.editMode || Globals.editingClouds === clouds) {
                console.log(`  Exiting edit mode for clouds ${cloudsID} before removal`);
                clouds.setEditMode(false);
            }
            
            NodeMan.disposeRemove(clouds);
            delete this.cloudsList[cloudsID];
            
            console.log(`Removed clouds: ${cloudsID}`);
            setRenderOne(true);
        }
    }
    
    /**
     * Get a cloud layer by ID
     */
    getClouds(cloudsID) {
        return this.cloudsList[cloudsID];
    }
    
    /**
     * Create a cloud disk at the given ground point
     * @param {Vector3} groundPoint - The ground point (in EUS coordinates)
     * @param {number} altitude - Altitude in meters (default 10,000 ft)
     * @returns {CNodeSynthClouds} The created cloud layer
     */
    createCloudsAtPoint(groundPoint, altitude = f2m(10000)) {
        if (Globals.editingClouds) {
            alert("Please exit edit mode before creating new clouds");
            return null;
        }
        
        const lla = EUSToLLA(groundPoint);
        
        const clouds = this.addClouds({
            centerLat: lla.x,
            centerLon: lla.y,
            altitude: altitude,
            radius: 500,
            cloudSize: 200,
            density: 0.5,
            opacity: 0.8,
            name: `Clouds ${this.nextCloudsID}`
        });
        
        console.log(`Created clouds: ${clouds.cloudsID} at ground point`);
        return clouds;
    }
    
    /**
     * Iterate over all cloud layers
     */
    iterateClouds(callback) {
        for (const id in this.cloudsList) {
            callback(id, this.cloudsList[id]);
        }
    }
    
    /**
     * Serialize all buildings and clouds for saving
     */
    serialize() {
        const buildingsArray = [];
        this.iterate((id, building) => {
            buildingsArray.push(building.serialize());
        });
        
        const cloudsArray = [];
        this.iterateClouds((id, clouds) => {
            cloudsArray.push(clouds.serialize());
        });
        
        return {
            buildings: buildingsArray,
            nextBuildingID: this.nextBuildingID,
            clouds: cloudsArray,
            nextCloudsID: this.nextCloudsID
        };
    }
    
    /**
     * Deserialize buildings and clouds from save data
     */
    deserialize(data) {
        if (!data) return;
        
        this.clear();
        
        if (data.buildings) {
            data.buildings.forEach(buildingData => {
                const building = CNodeSynthBuilding.deserialize(buildingData);
                this.add(building.buildingID || building.id, building);
            });
            this.nextBuildingID = data.nextBuildingID || this.size() + 1;
            console.log(`Loaded ${this.size()} buildings`);
        }
        
        if (data.clouds) {
            data.clouds.forEach(cloudsData => {
                const clouds = CNodeSynthClouds.deserialize(cloudsData);
                this.cloudsList[clouds.cloudsID] = clouds;
            });
            this.nextCloudsID = data.nextCloudsID || Object.keys(this.cloudsList).length + 1;
            console.log(`Loaded ${Object.keys(this.cloudsList).length} cloud layers`);
        }
        
        setRenderOne(true);
    }
    
    /**
     * Clear all buildings and clouds
     */
    clear() {
        const buildingIds = Object.keys(this.list);
        buildingIds.forEach(id => {
            this.removeBuilding(id);
        });
        
        const cloudsIds = Object.keys(this.cloudsList);
        cloudsIds.forEach(id => {
            this.removeClouds(id);
        });
    }
    
    /**
     * Dispose of all resources
     */
    dispose() {
        document.removeEventListener('pointerdown', this.onPointerDownBound);
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        document.removeEventListener('pointerup', this.onPointerUpBound);
        
        this.clear();
        
        if (this.creationPreviewBuilding) {
            this.creationPreviewBuilding.dispose();
        }
    }
}