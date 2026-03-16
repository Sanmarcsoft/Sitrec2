import {FileManager} from "./Globals";
import {getFileExtension, m2f, stripURLSuffixPreservingHashParameters} from "./utils";
import {sharedUniforms} from "./js/map33/material/SharedUniforms";
import {DRACOLoader} from "three/addons/loaders/DRACOLoader.js";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {PLYLoader} from "three/addons/loaders/PLYLoader.js";
import {
    BufferAttribute,
    Color,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    MeshStandardMaterial,
    NormalBlending,
    PlaneGeometry,
    Points,
    PointsMaterial,
    ShaderMaterial,
} from "three";

const SUPPORTED_MODEL_EXTENSIONS = Object.freeze(["glb", "ply"]);
const supportedModelExtensions = new Set(SUPPORTED_MODEL_EXTENSIONS);
const SH_C0 = 0.28209479177387814;

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
    const cleanFilename = stripURLSuffixPreservingHashParameters(filename);
    return cleanFilename.replace(/\\/g, "/").split("/").pop() || cleanFilename;
}

const filenameParameterHandlers = Object.freeze({
    L: (parameters, value, units) => {
        const modelLengthFeet = parseFilenameModelLengthToFeet(value, units);
        if (modelLengthFeet !== null) {
            parameters.modelLength = modelLengthFeet;
        }
    },
});

function parseFilenameModelLengthToFeet(value, units) {
    const normalizedUnits = units?.toLowerCase() ?? "";

    switch (normalizedUnits) {
        case "":
        case "f":
        case "ft":
        case "feet":
            return value;

        case "m":
        case "meter":
        case "meters":
            return m2f(value);

        default:
            return null;
    }
}

