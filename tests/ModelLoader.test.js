jest.mock("three/addons/loaders/DRACOLoader.js", () => ({
    DRACOLoader: class DRACOLoader {
        setDecoderPath() {}
    },
}));

jest.mock("three/addons/loaders/GLTFLoader.js", () => {
    const {Group} = require("three");

    return {
        GLTFLoader: class GLTFLoader {
            setDRACOLoader() {}

            parse(_data, _path, onLoad) {
                onLoad({scene: new Group()});
            }
        },
    };
});

jest.mock("three/addons/loaders/PLYLoader.js", () => {
    const {BufferGeometry, Float32BufferAttribute} = require("three");

    function parsePLYText(text) {
        const lines = text.trim().split(/\r?\n/);
        const endHeaderIndex = lines.findIndex((line) => line.trim() === "end_header");
        const headerLines = lines.slice(0, endHeaderIndex + 1);

        let vertexCount = 0;
        let faceCount = 0;
        let inVertexElement = false;
        const vertexProperties = [];

        for (const line of headerLines) {
            const trimmed = line.trim();
            const elementMatch = trimmed.match(/^element\s+(\w+)\s+(\d+)/i);
            if (elementMatch) {
                inVertexElement = elementMatch[1] === "vertex";
                if (elementMatch[1] === "vertex") {
                    vertexCount = Number(elementMatch[2]);
                }
                if (elementMatch[1] === "face") {
                    faceCount = Number(elementMatch[2]);
                }
                continue;
            }

            if (inVertexElement) {
                const propertyMatch = trimmed.match(/^property\s+\w+\s+(\w+)/i);
                if (propertyMatch) {
                    vertexProperties.push(propertyMatch[1]);
                }
            }
        }

        const propertyValues = new Map(vertexProperties.map((name) => [name, []]));
        const vertexLines = lines.slice(endHeaderIndex + 1, endHeaderIndex + 1 + vertexCount);
        for (const line of vertexLines) {
            const values = line.trim().split(/\s+/).map(Number);
            vertexProperties.forEach((name, index) => {
                propertyValues.get(name).push(values[index]);
            });
        }

        const faceLines = lines.slice(endHeaderIndex + 1 + vertexCount, endHeaderIndex + 1 + vertexCount + faceCount);
        const faces = faceLines.map((line) => line.trim().split(/\s+/).slice(1).map(Number));

        return {propertyValues, faces};
    }

    return {
        PLYLoader: class PLYLoader {
            constructor() {
                this.customPropertyMapping = {};
            }

            setCustomPropertyNameMapping(mapping) {
                this.customPropertyMapping = mapping;
            }

            parse(data) {
                const text = new TextDecoder().decode(data);
                const {propertyValues, faces} = parsePLYText(text);
                const geometry = new BufferGeometry();
                geometry.setAttribute("position", new Float32BufferAttribute([
                    ...propertyValues.get("x"),
                    ...propertyValues.get("y"),
                    ...propertyValues.get("z"),
                ].reduce((acc, value, index, array) => {
                    if (index < array.length / 3) {
                        acc.push(array[index], array[index + array.length / 3], array[index + 2 * array.length / 3]);
                    }
                    return acc;
                }, []), 3));

                if (faces.length > 0) {
                    geometry.setIndex(faces.flat());
                }

                for (const [attributeName, propertyNames] of Object.entries(this.customPropertyMapping)) {
                    if (propertyNames.every((name) => propertyValues.has(name))) {
                        const values = propertyValues.get(propertyNames[0]).map((_, index) =>
                            propertyNames.map((name) => propertyValues.get(name)[index])
                        ).flat();
                        geometry.setAttribute(attributeName, new Float32BufferAttribute(values, propertyNames.length));
                    }
                }

                return geometry;
            }
        },
    };
});

import {PerspectiveCamera} from "three";
import {extractModelFilenameParameters, isSupportedModelFile, parseModelData} from "../src/ModelLoader";

function toArrayBuffer(text) {
    return new TextEncoder().encode(text).buffer;
}

