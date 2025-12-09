// CNode3DModel.js - CNode3DModel
// a 3D model node - a gltf model, with the model loaded from a file
import {CNode3DGroup} from "./CNode3DGroup";
import {FileManager} from "../Globals";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {DRACOLoader} from "three/addons/loaders/DRACOLoader.js";
import {disposeScene} from "../threeExt";
import {NoColorSpace} from "three";

// Create and configure a DRACO loader
function createDRACOLoader() {
    const dracoLoader = new DRACOLoader();
    // Set the path to the DRACO decoder files (served locally)
    dracoLoader.setDecoderPath('./libs/draco/');
    return dracoLoader;
}

// Create and configure a GLTF loader with DRACO support
function createGLTFLoader() {
    const loader = new GLTFLoader();
    const dracoLoader = createDRACOLoader();
    loader.setDRACOLoader(dracoLoader);
    return loader;
}

// Check for hierarchy depth issues that can cause floating-point precision errors
function checkModelHierarchy(gltf, filename) {
    const issues = [];
    const meshesWithArmature = [];
    
    // Find all meshes parented to an Armature
    gltf.scene.traverse((node) => {
        if (node.isMesh) {
            let current = node;
            let hasArmature = false;
            const path = [];
            
            while (current.parent && current.parent !== gltf.scene) {
                current = current.parent;
                const nodeName = current.name || 'unnamed';
                path.unshift(nodeName);
                
                // Check if this node is an Armature (common Blender export pattern)
                if (nodeName.toLowerCase().includes('armature')) {
                    hasArmature = true;
                }
            }
            
            if (hasArmature) {
                meshesWithArmature.push({
                    name: node.name || 'unnamed mesh',
                    path: path
                });
            }
        }
    });
    
    // Check for meshes parented to Armatures (can cause precision issues with large translations)
    if (meshesWithArmature.length > 0) {
        issues.push(`Meshes parented to Armature detected. This can cause vertex distortion when positioned far from origin. Consider flattening the hierarchy in Blender by unparenting meshes from the Armature (Select mesh → Option+P → Clear Parent, then delete the Armature node).`);
    }
    
    if (issues.length > 0) {
        const message = `⚠️ Model Hierarchy Warning: ${filename}\n\n${issues.join('\n\n')}\n\nThe model will still load, but may exhibit visual artifacts at large distances from origin.`;
        console.warn(message);
        alert(message);
    }
}

export function loadGLTFModel(file, callback) {

    console.log("Async Loading asset for", file);
    FileManager.loadAsset(file, file).then( (asset) => {
        const loader = createGLTFLoader()
        loader.parse(asset.parsed, "", gltf => {
            console.log("(after async) Parsed asset for", file, " now traversing...");
            gltf.scene.traverse((child) => {
                if (child.isMesh) {
                    if (child.material.map) child.material.map.colorSpace = NoColorSpace;
                    if (child.material.emissiveMap) child.material.emissiveMap.colorSpace = NoColorSpace;
                }
            });
            
            // Check for hierarchy issues
            checkModelHierarchy(gltf, file);
            
            callback(gltf);
        })
    })
}

export class CNode3DModel extends CNode3DGroup {
    constructor(v) {
        super(v);

        const data = FileManager.get(v.TargetObjectFile ?? "TargetObjectFile")
        const filename = v.TargetObjectFile ?? "TargetObjectFile"

        const loader = createGLTFLoader()
        loader.parse(data, "", (gltf2) => {
            // Check for hierarchy issues
            checkModelHierarchy(gltf2, filename);
            
            this.model = gltf2.scene //.getObjectByName('FA-18F')
            this.model.scale.setScalar(1);
            this.model.visible = true
            this.group.add(this.model)
        })

    }

    dispose()
    {
        this.group.remove(this.model)
        disposeScene(this.model)
        this.model = undefined
        super.dispose()
    }

    modSerialize() {
        return {
            ...super.modSerialize(),
            tiltType: this.tiltType,
        }
    }

    modDeserialize(v) {
        super.modDeserialize(v)
        this.tiltType = v.tiltType
    }

    update(f) {
        super.update(f)
        this.recalculate() // every frame so scale is correct after the jet loads

    }

    recalculate() {
        super.recalculate()
        this.propagateLayerMask()

    }

}