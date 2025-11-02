// Synthetic 3D Building/Object Node
// Uses a mesh-based data structure (vertices, edges, faces) for extensibility
// to arbitrary 3D geometry editing (like SketchUp/Blender)

import {CNode3DGroup} from "./CNode3DGroup";
import {
    BufferGeometry,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshLambertMaterial,
    Plane,
    Raycaster,
    SphereGeometry,
    Vector3
} from "three";
import * as LAYER from "../LayerMasks";
import {getLocalUpVector} from "../SphericalMath";
import {EUSToLLA, LLAToEUS} from "../LLA-ECEF-ENU";
import {makeMouseRay} from "../mouseMoveView";
import {ViewMan} from "../CViewManager";
import {Globals, guiMenus, setRenderOne} from "../Globals";
import {mouseInViewOnly} from "../ViewUtils";

export class CNodeSynthBuilding extends CNode3DGroup {
    constructor(v) {
        super(v);
        
        // Mesh data structure (what we save/load)
        this.vertices = [];  // Array of Vector3 positions in EUS coordinates
        this.faces = [];     // Array of face objects: {indices: [v0, v1, v2, ...]}
        
        // Optional: Store edges explicitly for wireframe rendering
        // Edges are derived from faces, but we can cache them
        this.edges = [];     // Array of {v0: idx, v1: idx}
        
        // Metadata
        this.buildingID = v.id;
        this.name = v.name || v.id;
        
        // THREE.js rendering objects
        this.solidMesh = null;      // The rendered building mesh
        this.wireframe = null;      // Wireframe edges
        this.controlPoints = [];    // Editable vertex control points
        
        // Edit mode state
        this.editMode = false;
        this.isDragging = false;
        this.draggingPoint = null;
        this.draggingVertexIndex = -1;
        this.dragLocalUp = null;
        
        // Raycaster for picking
        this.raycaster = new Raycaster();
        this.raycaster.layers.mask = LAYER.MASK_HELPERS;
        
        // If we're given initial geometry, create it
        if (v.vertices && v.faces) {
            this.loadGeometry(v.vertices, v.faces);
        } else if (v.footprint && v.height !== undefined) {
            // Create a cuboid from a footprint rectangle and height
            this.createCuboidFromFootprint(v.footprint, v.height);
        }
        
        // Build the THREE.js meshes
        this.buildMesh();
        
        // Set up event listeners for dragging
        this.setupEventListeners();
        
        // Create GUI folder (hidden until edit mode)
        this.createGUIFolder();
    }
    
    /**
     * Load geometry from vertices and faces arrays
     */
    loadGeometry(vertices, faces) {
        this.vertices = vertices.map(v => new Vector3(v.x, v.y, v.z));
        this.faces = faces.map(f => ({indices: [...f.indices]}));
        this.computeEdges();
    }
    
    /**
     * Create a cuboid (rectangular prism) from a footprint and height
     * @param {Array} footprint - Array of 4 corner positions [Vector3] forming rectangle on ground
     * @param {number} height - Height of the building in meters
     */
    createCuboidFromFootprint(footprint, height) {
        if (footprint.length !== 4) {
            console.error("Footprint must have exactly 4 corners");
            return;
        }
        
        // Bottom 4 vertices (on ground)
        this.vertices = footprint.map(p => p.clone());
        
        // Top 4 vertices (extruded up by height along local up vector)
        for (let i = 0; i < 4; i++) {
            const bottomPos = footprint[i];
            const localUp = getLocalUpVector(bottomPos);
            const topPos = bottomPos.clone().add(localUp.multiplyScalar(height));
            this.vertices.push(topPos);
        }
        
        // Define faces as quads (we'll triangulate for rendering)
        // Vertex order: 0,1,2,3 = bottom corners (CCW from above)
        //               4,5,6,7 = top corners (CCW from above)
        this.faces = [
            {indices: [0, 1, 2, 3]},  // Bottom face
            {indices: [4, 5, 6, 7]},  // Top face (reversed for correct normal)
            {indices: [0, 1, 5, 4]},  // Side face
            {indices: [1, 2, 6, 5]},  // Side face
            {indices: [2, 3, 7, 6]},  // Side face
            {indices: [3, 0, 4, 7]},  // Side face
        ];
        
        this.computeEdges();
    }
    
