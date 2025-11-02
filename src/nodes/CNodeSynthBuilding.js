// Synthetic 3D Building/Object Node
// Uses a mesh-based data structure (vertices, edges, faces) for extensibility
// to arbitrary 3D geometry editing (like SketchUp/Blender)

import {CNode3DGroup} from "./CNode3DGroup";
import {
    BufferGeometry,
    CircleGeometry,
    DoubleSide,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshPhongMaterial,
    MeshStandardMaterial,
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
import {CustomManager, Globals, guiMenus, setRenderOne, Synth3DManager} from "../Globals";
import {mouseInViewOnly} from "../ViewUtils";

export class CNodeSynthBuilding extends CNode3DGroup {
    constructor(v) {

        v.rawColor = v.color;
        super(v);
        
        // Mesh data structure (what we save/load)
        // Each vertex is now an object with position and metadata:
        // {
        //   position: Vector3,
        //   type: 'top' | 'bottom' | 'free',
        //   next: vertexIndex (for ring navigation),
        //   prev: vertexIndex (for ring navigation),
        //   linkedVertex: vertexIndex (top <-> bottom pairing)
        // }
        this.vertices = [];  // Array of vertex objects
        this.faces = [];     // Array of face objects: {indices: [v0, v1, v2, ...]}
        
        // Optional: Store edges explicitly for wireframe rendering
        // Edges are derived from faces, but we can cache them
        this.edges = [];     // Array of {v0: idx, v1: idx}
        
        // Metadata
        this.buildingID = v.id;
        this.name = v.name || v.id;
        
        // Material properties
        this.materialType = v.material || 'lambert';
        this.materialColor = v.rawColor || 0x8888ff;
        this.materialOpacity = v.opacity !== undefined ? v.opacity : 0.7;
        this.materialTransparent = v.transparent !== undefined ? v.transparent : true;
        this.materialDepthTest = v.depthTest !== undefined ? v.depthTest : true;
        this.materialWireframe = v.wireframe || false;
        
        // THREE.js rendering objects
        this.solidMesh = null;      // The rendered building mesh
        this.wireframe = null;      // Wireframe edges
        this.controlPoints = [];    // Editable vertex control points
        this.roofCenterHandle = null; // Single grey handle for roof height adjustment
        this.rotationHandles = [];    // Invisible larger handles around each corner for rotation detection
        
        // Edit mode state
        this.editMode = false;
        this.isDragging = false;
        this.isRotating = false;
        this.draggingPoint = null;
        this.draggingVertexIndex = -1;
        this.dragLocalUp = null;
        this.hoveredHandle = null;  // Track which handle is being hovered
        this.rotationStartAngle = 0; // Initial angle when rotation starts
        this.buildingCentroid = null; // Center point for rotation
        
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
        // Handle both old format (just positions) and new format (vertex objects)
        this.vertices = vertices.map(v => {
            if (v.position) {
                // New format with metadata
                return {
                    position: new Vector3(v.position.x, v.position.y, v.position.z),
                    type: v.type || 'free',
                    next: v.next !== undefined ? v.next : -1,
                    prev: v.prev !== undefined ? v.prev : -1,
                    linkedVertex: v.linkedVertex !== undefined ? v.linkedVertex : -1
                };
            } else {
                // Old format - just a position, treat as free vertex
                return {
                    position: new Vector3(v.x, v.y, v.z),
                    type: 'free',
                    next: -1,
                    prev: -1,
                    linkedVertex: -1
                };
            }
        });
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
        
        // Create bottom ring (vertices 0-3)
        for (let i = 0; i < 4; i++) {
            this.vertices.push({
                position: footprint[i].clone(),
                type: 'bottom',
                next: (i + 1) % 4,        // Circular: 0→1→2→3→0
                prev: (i + 3) % 4,        // Circular: 0←1←2←3←0
                linkedVertex: i + 4       // Links to corresponding top vertex
            });
        }
        
        // Create top ring (vertices 4-7)
        for (let i = 0; i < 4; i++) {
            const bottomPos = footprint[i];
            const localUp = getLocalUpVector(bottomPos);
            const topPos = bottomPos.clone().add(localUp.multiplyScalar(height));
            
            this.vertices.push({
                position: topPos,
                type: 'top',
                next: 4 + ((i + 1) % 4),  // Circular: 4→5→6→7→4
                prev: 4 + ((i + 3) % 4),  // Circular: 4←5←6←7←4
                linkedVertex: i            // Links to corresponding bottom vertex
            });
        }
        
        // Define faces as quads (we'll triangulate for rendering)
        // Vertex order: 0,1,2,3 = bottom corners (CCW from above)
        //               4,5,6,7 = top corners (CCW from above)
        // NOTE: Winding order REVERSED so normals point OUTWARD from the building
        this.faces = [
            {indices: [3, 2, 1, 0]},  // Bottom face (reversed - normal points down/out)
            {indices: [7, 6, 5, 4]},  // Top face (reversed - normal points up/out)
            {indices: [4, 5, 1, 0]},  // Side face (reversed - normal points out)
            {indices: [5, 6, 2, 1]},  // Side face (reversed - normal points out)
            {indices: [6, 7, 3, 2]},  // Side face (reversed - normal points out)
            {indices: [7, 4, 0, 3]},  // Side face (reversed - normal points out)
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
        this.vertices.forEach(vertex => {
            const v = vertex.position;
            positions.push(v.x, v.y, v.z);
        });
        
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setIndex(triangulatedIndices);
        geometry.computeVertexNormals();
        
        // Create solid mesh with material
        const material = this.createMaterial();
        
        this.solidMesh = new Mesh(geometry, material);
        this.solidMesh.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
        this.group.add(this.solidMesh);
        
        // Create wireframe from edges
        const edgeGeometry = new BufferGeometry();
        const edgePositions = [];
        this.edges.forEach(edge => {
            const v0 = this.vertices[edge.v0].position;
            const v1 = this.vertices[edge.v1].position;
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
     * Create a material based on current material properties
     */
    createMaterial() {
        const materialConfig = {
            color: this.materialColor,
            transparent: this.materialTransparent,
            opacity: this.materialOpacity,
            depthTest: this.materialDepthTest,
            wireframe: this.materialWireframe,
            depthWrite: true
        };
        
        switch (this.materialType) {
            case 'basic':
                return new MeshBasicMaterial(materialConfig);
            case 'lambert':
                return new MeshLambertMaterial(materialConfig);
            case 'phong':
                return new MeshPhongMaterial(materialConfig);
            case 'physical':
                return new MeshStandardMaterial(materialConfig);
            default:
                return new MeshLambertMaterial(materialConfig);
        }
    }
    
    /**
     * Rebuild the material when properties change
     */
    rebuildMaterial() {
        if (this.solidMesh) {
            const oldMaterial = this.solidMesh.material;
            this.solidMesh.material = this.createMaterial();
            oldMaterial.dispose();
            setRenderOne(true);
        }
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
        
        // Remove old roof center handle if it exists
        if (this.roofCenterHandle) {
            this.group.remove(this.roofCenterHandle);
            this.roofCenterHandle.geometry.dispose();
            this.roofCenterHandle.material.dispose();
            this.roofCenterHandle = null;
        }
        
        // Remove old rotation handles if they exist
        this.rotationHandles.forEach(handle => {
            this.group.remove(handle);
            handle.geometry.dispose();
            handle.material.dispose();
        });
        this.rotationHandles = [];
        
        const geometry = new SphereGeometry(3, 16, 16);  // 3m radius
        const rotationDiscGeometry = new CircleGeometry(6, 32);  // 6m radius flat disc
        
        // Create yellow handles for bottom vertices + invisible rotation discs
        this.vertices.forEach((vertex, idx) => {
            if (vertex.type === 'bottom') {
                // Visible yellow handle
                const material = new MeshLambertMaterial({
                    color: 0xffff00,
                    transparent: true,
                    opacity: 0.9,
                    depthTest: true
                });
                
                const sphere = new Mesh(geometry, material);
                sphere.position.copy(vertex.position);
                sphere.layers.mask = LAYER.MASK_HELPERS;
                sphere.userData.vertexIndex = idx;
                sphere.userData.isBottomHandle = true;
                
                this.group.add(sphere);
                this.controlPoints.push(sphere);
                
                // Get the two neighbor vertices to define the disc plane
                const prevVertex = this.vertices[vertex.prev];
                const nextVertex = this.vertices[vertex.next];
                
                // Calculate plane normal from corner and its two neighbors
                const toPrev = prevVertex.position.clone().sub(vertex.position);
                const toNext = nextVertex.position.clone().sub(vertex.position);
                const planeNormal = new Vector3().crossVectors(toPrev, toNext).normalize();
                
                // Invisible rotation disc around this corner
                const rotationMaterial = new MeshBasicMaterial({
                    color: 0xff0000,
                    transparent: true,
                    opacity: 0.0,  // Completely invisible
                    depthTest: true,
                    side: DoubleSide  // Detect from both sides of the disc
                });
                
                const rotationDisc = new Mesh(rotationDiscGeometry, rotationMaterial);
                rotationDisc.position.copy(vertex.position);
                
                // Orient the disc to align with the plane normal
                rotationDisc.lookAt(vertex.position.clone().add(planeNormal));
                
                rotationDisc.layers.mask = LAYER.MASK_HELPERS;
                rotationDisc.userData.isRotationHandle = true;
                rotationDisc.userData.cornerVertexIndex = idx;  // Link to corner vertex
                
                this.group.add(rotationDisc);
                this.rotationHandles.push(rotationDisc);
            }
        });
        
        // Create one grey handle at the first corner of the roof
        const topVertices = this.vertices.filter(v => v.type === 'top');
        if (topVertices.length > 0) {
            // Use the first top vertex position
            const firstTopVertex = topVertices[0];
            
            const roofMaterial = new MeshLambertMaterial({
                color: 0x888888,  // Grey
                transparent: true,
                opacity: 0.9,
                depthTest: true
            });
            
            this.roofCenterHandle = new Mesh(geometry, roofMaterial);
            this.roofCenterHandle.position.copy(firstTopVertex.position);
            this.roofCenterHandle.layers.mask = LAYER.MASK_HELPERS;
            this.roofCenterHandle.userData.isRoofCenter = true;
            
            this.group.add(this.roofCenterHandle);
            this.controlPoints.push(this.roofCenterHandle);
        }
        
        // Calculate and store the building centroid at ground level (for rotation)
        const bottomVertices = this.vertices.filter(v => v.type === 'bottom');
        if (bottomVertices.length > 0) {
            this.buildingCentroid = new Vector3();
            bottomVertices.forEach(v => this.buildingCentroid.add(v.position));
            this.buildingCentroid.divideScalar(bottomVertices.length);
        }
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
            
            // Show GUI folder and expand it
            if (this.guiFolder) {
                this.guiFolder.show();
                this.guiFolder.open();
            }
            
            // Keep material folder visible but closed initially
            if (this.materialFolder) {
                this.materialFolder.close();
            }
            
            // Show the standalone edit menu at a default position (center-right of screen)
            const defaultX = window.innerWidth * 0.65;
            const defaultY = window.innerHeight * 0.3;
            CustomManager.showBuildingEditingMenu(defaultX, defaultY, null);
        } else {
            // Remove control points
            this.controlPoints.forEach(cp => {
                this.group.remove(cp);
                cp.geometry.dispose();
                cp.material.dispose();
            });
            this.controlPoints = [];
            
            // Remove roof center handle
            if (this.roofCenterHandle) {
                this.group.remove(this.roofCenterHandle);
                this.roofCenterHandle.geometry.dispose();
                this.roofCenterHandle.material.dispose();
                this.roofCenterHandle = null;
            }
            
            // Remove rotation handles
            this.rotationHandles.forEach(handle => {
                this.group.remove(handle);
                handle.geometry.dispose();
                handle.material.dispose();
            });
            this.rotationHandles = [];
            
            // Reset cursor and state
            this.hoveredHandle = null;
            this.isRotating = false;
            document.body.style.cursor = 'default';
            
            if (Globals.editingBuilding === this) {
                Globals.editingBuilding = null;
            }
            
            // Close the standalone edit menu if it exists
            if (CustomManager.buildingEditMenu) {
                CustomManager.buildingEditMenu.destroy();
                CustomManager.buildingEditMenu = null;
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
     * Check if mouse is hovering over a handle and update cursor
     */
    checkHandleHover(event) {
        const view = ViewMan.get("mainView");
        if (!view || !mouseInViewOnly(view, event.clientX, event.clientY)) {
            // Not in view, reset cursor
            if (this.hoveredHandle) {
                document.body.style.cursor = 'default';
                this.hoveredHandle = null;
            }
            return;
        }
        
        const mouseYUp = view.heightPx - (event.clientY - view.topPx);
        const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
        
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        // FIRST: Check intersection with actual handles (control points + roof center handle)
        // These are smaller and should have priority
        const allHandles = [...this.controlPoints];
        if (this.roofCenterHandle) {
            allHandles.push(this.roofCenterHandle);
        }
        
        const intersects = this.raycaster.intersectObjects(allHandles, false);
        
        if (intersects.length > 0) {
            // Hovering over an actual handle
            if (!this.hoveredHandle || this.hoveredHandle !== intersects[0].object) {
                // Use row-resize cursor for roof center handle, move for corner handles
                if (intersects[0].object.userData.isRoofCenter) {
                    document.body.style.cursor = 'row-resize';
                } else {
                    document.body.style.cursor = 'move';
                }
                this.hoveredHandle = intersects[0].object;
            }
        } else {
            // SECOND: Check if hovering in any rotation ring (only if NOT over actual handle)
            if (this.rotationHandles.length > 0) {
                const rotationIntersects = this.raycaster.intersectObjects(this.rotationHandles, false);
                
                if (rotationIntersects.length > 0) {
                    // Get the closest rotation ring
                    const rotationHandle = rotationIntersects[0].object;
                    const intersectionPoint = rotationIntersects[0].point;
                    
                    // Corner rotation ring (for building rotation)
                    const cornerVertexIndex = rotationHandle.userData.cornerVertexIndex;
                    
                    // Project intersection onto plane and check if outside handle radius
                    if (this.isOutsideHandleInPlane(cornerVertexIndex, intersectionPoint)) {
                        if (!this.hoveredHandle || !this.hoveredHandle.userData || !this.hoveredHandle.userData.isRotationRing) {
                            document.body.style.cursor = 'grab';
                            this.hoveredHandle = {userData: {isRotationRing: true, cornerVertexIndex: cornerVertexIndex}};
                        }
                    } else {
                        // Inside visible handle but outside actual handle - check building mesh
                        this.checkBuildingMeshHover();
                    }
                } else {
                    // THIRD: Check if hovering over the building mesh itself
                    this.checkBuildingMeshHover();
                }
            } else {
                // No rotation handles, check building mesh
                this.checkBuildingMeshHover();
            }
        }
    }
    
    /**
     * Project intersection point onto the plane defined by corner and its neighbors,
     * then check if projected distance exceeds the visible handle radius
     * AND if the intersection is on the outward side (away from building center)
     */
    isOutsideHandleInPlane(cornerVertexIndex, intersectionPoint) {
        const cornerVertex = this.vertices[cornerVertexIndex];
        const cornerPosition = cornerVertex.position;
        
        // Get the two neighbor vertices (prev and next in the ring)
        const prevVertex = this.vertices[cornerVertex.prev];
        const nextVertex = this.vertices[cornerVertex.next];
        
        // Define a plane using corner and its two neighbors
        // Calculate two edge vectors
        const toPrev = prevVertex.position.clone().sub(cornerPosition);
        const toNext = nextVertex.position.clone().sub(cornerPosition);
        
        // Plane normal is the cross product of the two edges
        const planeNormal = new Vector3().crossVectors(toPrev, toNext).normalize();
        
        // Project intersection point onto this plane
        const toIntersection = intersectionPoint.clone().sub(cornerPosition);
        const distanceToPlane = toIntersection.dot(planeNormal);
        const projectedPoint = intersectionPoint.clone().sub(planeNormal.multiplyScalar(distanceToPlane));
        
        // Calculate distance from corner to projected point
        const projectedDistance = projectedPoint.distanceTo(cornerPosition);
        
        // Check if projected distance exceeds visible handle radius (3m)
        if (projectedDistance <= 3) {
            return false;
        }
        
        // Additional check: only detect rotation if clicking on the "outward" side
        // X = projectedPoint (collision point on disk)
        // A = cornerPosition (center of disk)
        // F = buildingCentroid (center of floor)
        // Only allow rotation if F->A is within 45° of A->X
        if (this.buildingCentroid) {
            const fromCenterToCorner = cornerPosition.clone().sub(this.buildingCentroid).normalize(); // F->A
            const fromCornerToClick = projectedPoint.clone().sub(cornerPosition).normalize(); // A->X
            
            // Dot product > cos(45°) means angle < 45°
            // cos(45°) = √2/2 ≈ 0.707
            const dotProduct = fromCenterToCorner.dot(fromCornerToClick);
            if (dotProduct <= Math.SQRT1_2) { // Math.SQRT1_2 = 1/√2 = cos(45°)
                return false; // Click is not aligned enough with outward direction
            }
        }
        
        return true;
    }
    
    /**
     * Check if hovering over the building mesh for translation
     */
    checkBuildingMeshHover() {
        if (this.solidMesh) {
            // Temporarily change raycaster layer mask to include mesh layers
            const savedMask = this.raycaster.layers.mask;
            this.raycaster.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
            
            const intersects = this.raycaster.intersectObject(this.solidMesh, false);
            
            // Restore raycaster layer mask
            this.raycaster.layers.mask = savedMask;
            
            if (intersects.length > 0) {
                // Hovering over building mesh - show move cursor
                if (!this.hoveredHandle || !this.hoveredHandle.userData || !this.hoveredHandle.userData.isBuildingMesh) {
                    document.body.style.cursor = 'move';
                    this.hoveredHandle = {userData: {isBuildingMesh: true}};
                }
            } else {
                // Not hovering over anything
                if (this.hoveredHandle) {
                    document.body.style.cursor = 'default';
                    this.hoveredHandle = null;
                }
            }
        } else {
            // Not hovering over anything
            if (this.hoveredHandle) {
                document.body.style.cursor = 'default';
                this.hoveredHandle = null;
            }
        }
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
        
        // Check if clicking on a GUI element - menus should have priority
        let target = event.target;
        while (target) {
            if (target.classList && target.classList.contains('lil-gui')) {
                return; // Click is on GUI, don't handle it
            }
            target = target.parentElement;
        }
        
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
        
        // FIRST: Check intersection with actual handles (control points + roof center handle)
        // These should have priority over rotation rings
        const allHandles = [...this.controlPoints];
        if (this.roofCenterHandle) {
            allHandles.push(this.roofCenterHandle);
        }
        const intersects = this.raycaster.intersectObjects(allHandles, false);
        
        console.log("  Intersections found:", intersects.length);
        
        if (intersects.length > 0) {
            // Hit an actual handle
            this.draggingPoint = intersects[0].object;
            this.draggingVertexIndex = this.draggingPoint.userData.vertexIndex;
            this.isDragging = true;
            this.isRotating = false;
            
            console.log("  Started dragging vertex:", this.draggingVertexIndex);
            
            // Store the local up vector at this position
            this.dragLocalUp = getLocalUpVector(this.draggingPoint.position);
            
            // Disable camera controls while dragging
            if (view.controls) {
                view.controls.enabled = false;
            }
            
            event.stopPropagation();
            event.preventDefault();
            return; // Don't check rotation rings
        }
        
        // SECOND: Check for rotation ring click (only if NOT over actual handle)
        if (this.rotationHandles.length > 0) {
            const rotationIntersects = this.raycaster.intersectObjects(this.rotationHandles, false);
            
            if (rotationIntersects.length > 0) {
                // Get the closest rotation ring
                const rotationHandle = rotationIntersects[0].object;
                const intersectionPoint = rotationIntersects[0].point;
                
                if (rotationHandle.userData.cornerVertexIndex !== undefined && this.buildingCentroid) {
                    // Corner rotation ring (for building rotation)
                    const cornerVertexIndex = rotationHandle.userData.cornerVertexIndex;
                    
                    // Project intersection onto plane and check if outside handle radius
                    if (this.isOutsideHandleInPlane(cornerVertexIndex, intersectionPoint)) {
                        console.log("  Started rotation mode from corner", cornerVertexIndex);
                        this.isRotating = true;
                        this.isDragging = false;
                        
                        // Calculate initial angle in ground plane around building centroid
                        const localUp = getLocalUpVector(this.buildingCentroid);
                        const toIntersection = intersectionPoint.clone().sub(this.buildingCentroid);
                        const verticalComponent = toIntersection.dot(localUp);
                        const groundPoint = intersectionPoint.clone().sub(localUp.clone().multiplyScalar(verticalComponent));
                        
                        const toPoint = groundPoint.clone().sub(this.buildingCentroid);
                        // Use a reference axis perpendicular to localUp for angle calculation
                        const referenceAxis = new Vector3(1, 0, 0);
                        if (Math.abs(localUp.dot(referenceAxis)) > 0.9) {
                            referenceAxis.set(0, 1, 0); // Use Y if X is parallel to up
                        }
                        const tangent = new Vector3().crossVectors(localUp, referenceAxis).normalize();
                        this.rotationStartAngle = Math.atan2(
                            toPoint.dot(new Vector3().crossVectors(localUp, tangent)),
                            toPoint.dot(tangent)
                        );
                        
                        document.body.style.cursor = 'grabbing';
                        
                        // Disable camera controls while rotating
                        if (view.controls) {
                            view.controls.enabled = false;
                        }
                        
                        event.stopPropagation();
                        event.preventDefault();
                        return; // Don't check building mesh
                    }
                }
            }
        }
        
        // THIRD: Check for click on building mesh (for building translation)
        if (this.solidMesh) {
            // Temporarily change raycaster layer mask to include mesh layers
            const savedMask = this.raycaster.layers.mask;
            this.raycaster.layers.mask = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
            
            const meshIntersects = this.raycaster.intersectObject(this.solidMesh, false);
            
            // Restore raycaster layer mask
            this.raycaster.layers.mask = savedMask;
            
            if (meshIntersects.length > 0) {
                console.log("  Started building translation mode from mesh click");
                this.isDragging = true;
                this.isRotating = false;
                this.draggingPoint = {userData: {isBuildingMesh: true}};
                this.draggingVertexIndex = -1;
                
                // Store the initial intersection point for translation
                this.dragStartPoint = meshIntersects[0].point.clone();
                
                document.body.style.cursor = 'move';
                
                // Disable camera controls while translating
                if (view.controls) {
                    view.controls.enabled = false;
                }
                
                event.stopPropagation();
                event.preventDefault();
            }
        }
    }
    
    /**
     * Handle rotation while dragging
     */
    handleRotation(event) {
        const view = ViewMan.get("mainView");
        if (!view || !this.buildingCentroid) return;
        
        const mouseYUp = view.heightPx - (event.clientY - view.topPx);
        const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
        
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        // Create a ground plane at the building centroid
        const localUp = getLocalUpVector(this.buildingCentroid);
        const groundPlane = new Plane();
        groundPlane.setFromNormalAndCoplanarPoint(localUp, this.buildingCentroid);
        
        // Intersect ray with ground plane
        const intersectionPoint = new Vector3();
        if (this.raycaster.ray.intersectPlane(groundPlane, intersectionPoint)) {
            // Calculate current angle
            const toPoint = intersectionPoint.clone().sub(this.buildingCentroid);
            
            // Use same reference axis as in onPointerDown
            const referenceAxis = new Vector3(1, 0, 0);
            if (Math.abs(localUp.dot(referenceAxis)) > 0.9) {
                referenceAxis.set(0, 1, 0);
            }
            const tangent = new Vector3().crossVectors(localUp, referenceAxis).normalize();
            const currentAngle = Math.atan2(
                toPoint.dot(new Vector3().crossVectors(localUp, tangent)),
                toPoint.dot(tangent)
            );
            
            // Calculate rotation delta
            const rotationDelta = currentAngle - this.rotationStartAngle;
            
            // Rotate all vertices around the centroid
            this.vertices.forEach(vertex => {
                // Get vector from centroid to vertex
                const toVertex = vertex.position.clone().sub(this.buildingCentroid);
                
                // Decompose into vertical and horizontal components
                const verticalComponent = toVertex.dot(localUp);
                const horizontalVector = toVertex.clone().sub(localUp.clone().multiplyScalar(verticalComponent));
                
                // Rotate horizontal component around localUp axis
                const rotatedHorizontal = horizontalVector.clone().applyAxisAngle(localUp, rotationDelta);
                
                // Reconstruct position
                vertex.position.copy(
                    this.buildingCentroid.clone()
                        .add(rotatedHorizontal)
                        .add(localUp.clone().multiplyScalar(verticalComponent))
                );
            });
            
            // Update the start angle for next frame (incremental rotation)
            this.rotationStartAngle = currentAngle;
            
            // Rebuild mesh
            this.buildMesh();
            
            // Recreate control points
            this.createControlPoints();
            
            setRenderOne(true);
        }
        
        event.stopPropagation();
        event.preventDefault();
    }
    
    /**
     * Handle pointer move - drag the control point, rotate, or handle hover
     */
    onPointerMove(event) {
        if (!this.editMode) return;
        
        // Handle rotation
        if (this.isRotating) {
            this.handleRotation(event);
            return;
        }
        
        // Handle hover detection when not dragging
        if (!this.isDragging) {
            this.checkHandleHover(event);
            return;
        }
        
        if (!this.draggingPoint) return;
        
        const view = ViewMan.get("mainView");
        if (!view) return;
        
        const mouseYUp = view.heightPx - (event.clientY - view.topPx);
        const mouseRay = makeMouseRay(view, event.clientX, mouseYUp);
        
        this.raycaster.setFromCamera(mouseRay, view.camera);
        
        // Check if dragging the roof center handle or building mesh
        const isRoofCenter = this.draggingPoint.userData.isRoofCenter;
        const isBuildingMesh = this.draggingPoint.userData.isBuildingMesh;
        
        // Get the vertex being dragged (if not roof center or building mesh)
        const draggedVertex = (isRoofCenter || isBuildingMesh) ? null : this.vertices[this.draggingVertexIndex];
        const isTopVertex = !isRoofCenter && !isBuildingMesh && (draggedVertex && draggedVertex.type === 'top');
        
        let plane = new Plane();
        
        if (isBuildingMesh) {
            // For building mesh, create a horizontal plane for moving entire building
            const localUp = getLocalUpVector(this.buildingCentroid);
            plane.setFromNormalAndCoplanarPoint(localUp, this.dragStartPoint);
        } else if (isRoofCenter || isTopVertex) {
            // For roof center handle and top vertices, create a vertical plane facing the camera
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
            if (isBuildingMesh) {
                // For building mesh: move the entire building horizontally
                const displacement = newPosition.clone().sub(this.dragStartPoint);
                
                // Move all vertices by the same displacement
                this.vertices.forEach(vertex => {
                    vertex.position.add(displacement.clone());
                });
                
                // Update building centroid
                this.buildingCentroid.add(displacement);
                
                // Update drag start point for next frame (incremental translation)
                this.dragStartPoint.copy(newPosition);
                
            } else if (isRoofCenter || isTopVertex) {
                // For roof center handle and top vertices, calculate the new HEIGHT and apply to all tops
                // This keeps each top vertex directly above its corresponding bottom
                
                // Get a reference bottom vertex (use first one, or linked one for top vertex)
                let referenceBottomVertex;
                if (isRoofCenter) {
                    referenceBottomVertex = this.vertices.find(v => v.type === 'bottom');
                } else {
                    referenceBottomVertex = this.vertices[draggedVertex.linkedVertex];
                }
                
                const bottomPos = referenceBottomVertex.position;
                const localUp = getLocalUpVector(bottomPos);
                
                // Calculate what the new height would be
                const toTop = newPosition.clone().sub(bottomPos);
                let newHeight = toTop.dot(localUp);
                
                // Minimum height of 1 meter
                const minHeight = 1.0;
                if (newHeight < minHeight) {
                    newHeight = minHeight;
                }
                
                // Apply this HEIGHT to all top vertices
                const topVertices = this.vertices.filter(v => v.type === 'top');
                topVertices.forEach(topVertex => {
                    const linkedBottom = this.vertices[topVertex.linkedVertex];
                    const upVector = getLocalUpVector(linkedBottom.position);
                    
                    // Position this top vertex directly above its bottom at newHeight
                    topVertex.position.copy(linkedBottom.position.clone().add(upVector.multiplyScalar(newHeight)));
                });
                
            } else {
                // For bottom vertices, move the vertex and its two neighbors
                // to maintain the shape of the building
                
                // Store the original position before moving
                const oldPosition = draggedVertex.position.clone();
                
                // Calculate the displacement vector for the dragged vertex
                const displacement = newPosition.clone().sub(oldPosition);
                
                // Move the dragged vertex
                draggedVertex.position.copy(newPosition);
                
                // Find the two neighbors using the ring structure
                const neighbor1Idx = draggedVertex.next;
                const neighbor2Idx = draggedVertex.prev;
                const neighbor1 = this.vertices[neighbor1Idx];
                const neighbor2 = this.vertices[neighbor2Idx];
                
                // Find the opposite corner (the vertex that's not this one or the neighbors)
                // For a rectangle, bottom vertices are indices 0-3
                let oppositeIdx = -1;
                for (let i = 0; i < 4; i++) {
                    if (i !== this.draggingVertexIndex && i !== neighbor1Idx && i !== neighbor2Idx) {
                        oppositeIdx = i;
                        break;
                    }
                }
                
                if (oppositeIdx !== -1) {
                    const opposite = this.vertices[oppositeIdx];
                    
                    // Move neighbor1: project A's displacement onto the edge connecting opposite to neighbor1
                    const edgeToNeighbor1 = neighbor1.position.clone().sub(opposite.position);
                    const edgeDir1 = edgeToNeighbor1.clone().normalize();
                    const projectedMovement1 = displacement.dot(edgeDir1);
                    neighbor1.position.add(edgeDir1.multiplyScalar(projectedMovement1));
                    
                    // Update the linked top vertex for neighbor1
                    const linkedTop1 = this.vertices[neighbor1.linkedVertex];
                    const localUp1 = getLocalUpVector(neighbor1.position);
                    const toTop1 = linkedTop1.position.clone().sub(neighbor1.position);
                    const currentHeight1 = toTop1.dot(localUp1);
                    linkedTop1.position.copy(neighbor1.position.clone().add(localUp1.multiplyScalar(currentHeight1)));
                    
                    // Move neighbor2: project A's displacement onto the edge connecting opposite to neighbor2
                    const edgeToNeighbor2 = neighbor2.position.clone().sub(opposite.position);
                    const edgeDir2 = edgeToNeighbor2.clone().normalize();
                    const projectedMovement2 = displacement.dot(edgeDir2);
                    neighbor2.position.add(edgeDir2.multiplyScalar(projectedMovement2));
                    
                    // Update the linked top vertex for neighbor2
                    const linkedTop2 = this.vertices[neighbor2.linkedVertex];
                    const localUp2 = getLocalUpVector(neighbor2.position);
                    const toTop2 = linkedTop2.position.clone().sub(neighbor2.position);
                    const currentHeight2 = toTop2.dot(localUp2);
                    linkedTop2.position.copy(neighbor2.position.clone().add(localUp2.multiplyScalar(currentHeight2)));
                }
                
                // Move the linked top vertex for the dragged vertex to stay directly above
                const linkedTop = this.vertices[draggedVertex.linkedVertex];
                const localUp = getLocalUpVector(draggedVertex.position);
                
                // Calculate current height of the linked top
                const toTop = linkedTop.position.clone().sub(draggedVertex.position);
                const currentHeight = toTop.dot(localUp);
                
                // Reposition top to maintain its height above the new bottom position
                linkedTop.position.copy(draggedVertex.position.clone().add(localUp.multiplyScalar(currentHeight)));
            }
            
            // Rebuild mesh
            this.buildMesh();
            
            // Recreate control points to update their positions
            this.createControlPoints();
            
            // Re-identify the dragging point
            if (isBuildingMesh) {
                // Keep the fake dragging point for building mesh
                this.draggingPoint = {userData: {isBuildingMesh: true}};
            } else if (isRoofCenter) {
                this.draggingPoint = this.roofCenterHandle;
            } else {
                this.draggingPoint = this.controlPoints[this.draggingVertexIndex];
            }
            
            setRenderOne(true);
        }
        
        event.stopPropagation();
        event.preventDefault();
    }
    
    /**
     * Handle pointer up - stop dragging or rotating
     */
    onPointerUp(event) {
        if (this.isDragging || this.isRotating) {
            const view = ViewMan.get("mainView");
            if (view && view.controls) {
                view.controls.enabled = true;
            }
        }
        
        this.isDragging = false;
        this.isRotating = false;
        this.draggingPoint = null;
        this.draggingVertexIndex = -1;
        this.dragLocalUp = null;
        
        // Check hover after releasing to update cursor appropriately
        if (this.editMode) {
            this.checkHandleHover(event);
        }
    }
    
    /**
     * Create GUI folder for this building
     */
    createGUIFolder() {
        if (!guiMenus.contents) return;
        
        const folderID = `folder_${this.buildingID}`;
        this.guiFolder = guiMenus.contents.addFolder(this.name);
        this.guiFolder.domElement.id = folderID;
        
        // Name editor
        this.guiFolder.add(this, 'name').name('Name').onChange(() => {
            // Update folder title
            this.guiFolder.title = this.name;
            setRenderOne(true);
        });
        
        // Edit mode checkbox
        const editModeData = {editMode: this.editMode};
        this.guiFolder.add(editModeData, 'editMode').name('Edit Mode').onChange((value) => {
            this.setEditMode(value);
        });
        
        // Material folder
        this.materialFolder = this.guiFolder.addFolder('Material').close();
        
        this.materialFolder.add(this, 'materialType', ['basic', 'lambert', 'phong', 'physical'])
            .name('Type')
            .onChange(() => this.rebuildMaterial());
        
        this.materialFolder.addColor(this, 'materialColor')
            .name('Color')
            .onChange(() => this.rebuildMaterial());
        
        this.materialFolder.add(this, 'materialOpacity', 0, 1, 0.01)
            .name('Opacity')
            .onChange(() => this.rebuildMaterial());
        
        this.materialFolder.add(this, 'materialTransparent')
            .name('Transparent')
            .onChange(() => this.rebuildMaterial());
        
        this.materialFolder.add(this, 'materialWireframe')
            .name('Wireframe')
            .onChange(() => this.rebuildMaterial());
        
        this.materialFolder.add(this, 'materialDepthTest')
            .name('Depth Test')
            .onChange(() => this.rebuildMaterial());
        
        // Delete button
        const actions = {
            delete: () => {
                if (confirm(`Delete building "${this.name}"?`)) {
                    // Manager will handle deletion
                    Synth3DManager.removeBuilding(this.buildingID);
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
            const lla = EUSToLLA(v.position);
            return {
                position: [lla.x, lla.y, lla.z],
                type: v.type,
                next: v.next,
                prev: v.prev,
                linkedVertex: v.linkedVertex
            };
        });
        
        return {
            id: this.buildingID,
            name: this.name,
            vertices: verticesLLA,
            faces: this.faces.map(f => ({indices: [...f.indices]})),
            material: this.materialType,
            color: this.materialColor,
            opacity: this.materialOpacity,
            transparent: this.materialTransparent,
            depthTest: this.materialDepthTest,
            wireframe: this.materialWireframe
        };
    }
    
    /**
     * Deserialize from saved data
     */
    static deserialize(data) {
        // Convert LLA vertices back to EUS
        const verticesEUS = data.vertices.map(v => {
            // Handle both old format (just position) and new format (with metadata)
            if (v.position) {
                const eus = LLAToEUS(v.position[0], v.position[1], v.position[2]);
                return {
                    position: eus,
                    type: v.type || 'free',
                    next: v.next !== undefined ? v.next : -1,
                    prev: v.prev !== undefined ? v.prev : -1,
                    linkedVertex: v.linkedVertex !== undefined ? v.linkedVertex : -1
                };
            } else {
                // Old format
                return {
                    position: LLAToEUS(v.lat, v.lon, v.alt),
                    type: 'free',
                    next: -1,
                    prev: -1,
                    linkedVertex: -1
                };
            }
        });
        
        return new CNodeSynthBuilding({
            id: data.id,
            name: data.name,
            vertices: verticesEUS,
            faces: data.faces,
            material: data.material,
            color: data.color,
            opacity: data.opacity,
            transparent: data.transparent,
            depthTest: data.depthTest,
            wireframe: data.wireframe
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