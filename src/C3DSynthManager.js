// Manager for Synthetic 3D Objects (buildings, structures, etc.)
// Handles creation, editing, deletion, and persistence

import {CManager} from "./CManager";
import {CNodeSynthBuilding} from "./nodes/CNodeSynthBuilding";
import {Globals, NodeMan, setRenderOne} from "./Globals";
import {ViewMan} from "./CViewManager";
import {makeMouseRay} from "./mouseMoveView";
import {mouseInViewOnly} from "./ViewUtils";
import {V3} from "./threeUtils";
import {getLocalUpVector} from "./SphericalMath";
import {Sphere, Vector3} from "three";
import {wgs84} from "./LLA-ECEF-ENU";

export class C3DSynthManager extends CManager {
    constructor() {
        super();
        this.buildings = new Map();  // Map of buildingID -> CNodeSynthBuilding
        this.nextBuildingID = 1;
        
        // Creation mode state
        this.creationMode = false;
        this.creationStartPoint = null;
        this.creationCurrentPoint = null;
        this.creationPreviewBuilding = null;
        
        // Make globally accessible for GUI callbacks
        window.synth3DManager = this;
        
        // Set up event listeners for creation mode
        this.setupEventListeners();
        
        console.log("C3DSynthManager initialized");
    }
    
    /**
     * Set up event listeners for creation mode
     */
    setupEventListeners() {
        this.onPointerDownBound = (e) => this.onPointerDown(e);
        this.onPointerMoveBound = (e) => this.onPointerMove(e);
        this.onPointerUpBound = (e) => this.onPointerUp(e);
        
        document.addEventListener('pointerdown', this.onPointerDownBound);
        document.addEventListener('pointermove', this.onPointerMoveBound);
        document.addEventListener('pointerup', this.onPointerUpBound);
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
        
        this.buildings.set(id, building);
        console.log(`Added building: ${id}`);
        setRenderOne(true);
        return building;
    }
    
    /**
     * Remove a building
     */
    removeBuilding(buildingID) {
        const building = this.buildings.get(buildingID);
        if (building) {
            building.dispose();
            this.buildings.delete(buildingID);
            console.log(`Removed building: ${buildingID}`);
            setRenderOne(true);
        }
    }
    
    /**
     * Get a building by ID
     */
    getBuilding(buildingID) {
        return this.buildings.get(buildingID);
    }
    
    /**
     * Start creation mode - user will click and drag to create a building footprint
     */
    startCreationMode() {
        if (Globals.editingBuilding) {
            alert("Please exit edit mode before creating a new building");
            return;
        }
        
        this.creationMode = true;
        this.creationStartPoint = null;
        this.creationCurrentPoint = null;
        
        // Disable camera controls during creation
        const view = ViewMan.get("mainView");
        if (view && view.controls) {
            view.controls.enabled = false;
        }
        
        console.log("Building creation mode started. Click and drag on the ground to create a building.");
    }
    
    /**
     * Cancel creation mode
     */
    cancelCreationMode() {
        this.creationMode = false;
        this.creationStartPoint = null;
        this.creationCurrentPoint = null;
        
        if (this.creationPreviewBuilding) {
            NodeMan.disposeRemove('preview_building');
            this.creationPreviewBuilding = null;
        }
        
        // Re-enable camera controls
        const view = ViewMan.get("mainView");
        if (view && view.controls) {
            view.controls.enabled = true;
        }
        
        setRenderOne(true);
    }
    
    /**
     * Handle pointer down during creation mode
     */
    onPointerDown(event) {
        if (!this.creationMode) return;
        if (event.button !== 0) return; // Only left mouse button
        
        const view = ViewMan.get("mainView");
        if (!view || !mouseInViewOnly(view, event.clientX, event.clientY)) return;
        
        // Get ground intersection point
        const groundPoint = this.getGroundPoint(view, event.clientX, event.clientY);
        if (!groundPoint) return;
        
        this.creationStartPoint = groundPoint.clone();
        this.creationCurrentPoint = groundPoint.clone();
        
        console.log("Creation start point:", this.creationStartPoint);
        
        event.stopPropagation();
        event.preventDefault();
    }
    
    /**
     * Handle pointer move during creation mode
     */
    onPointerMove(event) {
        if (!this.creationMode || !this.creationStartPoint) return;
        
        const view = ViewMan.get("mainView");
        if (!view) return;
        
        // Get current ground point
        const groundPoint = this.getGroundPoint(view, event.clientX, event.clientY);
        if (!groundPoint) return;
        
        this.creationCurrentPoint = groundPoint.clone();
        
        console.log("Creation current point:", this.creationCurrentPoint, "distance:", this.creationStartPoint.distanceTo(this.creationCurrentPoint));
        
        // Update preview building
        this.updateCreationPreview();
        
        setRenderOne(true);
        event.stopPropagation();
        event.preventDefault();
    }
    
