import {FileManager} from "./Globals";
import {getFileExtension} from "./utils";
import {DRACOLoader} from "three/addons/loaders/DRACOLoader.js";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {PLYLoader} from "three/addons/loaders/PLYLoader.js";
import {Group, Mesh, MeshStandardMaterial, Points, PointsMaterial} from "three";

const SUPPORTED_MODEL_EXTENSIONS = Object.freeze(["glb", "ply"]);
const supportedModelExtensions = new Set(SUPPORTED_MODEL_EXTENSIONS);

function coerceArrayBuffer(data, filename) {
    if (data instanceof ArrayBuffer) {
        return data;
    }

    if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }

    throw new Error(`Unsupported model data for "${filename}"`);
}

function getDisplayModelName(filename) {
    return String(filename).replace(/\\/g, "/").split("/").pop() || String(filename);
}

function createDRACOLoader() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("./libs/draco/");
    return dracoLoader;
}

function createGLTFLoader() {
    const loader = new GLTFLoader();
    const dracoLoader = createDRACOLoader();
    loader.setDRACOLoader(dracoLoader);
    return loader;
}

function checkModelHierarchy(gltf, filename) {
    const issues = [];
    const meshesWithArmature = [];

    gltf.scene.traverse((node) => {
        if (!node.isMesh) {
            return;
        }

        let current = node;
        let hasArmature = false;
        const path = [];

        while (current.parent && current.parent !== gltf.scene) {
            current = current.parent;
            const nodeName = current.name || "unnamed";
            path.unshift(nodeName);

            if (nodeName.toLowerCase().includes("armature")) {
                hasArmature = true;
            }
        }

        if (hasArmature) {
            meshesWithArmature.push({
                name: node.name || "unnamed mesh",
                path,
            });
        }
    });

    if (meshesWithArmature.length > 0) {
        issues.push("Meshes parented to Armature detected. This can cause vertex distortion when positioned far from origin. Consider flattening the hierarchy in Blender by unparenting meshes from the Armature (Select mesh -> Option+P -> Clear Parent, then delete the Armature node).");
    }

    if (issues.length > 0) {
        const message = `⚠️ Model Hierarchy Warning: ${filename}\n\n${issues.join("\n\n")}\n\nThe model will still load, but may exhibit visual artifacts at large distances from origin.`;
        console.warn(message);
        alert(message);
    }
}

function isDroppedModelFile(file) {
    return !String(file).startsWith("data/models/");
}

function shouldNormalizeDroppedModelMaterial(file, material) {
    if (!isDroppedModelFile(file)) {
        return false;
    }

    if (!(material?.isMeshStandardMaterial || material?.isMeshPhysicalMaterial)) {
        return false;
    }

    if (material.userData?.gltfExtensions?.KHR_materials_unlit) {
        return false;
    }

    if (!material.map || material.envMap || material.metalnessMap) {
        return false;
    }

    return (material.metalness ?? 0) >= 0.95;
}

function normalizeDroppedModelMaterials(scene, file) {
    scene.traverse((child) => {
        if (!child.isMesh) {
            return;
        }

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
            if (!shouldNormalizeDroppedModelMaterial(file, material)) {
                continue;
            }

            material.metalness = 0;
            material.needsUpdate = true;
            material.userData ??= {};
            material.userData.sitrecDroppedModelMaterialFix = "demetalized-for-ambient";
        }
    });
}

function headerTextForPLY(data) {
    const buffer = coerceArrayBuffer(data, "PLY");
    const scanBytes = Math.min(buffer.byteLength, 65536);
    const headerProbe = new TextDecoder("utf-8").decode(buffer.slice(0, scanBytes));
    const headerMatch = headerProbe.match(/^([\s\S]*?end_header(?:\r\n|\r|\n))/i);
    return headerMatch ? headerMatch[1] : headerProbe;
}

function plyHasFaces(data) {
    const headerText = headerTextForPLY(data);
    const faceMatch = headerText.match(/element\s+face\s+(\d+)/i);
    return faceMatch ? Number(faceMatch[1]) > 0 : false;
}

function createPLYModel(geometry, filename, sourceData) {
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const hasFaces = plyHasFaces(sourceData);
    const usesVertexColors = geometry.getAttribute("color") !== undefined;

    const root = new Group();
    root.name = getDisplayModelName(filename);
    root.userData.sitrecModelFormat = "ply";
    root.userData.sitrecPlyHasFaces = hasFaces;

    if (hasFaces && geometry.getAttribute("normal") === undefined) {
        geometry.computeVertexNormals();
    }

    if (hasFaces) {
        const material = new MeshStandardMaterial({
            color: usesVertexColors ? 0xffffff : 0xbfbfbf,
            vertexColors: usesVertexColors,
        });
        const mesh = new Mesh(geometry, material);
        mesh.name = root.name;
        // PLY exports commonly preserve Blender/Z-up coordinates.
        // Convert to Sitrec's Y-up convention while keeping the wrapper group unrotated.
        mesh.rotateX(-Math.PI / 2);
        mesh.updateMatrix();
        root.add(mesh);
    } else {
        const material = new PointsMaterial({
            color: usesVertexColors ? 0xffffff : 0xbfbfbf,
            size: 1,
            sizeAttenuation: true,
            vertexColors: usesVertexColors,
        });
        const points = new Points(geometry, material);
        points.name = root.name;
        points.rotateX(-Math.PI / 2);
        points.updateMatrix();
        root.add(points);
    }

    return {
        scene: root,
        format: "ply",
        source: geometry,
    };
}

function parseGLBModel(data, filename) {
    return new Promise((resolve, reject) => {
        const loader = createGLTFLoader();
        loader.parse(coerceArrayBuffer(data, filename), "", (gltf) => {
            checkModelHierarchy(gltf, filename);
            normalizeDroppedModelMaterials(gltf.scene, filename);

            resolve({
                scene: gltf.scene,
                format: "glb",
                source: gltf,
            });
        }, (error) => {
            reject(error);
        });
    });
}

function parsePLYModel(data, filename) {
    const loader = new PLYLoader();
    const geometry = loader.parse(coerceArrayBuffer(data, filename));
    return Promise.resolve(createPLYModel(geometry, filename, data));
}

const modelParsers = {
    glb: parseGLBModel,
    ply: parsePLYModel,
};

function attachCallbacks(promise, onLoad, onError) {
    if (onLoad || onError) {
        promise.then((result) => {
            if (onLoad) {
                onLoad(result);
            }
        }).catch((error) => {
            if (onError) {
                onError(error);
            }
        });
    }

    return promise;
}

export function getModelFileExtension(filename) {
    return getFileExtension(filename).toLowerCase();
}

export function isSupportedModelFile(filename) {
    return supportedModelExtensions.has(getModelFileExtension(filename));
}

export function getSupportedModelExtensions() {
    return [...SUPPORTED_MODEL_EXTENSIONS];
}

export function parseModelData(filename, data, onLoad, onError) {
    const extension = getModelFileExtension(filename);
    const parser = modelParsers[extension];

    const promise = parser
        ? parser(data, filename)
        : Promise.reject(new Error(`Unsupported model format "${extension}" for "${filename}"`));

    return attachCallbacks(promise, onLoad, onError);
}

export function loadModelAsset(filename, onLoad, onError) {
    const promise = FileManager.loadAsset(filename, filename).then((asset) => {
        if (!asset) {
            throw new Error(`No asset data returned for "${filename}"`);
        }
        return parseModelData(filename, asset.parsed);
    });

    return attachCallbacks(promise, onLoad, onError);
}