export function extractModelFilenameParameters(filename) {
    const parameters = {};
    const displayName = getDisplayModelName(filename);

    for (const block of displayName.matchAll(/#([^#]+)#/g)) {
        const blockText = block[1];
        for (const match of blockText.matchAll(/([A-Za-z])\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*([A-Za-z]+)?/g)) {
            const key = match[1].toUpperCase();
            const value = Number.parseFloat(match[2]);
            const units = match[3];
            if (!Number.isFinite(value)) {
                continue;
            }

            const handler = filenameParameterHandlers[key];
            if (handler) {
                handler(parameters, value, units);
            }
        }
    }

    return parameters;
}

function attachFilenameParameters(modelAsset, filename) {
    const filenameParameters = extractModelFilenameParameters(filename);
    modelAsset.filenameParameters = filenameParameters;
    modelAsset.scene.userData ??= {};
    modelAsset.scene.userData.sitrecFilenameParameters = filenameParameters;
    return modelAsset;
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

function setPLYCustomPropertyMappings(loader) {
    loader.setCustomPropertyNameMapping({
        splatColorDc: ["f_dc_0", "f_dc_1", "f_dc_2"],
        splatScale: ["scale_0", "scale_1", "scale_2"],
        splatRotation: ["rot_0", "rot_1", "rot_2", "rot_3"],
        splatOpacity: ["opacity"],
    });
}

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

function sigmoid(value) {
    return 1 / (1 + Math.exp(-value));
}

function ensurePLYPointColors(geometry) {
    if (geometry.getAttribute("color")) {
        return geometry.getAttribute("color");
    }

    const splatColorDc = geometry.getAttribute("splatColorDc");
    if (!splatColorDc) {
        return null;
    }

    const colors = new Float32Array(splatColorDc.count * 3);
    for (let i = 0; i < splatColorDc.count; i++) {
        const base = i * 3;
        colors[base] = clamp01(0.5 + SH_C0 * splatColorDc.array[base]);
        colors[base + 1] = clamp01(0.5 + SH_C0 * splatColorDc.array[base + 1]);
        colors[base + 2] = clamp01(0.5 + SH_C0 * splatColorDc.array[base + 2]);
    }

    const colorAttribute = new BufferAttribute(colors, 3);
    geometry.setAttribute("color", colorAttribute);
    return colorAttribute;
}

function ensurePLYPointOpacity(geometry) {
    const existing = geometry.getAttribute("splatOpacity");
    if (existing) {
        const normalized = new Float32Array(existing.count);
        for (let i = 0; i < existing.count; i++) {
            normalized[i] = clamp01(sigmoid(existing.array[i]));
        }
        const opacityAttribute = new BufferAttribute(normalized, 1);
        geometry.setAttribute("splatOpacity", opacityAttribute);
        return opacityAttribute;
    }

    const opacity = new Float32Array(geometry.getAttribute("position").count);
    opacity.fill(1);
    const opacityAttribute = new BufferAttribute(opacity, 1);
    geometry.setAttribute("splatOpacity", opacityAttribute);
    return opacityAttribute;
}

function ensurePLYPointSize(geometry) {
    const existing = geometry.getAttribute("splatSize");
    if (existing) {
        return existing;
    }

    const splatScale = geometry.getAttribute("splatScale");
    const sizes = new Float32Array(geometry.getAttribute("position").count);

    if (splatScale) {
        for (let i = 0; i < splatScale.count; i++) {
            const base = i * 3;
            const sx = Math.exp(splatScale.array[base]);
            const sy = Math.exp(splatScale.array[base + 1]);
            const sz = Math.exp(splatScale.array[base + 2]);
            sizes[i] = Math.max(sx, sy, sz) * 2.0;
        }
    } else {
        sizes.fill(1);
    }

    const sizeAttribute = new BufferAttribute(sizes, 1);
    geometry.setAttribute("splatSize", sizeAttribute);
    return sizeAttribute;
}

function createPLYPointCloudMaterial(geometry, filename) {
    const usesSplatAttributes = geometry.getAttribute("splatColorDc") !== undefined
        || geometry.getAttribute("splatScale") !== undefined
        || geometry.getAttribute("splatOpacity") !== undefined;
    const colorAttribute = ensurePLYPointColors(geometry);
    const opacityAttribute = ensurePLYPointOpacity(geometry);
    const sizeAttribute = ensurePLYPointSize(geometry);

    if (!usesSplatAttributes && !colorAttribute) {
        return new PointsMaterial({
            color: 0xbfbfbf,
            size: 2,
            sizeAttenuation: true,
        });
    }

    const fallbackColor = new Color(0xbfbfbf);
    const opaqueCutout = usesSplatAttributes;
    const vertexShader = `
        attribute float splatOpacity;
        attribute float splatSize;
        ${colorAttribute ? "attribute vec3 color;" : ""}

        uniform float viewportHeight;
        uniform float minPointSize;
        uniform float maxPointSize;
        uniform float sizeMultiplier;
        uniform vec3 fallbackColor;

        varying vec3 vColor;
        varying float vOpacity;
        varying float vDepth;

        void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

            float modelScaleX = length(modelMatrix[0].xyz);
            float modelScaleY = length(modelMatrix[1].xyz);
            float modelScaleZ = length(modelMatrix[2].xyz);
            float modelScale = max(modelScaleX, max(modelScaleY, modelScaleZ));
            float worldSize = max(0.0001, splatSize * modelScale * sizeMultiplier);
            float projectedSize = worldSize * viewportHeight * projectionMatrix[1][1] / max(-mvPosition.z, 0.0001);

            gl_PointSize = clamp(projectedSize, minPointSize, maxPointSize);
            gl_Position = projectionMatrix * mvPosition;
            vDepth = gl_Position.w;

            vOpacity = splatOpacity;
            ${colorAttribute ? "vColor = color;" : "vColor = fallbackColor;"}
        }
    `;

    const fragmentShader = `
        uniform float nearPlane;
        uniform float farPlane;

        varying vec3 vColor;
        varying float vOpacity;
        varying float vDepth;

        void main() {
            vec2 centered = gl_PointCoord * 2.0 - 1.0;
            float radiusSquared = dot(centered, centered);
            if (radiusSquared > 1.0) {
                discard;
            }

            ${opaqueCutout ? `
            if (vOpacity < 0.02) {
                discard;
            }
            gl_FragColor = vec4(vColor, 1.0);
            ` : `
            float alpha = exp(-radiusSquared * 4.0) * vOpacity;
            if (alpha < 0.08) {
                discard;
            }
            gl_FragColor = vec4(vColor, alpha);
            `}

            float z = (log2(max(nearPlane, 1.0 + vDepth)) / log2(1.0 + farPlane)) * 2.0 - 1.0;
            gl_FragDepthEXT = z * 0.5 + 0.5;
        }
    `;

    const material = new ShaderMaterial({
        name: `${getDisplayModelName(filename)} PLY Point Cloud`,
        vertexShader,
        fragmentShader,
        uniforms: {
            viewportHeight: {value: 1080},
            minPointSize: {value: 2.0},
            maxPointSize: {value: usesSplatAttributes ? 96.0 : 24.0},
            sizeMultiplier: {value: usesSplatAttributes ? 1.5 : 1.0},
            fallbackColor: {value: fallbackColor},
            ...sharedUniforms,
        },
        transparent: !opaqueCutout,
        depthTest: true,
        depthWrite: true,
        blending: NormalBlending,
    });

    material.userData ??= {};
    material.userData.sitrecPLYPointCloud = true;
    material.userData.sitrecUsesSplatAttributes = usesSplatAttributes;
    material.userData.sitrecPointCount = opacityAttribute.count;
    sizeAttribute.needsUpdate = true;

    return material;
}

function isGaussianSplatPLY(geometry) {
    return geometry.getAttribute("splatScale") !== undefined
        && geometry.getAttribute("splatRotation") !== undefined;
}

function createGaussianSplatGeometry(geometry) {
    const posAttr = geometry.getAttribute("position");
    const splatCount = posAttr.count;

    const colorAttr = ensurePLYPointColors(geometry);
    const opacityAttr = ensurePLYPointOpacity(geometry);
    const scaleAttr = geometry.getAttribute("splatScale");
    const rotAttr = geometry.getAttribute("splatRotation");

    // Build per-instance typed arrays
    const centers = new Float32Array(posAttr.array);
    const colors = colorAttr
        ? new Float32Array(colorAttr.array)
        : new Float32Array(splatCount * 3).fill(0.75);
    const opacities = new Float32Array(opacityAttr.array);

    // Apply exp() to log-space scale values
    const scales = new Float32Array(splatCount * 3);
    for (let i = 0; i < splatCount; i++) {
        const b = i * 3;
        scales[b] = Math.exp(scaleAttr.array[b]);
        scales[b + 1] = Math.exp(scaleAttr.array[b + 1]);
        scales[b + 2] = Math.exp(scaleAttr.array[b + 2]);
    }

    const rotations = new Float32Array(rotAttr.array);

    // Base quad: 2×2 plane with vertices at (±1, ±1, 0)
    const baseQuad = new PlaneGeometry(2, 2);
    const instancedGeometry = new InstancedBufferGeometry();
    instancedGeometry.index = baseQuad.index;
    instancedGeometry.setAttribute("position", baseQuad.getAttribute("position"));

    instancedGeometry.setAttribute("splatCenter", new InstancedBufferAttribute(centers, 3));
    instancedGeometry.setAttribute("splatColor", new InstancedBufferAttribute(colors, 3));
    instancedGeometry.setAttribute("splatOpacity", new InstancedBufferAttribute(opacities, 1));
    instancedGeometry.setAttribute("splatScale", new InstancedBufferAttribute(scales, 3));
    instancedGeometry.setAttribute("splatRotation", new InstancedBufferAttribute(rotations, 4));
    instancedGeometry.instanceCount = splatCount;

    return instancedGeometry;
}

function createGaussianSplatMaterial(filename) {
    const vertexShader = /* glsl */ `
        attribute vec3 splatCenter;
        attribute vec3 splatColor;
        attribute float splatOpacity;
        attribute vec3 splatScale;
        attribute vec4 splatRotation;

        uniform float viewportWidth;
        uniform float viewportHeight;

        varying vec2 vPosition;
        varying vec3 vColor;
        varying float vOpacity;
        varying float vDepth;

        mat3 quatToMat3(vec4 q) {
            float qw = q.x, qx = q.y, qy = q.z, qz = q.w;
            float x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
            float xx = qx * x2, xy = qx * y2, xz = qx * z2;
            float yy = qy * y2, yz = qy * z2, zz = qz * z2;
            float wx = qw * x2, wy = qw * y2, wz = qw * z2;
            return mat3(
                1.0 - (yy + zz), xy + wz, xz - wy,
                xy - wz, 1.0 - (xx + zz), yz + wx,
                xz + wy, yz - wx, 1.0 - (xx + yy)
            );
        }

        void main() {
            vec4 viewCenter = modelViewMatrix * vec4(splatCenter, 1.0);

            if (viewCenter.z > 0.0) {
                gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                vOpacity = 0.0;
                return;
            }

            mat3 R = quatToMat3(splatRotation);
            mat3 S = mat3(
                splatScale.x, 0.0, 0.0,
                0.0, splatScale.y, 0.0,
                0.0, 0.0, splatScale.z
            );
            mat3 M_view = mat3(modelViewMatrix) * R * S;

            float tx = viewCenter.x;
            float ty = viewCenter.y;
            float tz = viewCenter.z;
            float tz2 = tz * tz;
            float focalX = projectionMatrix[0][0] * viewportWidth * 0.5;
            float focalY = projectionMatrix[1][1] * viewportHeight * 0.5;

            float j00 = focalX / tz;
            float j02 = -focalX * tx / tz2;
            float j11 = focalY / tz;
            float j12 = -focalY * ty / tz2;

            vec3 T0 = vec3(
                j00 * M_view[0][0] + j02 * M_view[0][2],
                j00 * M_view[1][0] + j02 * M_view[1][2],
                j00 * M_view[2][0] + j02 * M_view[2][2]
            );
            vec3 T1 = vec3(
                j11 * M_view[0][1] + j12 * M_view[0][2],
                j11 * M_view[1][1] + j12 * M_view[1][2],
                j11 * M_view[2][1] + j12 * M_view[2][2]
            );

            float cov2d_00 = dot(T0, T0) + 0.3;
            float cov2d_01 = dot(T0, T1);
            float cov2d_11 = dot(T1, T1) + 0.3;

            float tr = cov2d_00 + cov2d_11;
            float det = cov2d_00 * cov2d_11 - cov2d_01 * cov2d_01;
            float disc = sqrt(max(0.25 * tr * tr - det, 0.0));
            float lambda1 = max(0.5 * tr + disc, 0.1);
            float lambda2 = max(0.5 * tr - disc, 0.1);

            vec2 v1;
            if (abs(cov2d_01) > 0.0001) {
                v1 = normalize(vec2(cov2d_01, lambda1 - cov2d_00));
            } else {
                v1 = (cov2d_00 >= cov2d_11) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            }
            vec2 v2 = vec2(-v1.y, v1.x);

            float radius1 = 3.0 * sqrt(lambda1);
            float radius2 = 3.0 * sqrt(lambda2);

            float maxRadius = max(radius1, radius2);
            if (maxRadius > 2048.0) {
                float s = 2048.0 / maxRadius;
                radius1 *= s;
                radius2 *= s;
            }

            vec2 screenOffset = v1 * position.x * radius1 + v2 * position.y * radius2;

            vec4 clipCenter = projectionMatrix * viewCenter;
            gl_Position = clipCenter + vec4(
                screenOffset.x * 2.0 / viewportWidth * clipCenter.w,
                screenOffset.y * 2.0 / viewportHeight * clipCenter.w,
                0.0, 0.0
            );

            vPosition = position.xy;
            vColor = splatColor;
            vOpacity = splatOpacity;
            vDepth = clipCenter.w;
        }
    `;

    const fragmentShader = /* glsl */ `
        uniform float nearPlane;
        uniform float farPlane;

        varying vec2 vPosition;
        varying vec3 vColor;
        varying float vOpacity;
        varying float vDepth;

        void main() {
            float power = -4.5 * dot(vPosition, vPosition);
            if (power < -16.0) discard;

            float alpha = vOpacity * exp(power);
            if (alpha < 1.0 / 255.0) discard;

            gl_FragColor = vec4(vColor, alpha);

            float z = (log2(max(nearPlane, 1.0 + vDepth)) / log2(1.0 + farPlane)) * 2.0 - 1.0;
            gl_FragDepthEXT = z * 0.5 + 0.5;
        }
    `;

    const material = new ShaderMaterial({
        name: `${getDisplayModelName(filename)} Gaussian Splat`,
        vertexShader,
        fragmentShader,
        uniforms: {
            viewportWidth: {value: 1920},
            viewportHeight: {value: 1080},
            ...sharedUniforms,
        },
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: NormalBlending,
    });

    material.userData ??= {};
    material.userData.sitrecGaussianSplat = true;

    return material;
}

function createSplatSortState(splatCount, instancedGeometry) {
    const centers = instancedGeometry.getAttribute("splatCenter").array;
    const colors = instancedGeometry.getAttribute("splatColor").array;
    const opacities = instancedGeometry.getAttribute("splatOpacity").array;
    const scales = instancedGeometry.getAttribute("splatScale").array;
    const rotations = instancedGeometry.getAttribute("splatRotation").array;

    let combGap = splatCount;
    let lastCamX = NaN;
    let lastCamY = NaN;
    let lastCamZ = NaN;

    function swapInstances(i, j) {
        let t;
        const i3 = i * 3, j3 = j * 3;
        t = centers[i3]; centers[i3] = centers[j3]; centers[j3] = t;
        t = centers[i3 + 1]; centers[i3 + 1] = centers[j3 + 1]; centers[j3 + 1] = t;
        t = centers[i3 + 2]; centers[i3 + 2] = centers[j3 + 2]; centers[j3 + 2] = t;

        t = colors[i3]; colors[i3] = colors[j3]; colors[j3] = t;
        t = colors[i3 + 1]; colors[i3 + 1] = colors[j3 + 1]; colors[j3 + 1] = t;
        t = colors[i3 + 2]; colors[i3 + 2] = colors[j3 + 2]; colors[j3 + 2] = t;

        t = opacities[i]; opacities[i] = opacities[j]; opacities[j] = t;

        t = scales[i3]; scales[i3] = scales[j3]; scales[j3] = t;
        t = scales[i3 + 1]; scales[i3 + 1] = scales[j3 + 1]; scales[j3 + 1] = t;
        t = scales[i3 + 2]; scales[i3 + 2] = scales[j3 + 2]; scales[j3 + 2] = t;

        const i4 = i * 4, j4 = j * 4;
        t = rotations[i4]; rotations[i4] = rotations[j4]; rotations[j4] = t;
        t = rotations[i4 + 1]; rotations[i4 + 1] = rotations[j4 + 1]; rotations[j4 + 1] = t;
        t = rotations[i4 + 2]; rotations[i4 + 2] = rotations[j4 + 2]; rotations[j4 + 2] = t;
        t = rotations[i4 + 3]; rotations[i4 + 3] = rotations[j4 + 3]; rotations[j4 + 3] = t;
    }

    function markAttributesForUpload() {
        instancedGeometry.getAttribute("splatCenter").needsUpdate = true;
        instancedGeometry.getAttribute("splatColor").needsUpdate = true;
        instancedGeometry.getAttribute("splatOpacity").needsUpdate = true;
        instancedGeometry.getAttribute("splatScale").needsUpdate = true;
        instancedGeometry.getAttribute("splatRotation").needsUpdate = true;
    }

    function binSort(cx, cy, cz) {
        const n = splatCount;
        const distances = new Float32Array(n);
        let minDist = Infinity, maxDist = -Infinity;

        for (let i = 0; i < n; i++) {
            const i3 = i * 3;
            const dx = centers[i3] - cx;
            const dy = centers[i3 + 1] - cy;
            const dz = centers[i3 + 2] - cz;
            const d = dx * dx + dy * dy + dz * dz;
            distances[i] = d;
            if (d < minDist) minDist = d;
            if (d > maxDist) maxDist = d;
        }

        const range = maxDist - minDist;
        if (range <= 0) return;

        const NUM_BINS = Math.min(n, 65536);
        const binCounts = new Uint32Array(NUM_BINS);
        const binIndices = new Uint32Array(n);

        for (let i = 0; i < n; i++) {
            const bin = Math.min(NUM_BINS - 1, Math.floor((distances[i] - minDist) / range * NUM_BINS));
            binIndices[i] = bin;
            binCounts[bin]++;
        }

        const binStarts = new Uint32Array(NUM_BINS);
        let sum = 0;
        let maxBinCount = 0;
        for (let b = NUM_BINS - 1; b >= 0; b--) {
            binStarts[b] = sum;
            sum += binCounts[b];
            if (binCounts[b] > maxBinCount) maxBinCount = binCounts[b];
        }

        const binCurrent = binStarts.slice();
        const newCenters = new Float32Array(n * 3);
        const newColors = new Float32Array(n * 3);
        const newOpacities = new Float32Array(n);
        const newScales = new Float32Array(n * 3);
        const newRotations = new Float32Array(n * 4);

        for (let i = 0; i < n; i++) {
            const dest = binCurrent[binIndices[i]]++;
            const s3 = i * 3, d3 = dest * 3;
            newCenters[d3] = centers[s3]; newCenters[d3 + 1] = centers[s3 + 1]; newCenters[d3 + 2] = centers[s3 + 2];
            newColors[d3] = colors[s3]; newColors[d3 + 1] = colors[s3 + 1]; newColors[d3 + 2] = colors[s3 + 2];
            newOpacities[dest] = opacities[i];
            newScales[d3] = scales[s3]; newScales[d3 + 1] = scales[s3 + 1]; newScales[d3 + 2] = scales[s3 + 2];
            const s4 = i * 4, d4 = dest * 4;
            newRotations[d4] = rotations[s4]; newRotations[d4 + 1] = rotations[s4 + 1];
            newRotations[d4 + 2] = rotations[s4 + 2]; newRotations[d4 + 3] = rotations[s4 + 3];
        }

        centers.set(newCenters);
        colors.set(newColors);
        opacities.set(newOpacities);
        scales.set(newScales);
        rotations.set(newRotations);

        combGap = maxBinCount;
        markAttributesForUpload();
    }

    function combSortPass(cx, cy, cz) {
        let swapped = false;
        const gap = combGap;

        for (let i = 0; i + gap < splatCount; i++) {
            const j = i + gap;
            const i3 = i * 3, j3 = j * 3;
            const dxi = centers[i3] - cx, dyi = centers[i3 + 1] - cy, dzi = centers[i3 + 2] - cz;
            const dxj = centers[j3] - cx, dyj = centers[j3 + 1] - cy, dzj = centers[j3 + 2] - cz;
            const distI = dxi * dxi + dyi * dyi + dzi * dzi;
            const distJ = dxj * dxj + dyj * dyj + dzj * dzj;

            if (distI < distJ) {
                swapInstances(i, j);
                swapped = true;
            }
        }

        combGap = Math.max(1, Math.floor(combGap / 1.3));

        if (swapped) {
            markAttributesForUpload();
        }
        return swapped;
    }

    return {
        sort(localCamX, localCamY, localCamZ) {
            if (splatCount < 2) return;

            const dx = localCamX - lastCamX;
            const dy = localCamY - lastCamY;
            const dz = localCamZ - lastCamZ;

            if (Number.isNaN(lastCamX) || dx * dx + dy * dy + dz * dz > 0.01) {
                binSort(localCamX, localCamY, localCamZ);
                lastCamX = localCamX;
                lastCamY = localCamY;
                lastCamZ = localCamZ;
            }

            for (let pass = 0; pass < 10; pass++) {
                if (!combSortPass(localCamX, localCamY, localCamZ)) break;
            }
        },
    };
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
    } else if (isGaussianSplatPLY(geometry)) {
        const instancedGeometry = createGaussianSplatGeometry(geometry);
        const material = createGaussianSplatMaterial(filename);
        const splatMesh = new Mesh(instancedGeometry, material);
        splatMesh.name = root.name;
        splatMesh.rotateX(-Math.PI / 2);
        splatMesh.updateMatrix();
        splatMesh.frustumCulled = false;
        splatMesh.userData.sitrecGaussianSplat = true;
        splatMesh.userData.splatSortState = createSplatSortState(
            instancedGeometry.instanceCount, instancedGeometry,
        );
        root.add(splatMesh);
    } else {
        const material = createPLYPointCloudMaterial(geometry, filename);
        const points = new Points(geometry, material);
        points.name = root.name;
        points.rotateX(-Math.PI / 2);
        points.updateMatrix();
        points.userData.sitrecPLYPointCloud = material.userData?.sitrecPLYPointCloud === true;
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
    setPLYCustomPropertyMappings(loader);
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
        ? parser(data, filename).then((modelAsset) => attachFilenameParameters(modelAsset, filename))
        : Promise.reject(new Error(`Unsupported model format "${extension}" for "${filename}"`));

    return attachCallbacks(promise, onLoad, onError);
}

export function loadModelAsset(filename, onLoad, onError) {
    const promise = FileManager.loadAsset(filename, filename).then((asset) => {
        if (!asset) {
            throw new Error(`No asset data returned for "${filename}"`);
        }
        // Use the actual filename stored in FileManager (with extension) if available,
        // since the key (e.g. "TargetObjectFile") may not have an extension.
        const actualFilename = FileManager.list[filename]?.filename ?? filename;
        return parseModelData(actualFilename, asset.parsed);
    });

    return attachCallbacks(promise, onLoad, onError);
}