describe("ModelLoader", () => {
    test("detects supported model extensions", () => {
        expect(isSupportedModelFile("model.glb")).toBe(true);
        expect(isSupportedModelFile("model.ply")).toBe(true);
        expect(isSupportedModelFile("model.PLY?cache=1")).toBe(true);
        expect(isSupportedModelFile("shahad_#L24.5#_.glb")).toBe(true);
        expect(isSupportedModelFile("model.obj")).toBe(false);
    });

    test("extracts model-length metadata from filename parameters", () => {
        expect(extractModelFilenameParameters("shahad_#L24.5#_.glb")).toEqual({modelLength: 24.5});
        expect(extractModelFilenameParameters("shahad#L24.5ft#.glb")).toEqual({modelLength: 24.5});
        expect(extractModelFilenameParameters("shahad#L24.5FEET#.glb")).toEqual({modelLength: 24.5});
        expect(extractModelFilenameParameters("shahad#L3.5m#.glb").modelLength).toBeCloseTo(11.4829396325);
        expect(extractModelFilenameParameters("shahad#L3.5MeTeRs#.glb").modelLength).toBeCloseTo(11.4829396325);
        expect(extractModelFilenameParameters("plain-model.glb")).toEqual({});
    });

    test("parses mesh PLY files into mesh scene graphs", async () => {
        const trianglePLY = [
            "ply",
            "format ascii 1.0",
            "element vertex 3",
            "property float x",
            "property float y",
            "property float z",
            "element face 1",
            "property list uchar int vertex_indices",
            "end_header",
            "0 0 0",
            "1 0 0",
            "0 1 0",
            "3 0 1 2",
        ].join("\n");

        const modelAsset = await parseModelData("triangle.ply", toArrayBuffer(trianglePLY));

        expect(modelAsset.format).toBe("ply");
        expect(modelAsset.scene.userData.sitrecPlyHasFaces).toBe(true);
        expect(modelAsset.filenameParameters).toEqual({});
        expect(modelAsset.scene.children).toHaveLength(1);
        expect(modelAsset.scene.children[0].isMesh).toBe(true);
        expect(modelAsset.scene.children[0].rotation.x).toBeCloseTo(-Math.PI / 2);
    });

    test("attaches filename parameters to loaded model assets", async () => {
        const modelAsset = await parseModelData("shahad_#L24.5#_.glb", new ArrayBuffer(0));

        expect(modelAsset.filenameParameters).toEqual({modelLength: 24.5});
        expect(modelAsset.scene.userData.sitrecFilenameParameters).toEqual({modelLength: 24.5});
    });

    test("converts meter filename suffixes to feet for model-length scaling", async () => {
        const modelAsset = await parseModelData("shahad#L3.5m#.glb", new ArrayBuffer(0));

        expect(modelAsset.filenameParameters.modelLength).toBeCloseTo(11.4829396325);
        expect(modelAsset.scene.userData.sitrecFilenameParameters.modelLength).toBeCloseTo(11.4829396325);
    });

    test("parses point-cloud PLY files into points scene graphs", async () => {
        const pointsPLY = [
            "ply",
            "format ascii 1.0",
            "element vertex 3",
            "property float x",
            "property float y",
            "property float z",
            "end_header",
            "0 0 0",
            "1 0 0",
            "0 1 0",
        ].join("\n");

        const modelAsset = await parseModelData("points.ply", toArrayBuffer(pointsPLY));

        expect(modelAsset.format).toBe("ply");
        expect(modelAsset.scene.userData.sitrecPlyHasFaces).toBe(false);
        expect(modelAsset.scene.children).toHaveLength(1);
        expect(modelAsset.scene.children[0].isPoints).toBe(true);
        expect(modelAsset.scene.children[0].rotation.x).toBeCloseTo(-Math.PI / 2);
    });

    test("renders gaussian splat PLY as instanced mesh with elliptical splats", async () => {
        const splatPLY = [
            "ply",
            "format ascii 1.0",
            "element vertex 2",
            "property float x",
            "property float y",
            "property float z",
            "property float f_dc_0",
            "property float f_dc_1",
            "property float f_dc_2",
            "property float opacity",
            "property float scale_0",
            "property float scale_1",
            "property float scale_2",
            "property float rot_0",
            "property float rot_1",
            "property float rot_2",
            "property float rot_3",
            "end_header",
            "0 0 0 1 0 0 0 -2 -2 -2 1 0 0 0",
            "1 0 0 0 1 0 1 -1 -1 -1 1 0 0 0",
        ].join("\n");

        const modelAsset = await parseModelData("splat.ply", toArrayBuffer(splatPLY));
        const splatMesh = modelAsset.scene.children[0];
        const geometry = splatMesh.geometry;

        expect(splatMesh.isMesh).toBe(true);
        expect(splatMesh.userData.sitrecGaussianSplat).toBe(true);
        expect(splatMesh.material.isShaderMaterial).toBe(true);
        expect(splatMesh.material.userData.sitrecGaussianSplat).toBe(true);
        expect(splatMesh.material.transparent).toBe(true);
        expect(splatMesh.frustumCulled).toBe(false);
        expect(splatMesh.material.uniforms.viewOrigin).toBeDefined();
        expect(splatMesh.material.uniforms.modelViewLinear).toBeDefined();
        expect(geometry.isInstancedBufferGeometry).toBe(true);
        expect(geometry.instanceCount).toBe(2);
        expect(geometry.getAttribute("splatCenter")).toBeDefined();
        expect(geometry.getAttribute("splatColor")).toBeDefined();
        expect(geometry.getAttribute("splatOpacity")).toBeDefined();
        expect(geometry.getAttribute("splatScale")).toBeDefined();
        expect(geometry.getAttribute("splatRotation")).toBeDefined();
        expect(splatMesh.userData.splatSortState).toBeDefined();
        expect(splatMesh.rotation.x).toBeCloseTo(-Math.PI / 2);
    });

    test("sorts gaussian splats by exact view-space depth without binning artifacts", async () => {
        const splatPLY = [
            "ply",
            "format ascii 1.0",
            "element vertex 3",
            "property float x",
            "property float y",
            "property float z",
            "property float f_dc_0",
            "property float f_dc_1",
            "property float f_dc_2",
            "property float opacity",
            "property float scale_0",
            "property float scale_1",
            "property float scale_2",
            "property float rot_0",
            "property float rot_1",
            "property float rot_2",
            "property float rot_3",
            "end_header",
            "0 0 0 1 0 0 0 -2 -2 -2 1 0 0 0",
            "0 1.0 0 0 1 0 1 -1 -1 -1 1 0 0 0",
            "0 1.000001 0 0 0 1 1 -1 -1 -1 1 0 0 0",
        ].join("\n");

        const modelAsset = await parseModelData("splat-sort.ply", toArrayBuffer(splatPLY));
        const splatMesh = modelAsset.scene.children[0];
        const geometry = splatMesh.geometry;
        const camera = new PerspectiveCamera(50, 1, 0.1, 100);

        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        splatMesh.updateMatrixWorld(true);

        splatMesh.userData.splatSortState.sort(camera, splatMesh.matrixWorld);

        const sortedCenters = Array.from(geometry.getAttribute("splatCenter").array);
        expect(sortedCenters[1]).toBeCloseTo(1.000001, 5);
        expect(sortedCenters[4]).toBeCloseTo(1.0, 5);
        expect(sortedCenters[7]).toBeCloseTo(0.0, 5);
    });

    test("falls back to point cloud for PLY with partial splat attributes (no rotation)", async () => {
        const partialSplatPLY = [
            "ply",
            "format ascii 1.0",
            "element vertex 2",
            "property float x",
            "property float y",
            "property float z",
            "property float f_dc_0",
            "property float f_dc_1",
            "property float f_dc_2",
            "property float opacity",
            "end_header",
            "0 0 0 1 0 0 0",
            "1 0 0 0 1 0 1",
        ].join("\n");

        const modelAsset = await parseModelData("partial.ply", toArrayBuffer(partialSplatPLY));
        const points = modelAsset.scene.children[0];

        expect(points.isPoints).toBe(true);
        expect(points.material.isShaderMaterial).toBe(true);
        expect(points.material.userData.sitrecPLYPointCloud).toBe(true);
    });
});