    /**
     * Compute edges from faces
     */
    computeEdges() {
        const edgeSet = new Set();
        this.edges = [];
        
        this.faces.forEach(face => {
            const indices = face.indices;
            for (let i = 0; i < indices.length; i++) {
                const v0 = indices[i];
                const v1 = indices[(i + 1) % indices.length];
                // Create a canonical edge key (smaller index first)
                const key = v0 < v1 ? `${v0},${v1}` : `${v1},${v0}`;
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    this.edges.push({v0: Math.min(v0, v1), v1: Math.max(v0, v1)});
                }
            }
        });
    }
    
    /**
     * Build THREE.js mesh from vertices and faces
     */
    buildMesh() {
        // Remove old mesh if it exists
        if (this.solidMesh) {
            this.group.remove(this.solidMesh);
            this.solidMesh.geometry.dispose();
            this.solidMesh.material.dispose();
        }
        if (this.wireframe) {
            this.group.remove(this.wireframe);
            this.wireframe.geometry.dispose();
            this.wireframe.material.dispose();
        }
        
        // Create BufferGeometry from vertices and faces
        const geometry = new BufferGeometry();
        
        // Triangulate faces and build position array
        const positions = [];
        const triangulatedIndices = [];
        
        this.faces.forEach(face => {
            const indices = face.indices;
            // Simple fan triangulation for convex polygons
            for (let i = 1; i < indices.length - 1; i++) {
                triangulatedIndices.push(indices[0], indices[i], indices[i + 1]);
            }
        });
        
        // Build position buffer
        this.vertices.forEach(v => {
            positions.push(v.x, v.y, v.z);
        });
        
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setIndex(triangulatedIndices);
        geometry.computeVertexNormals();
        
        // Create solid mesh
        const material = new MeshLambertMaterial({
            color: 0x8888ff,
            transparent: true,
            opacity: 0.7,
            depthWrite: true
        });
        
        this.solidMesh = new Mesh(geometry, material);
        this.solidMesh.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
        this.group.add(this.solidMesh);
        
        // Create wireframe from edges
        const edgeGeometry = new BufferGeometry();
        const edgePositions = [];
        this.edges.forEach(edge => {
            const v0 = this.vertices[edge.v0];
            const v1 = this.vertices[edge.v1];
            edgePositions.push(v0.x, v0.y, v0.z);
            edgePositions.push(v1.x, v1.y, v1.z);
        });
        edgeGeometry.setAttribute('position', new Float32BufferAttribute(edgePositions, 3));
        
        const edgeMaterial = new LineBasicMaterial({
            color: 0x000000,
            linewidth: 2,
            depthTest: true
        });
        
        this.wireframe = new LineSegments(edgeGeometry, edgeMaterial);
        this.wireframe.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
        this.group.add(this.wireframe);
    }
    
    /**
     * Create control points for editing vertices
     */
    createControlPoints() {
        // Remove old control points
        this.controlPoints.forEach(cp => {
            this.group.remove(cp);
            cp.geometry.dispose();
            cp.material.dispose();
        });
        this.controlPoints = [];
        
        // Create a sphere at each vertex
        const geometry = new SphereGeometry(3, 16, 16);  // 3m radius
        
        this.vertices.forEach((vertex, idx) => {
            const material = new MeshLambertMaterial({
                color: 0xffff00,
                transparent: true,
                opacity: 0.9,
                depthTest: true
            });
            
            const sphere = new Mesh(geometry, material);
            sphere.position.copy(vertex);
            sphere.layers.mask = LAYER.MASK_HELPERS;
            sphere.userData.vertexIndex = idx;
            
            this.group.add(sphere);
            this.controlPoints.push(sphere);
        });
    }
    
    /**
     * Set edit mode on/off
     */
    setEditMode(enable) {
        console.log(`setEditMode(${enable}) called for building:`, this.buildingID);
        this.editMode = enable;
        
        if (enable) {
            this.createControlPoints();
            Globals.editingBuilding = this;
            
            console.log(`  Created ${this.controlPoints.length} control points`);
            console.log(`  Control points are on layer mask:`, this.controlPoints[0]?.layers.mask.toString(2));
            
            // Show GUI folder
            if (this.guiFolder) {
                this.guiFolder.show();
            }
        } else {
            // Remove control points
            this.controlPoints.forEach(cp => {
                this.group.remove(cp);
                cp.geometry.dispose();
                cp.material.dispose();
            });
            this.controlPoints = [];
            
            if (Globals.editingBuilding === this) {
                Globals.editingBuilding = null;
            }
            
            // Hide GUI folder
            if (this.guiFolder) {
                this.guiFolder.hide();
            }
        }
        
        setRenderOne(true);
    }
    
    /**
     * Set up event listeners for mouse interaction
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
     * Handle pointer down - start dragging a control point
     */
    onPointerDown(event) {
        if (!this.editMode) {
            console.log("onPointerDown: NOT in edit mode");
            return;
        }
        if (event.button !== 0) return; // Only left mouse button
        
        const view = ViewMan.get("mainView");
        if (!view || !mouseInViewOnly(view, event.clientX, event.clientY)) {
            console.log("onPointerDown: Not in view");
            return;
        }
        
        const mouseYUp = view.heightPx - (event.clientY - view.topPx);
        const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
        
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        console.log("onPointerDown: Checking intersections...");
        console.log("  Control points:", this.controlPoints.length);
        console.log("  Raycaster layers:", this.raycaster.layers.mask.toString(2));
        console.log("  Camera layers:", view.camera.layers.mask.toString(2));
        
        // Check intersection with control points
        const intersects = this.raycaster.intersectObjects(this.controlPoints, false);
        
        console.log("  Intersections found:", intersects.length);
        
        if (intersects.length > 0) {
            this.draggingPoint = intersects[0].object;
            this.draggingVertexIndex = this.draggingPoint.userData.vertexIndex;
            this.isDragging = true;
            
            console.log("  Started dragging vertex:", this.draggingVertexIndex);
            
            // Store the local up vector at this position
            this.dragLocalUp = getLocalUpVector(this.draggingPoint.position);
            
            // Disable camera controls while dragging
            if (view.controls) {
                view.controls.enabled = false;
            }
            
            event.stopPropagation();
            event.preventDefault();
        }
    }
    
    /**
     * Handle pointer move - drag the control point
     */
    onPointerMove(event) {
        if (!this.isDragging || !this.draggingPoint) return;
        
        const view = ViewMan.get("mainView");
        if (!view) return;
        
        const mouseYUp = view.heightPx - (event.clientY - view.topPx);
        const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
        
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        // Determine if this is a top or bottom vertex
        // For cuboid: vertices 0-3 are bottom, 4-7 are top
        const isTopVertex = this.draggingVertexIndex >= 4;
        
        let plane = new Plane();
        
        if (isTopVertex) {
            // For top vertices, create a vertical plane facing the camera
            // This allows height adjustment while keeping horizontal position locked
            const cameraPos = view.camera.position;
            const toCamera = cameraPos.clone().sub(this.draggingPoint.position).normalize();
            
            // Make plane perpendicular to camera view but parallel to localUp
            const tangent = new Vector3().crossVectors(this.dragLocalUp, toCamera).normalize();
            const planeNormal = new Vector3().crossVectors(tangent, this.dragLocalUp).normalize();
            
            plane.setFromNormalAndCoplanarPoint(planeNormal, this.draggingPoint.position);
        } else {
            // For bottom vertices, create a horizontal plane (perpendicular to localUp)
            plane.setFromNormalAndCoplanarPoint(
                this.dragLocalUp,
                this.draggingPoint.position
            );
        }
        
        // Intersect ray with plane
        const newPosition = new Vector3();
        if (this.raycaster.ray.intersectPlane(plane, newPosition)) {
            // Update vertex position
            this.vertices[this.draggingVertexIndex].copy(newPosition);
            this.draggingPoint.position.copy(newPosition);
            
            // Rebuild mesh
            this.buildMesh();
            
            // Recreate control points to update their positions
            this.createControlPoints();
            
            // Re-identify the dragging point
            this.draggingPoint = this.controlPoints[this.draggingVertexIndex];
            
            setRenderOne(true);
        }
        
        event.stopPropagation();
        event.preventDefault();
    }
    
    /**
     * Handle pointer up - stop dragging
     */
    onPointerUp(event) {
        if (this.isDragging) {
            const view = ViewMan.get("mainView");
            if (view && view.controls) {
                view.controls.enabled = true;
            }
        }
        
        this.isDragging = false;
        this.draggingPoint = null;
        this.draggingVertexIndex = -1;
        this.dragLocalUp = null;
    }
    
    /**
     * Create GUI folder for this building
     */
    createGUIFolder() {
        if (!guiMenus.contents) return;
        
        const folderID = `folder_${this.buildingID}`;
        this.guiFolder = guiMenus.contents.addFolder(this.name);
        this.guiFolder.domElement.id = folderID;
        
        // Edit mode checkbox
        const editModeData = {editMode: this.editMode};
        this.guiFolder.add(editModeData, 'editMode').name('Edit Mode').onChange((value) => {
            this.setEditMode(value);
        });
        
        // Delete button
        const actions = {
            delete: () => {
                if (confirm(`Delete building "${this.name}"?`)) {
                    // Manager will handle deletion
                    if (window.synth3DManager) {
                        window.synth3DManager.removeBuilding(this.buildingID);
                    }
                }
            }
        };
        this.guiFolder.add(actions, 'delete').name('Delete Building');
        
        // Initially hide the folder
        this.guiFolder.hide();
    }
    
    /**
     * Serialize to save data
     */
    serialize() {
        // Convert vertices to LLA for portability across different map origins
        const verticesLLA = this.vertices.map(v => {
            const lla = EUSToLLA(v.x, v.y, v.z);
            return {lat: lla.lat, lon: lla.lon, alt: lla.alt};
        });
        
        return {
            id: this.buildingID,
            name: this.name,
            vertices: verticesLLA,
            faces: this.faces.map(f => ({indices: [...f.indices]}))
        };
    }
    
    /**
     * Deserialize from saved data
     */
    static deserialize(data) {
        // Convert LLA vertices back to EUS
        const verticesEUS = data.vertices.map(v => {
            return LLAToEUS(v.lat, v.lon, v.alt);
        });
        
        return new CNodeSynthBuilding({
            id: data.id,
            name: data.name,
            vertices: verticesEUS,
            faces: data.faces
        });
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        // Remove event listeners
        document.removeEventListener('pointerdown', this.onPointerDownBound);
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        document.removeEventListener('pointerup', this.onPointerUpBound);
        
        // Remove control points
        this.controlPoints.forEach(cp => {
            this.group.remove(cp);
            cp.geometry.dispose();
            cp.material.dispose();
        });
        
        // Remove meshes
        if (this.solidMesh) {
            this.group.remove(this.solidMesh);
            this.solidMesh.geometry.dispose();
            this.solidMesh.material.dispose();
        }
        if (this.wireframe) {
            this.group.remove(this.wireframe);
            this.wireframe.geometry.dispose();
            this.wireframe.material.dispose();
        }
        
        // Remove GUI folder
        if (this.guiFolder) {
            this.guiFolder.destroy();
        }
        
        super.dispose();
    }
}