    /**
     * Handle pointer up - finish creating building
     */
    onPointerUp(event) {
        if (!this.creationMode || !this.creationStartPoint) return;
        
        const view = ViewMan.get("mainView");
        if (!view) return;
        
        // Get final ground point
        const groundPoint = this.getGroundPoint(view, event.clientX, event.clientY);
        if (!groundPoint) {
            this.cancelCreationMode();
            return;
        }
        
        // Check if drag distance is significant (at least 5 meters)
        const distance = this.creationStartPoint.distanceTo(groundPoint);
        console.log("Final distance check:", distance, "Start:", this.creationStartPoint, "End:", groundPoint);
        if (distance < 5) {
            console.log("Building too small (minimum 5m). Creation cancelled.");
            this.cancelCreationMode();
            return;
        }
        
        // Create the building footprint rectangle
        const footprint = this.createRectangleFootprint(
            this.creationStartPoint,
            groundPoint
        );
        
        // Remove preview
        if (this.creationPreviewBuilding) {
            NodeMan.disposeRemove('preview_building');
            this.creationPreviewBuilding = null;
        }
        
        // Create actual building with default height of 10m
        const building = this.addBuilding({
            footprint: footprint,
            height: 10,
            name: `Building ${this.nextBuildingID}`
        });
        
        // Exit creation mode
        this.creationMode = false;
        this.creationStartPoint = null;
        this.creationCurrentPoint = null;
        
        // Re-enable camera controls
        if (view.controls) {
            view.controls.enabled = true;
        }
        
        // Immediately enter edit mode on the new building
        building.setEditMode(true);
        
        console.log(`Created building: ${building.buildingID}`);
        setRenderOne(true);
    }
    
    /**
     * Update the preview building during creation
     */
    updateCreationPreview() {
        if (!this.creationStartPoint || !this.creationCurrentPoint) return;
        
        // Remove old preview
        if (this.creationPreviewBuilding) {
            NodeMan.disposeRemove('preview_building');
            this.creationPreviewBuilding = null;
        }
        
        // Create footprint rectangle
        const footprint = this.createRectangleFootprint(
            this.creationStartPoint,
            this.creationCurrentPoint
        );
        
        // Create preview building (semi-transparent)
        this.creationPreviewBuilding = new CNodeSynthBuilding({
            id: 'preview_building',
            footprint: footprint,
            height: 10,
            name: 'Preview'
        });
        
        // Make it more transparent
        if (this.creationPreviewBuilding.solidMesh) {
            this.creationPreviewBuilding.solidMesh.material.opacity = 0.3;
        }
    }
    
    /**
     * Create a rectangle footprint from two corner points
     * The rectangle is aligned with local north/east directions
     */
    createRectangleFootprint(point1, point2) {
        // Get local coordinate system at point1
        const localUp = getLocalUpVector(point1);
        
        // Project both points to the same horizontal plane
        // (in case they're at slightly different elevations)
        const midpoint = point1.clone().add(point2).multiplyScalar(0.5);
        
        // Vector from point1 to point2 in 3D
        const diagonal = point2.clone().sub(point1);
        
        // Project diagonal onto horizontal plane (perpendicular to localUp)
        const diagonalProjected = diagonal.clone().sub(
            localUp.clone().multiplyScalar(diagonal.dot(localUp))
        );
        
        // Get perpendicular direction (also in horizontal plane)
        const perpendicular = new Vector3().crossVectors(localUp, diagonalProjected).normalize();
        const parallel = new Vector3().crossVectors(perpendicular, localUp).normalize();
        
        // Half-dimensions
        const halfLength = diagonalProjected.length() / 2;
        const halfWidth = 0; // We create a thin initial rectangle that can be expanded
        
        // Actually, let's make it have some minimum width so it's visible
        const minWidth = Math.max(5, halfLength * 0.3); // At least 5m or 30% of length
        
        // Create 4 corners
        const corners = [
            midpoint.clone().add(parallel.clone().multiplyScalar(-halfLength))
                            .add(perpendicular.clone().multiplyScalar(-minWidth)),
            midpoint.clone().add(parallel.clone().multiplyScalar(halfLength))
                            .add(perpendicular.clone().multiplyScalar(-minWidth)),
            midpoint.clone().add(parallel.clone().multiplyScalar(halfLength))
                            .add(perpendicular.clone().multiplyScalar(minWidth)),
            midpoint.clone().add(parallel.clone().multiplyScalar(-halfLength))
                            .add(perpendicular.clone().multiplyScalar(minWidth))
        ];
        
        return corners;
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
        
        this.buildings.forEach((building, id) => {
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
     * Serialize all buildings for saving
     */
    serialize() {
        const buildingsArray = [];
        this.buildings.forEach((building, id) => {
            buildingsArray.push(building.serialize());
        });
        
        return {
            buildings: buildingsArray,
            nextBuildingID: this.nextBuildingID
        };
    }
    
    /**
     * Deserialize buildings from save data
     */
    deserialize(data) {
        if (!data || !data.buildings) return;
        
        // Clear existing buildings
        this.buildings.forEach((building, id) => {
            building.dispose();
        });
        this.buildings.clear();
        
        // Load buildings
        data.buildings.forEach(buildingData => {
            const building = CNodeSynthBuilding.deserialize(buildingData);
            this.buildings.set(building.buildingID, building);
        });
        
        this.nextBuildingID = data.nextBuildingID || this.buildings.size + 1;
        
        console.log(`Loaded ${this.buildings.size} buildings`);
        setRenderOne(true);
    }
    
    /**
     * Dispose of all resources
     */
    dispose() {
        // Remove event listeners
        document.removeEventListener('pointerdown', this.onPointerDownBound);
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        document.removeEventListener('pointerup', this.onPointerUpBound);
        
        // Dispose all buildings
        this.buildings.forEach((building, id) => {
            building.dispose();
        });
        this.buildings.clear();
        
        if (this.creationPreviewBuilding) {
            this.creationPreviewBuilding.dispose();
        }
        
        window.synth3DManager = null;
    }
}

// Export singleton instance
export const Synth3DManager = new C3DSynthManager();