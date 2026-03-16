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

    function parseVertexPositions(text) {
        const lines = text.trim().split(/\r?\n/);
        const endHeaderIndex = lines.findIndex((line) => line.trim() === "end_header");
        const vertexCountMatch = text.match(/element\s+vertex\s+(\d+)/i);
        const vertexCount = vertexCountMatch ? Number(vertexCountMatch[1]) : 0;
        const vertexLines = lines.slice(endHeaderIndex + 1, endHeaderIndex + 1 + vertexCount);

        return vertexLines.flatMap((line) => line.trim().split(/\s+/).slice(0, 3).map(Number));
    }

    return {
        PLYLoader: class PLYLoader {
            parse(data) {
                const text = new TextDecoder().decode(data);
                const geometry = new BufferGeometry();
                geometry.setAttribute("position", new Float32BufferAttribute(parseVertexPositions(text), 3));
                return geometry;
            }
        },
    };
});

import {isSupportedModelFile, parseModelData} from "../src/ModelLoader";

function toArrayBuffer(text) {
    return new TextEncoder().encode(text).buffer;
}

describe("ModelLoader", () => {
    test("detects supported model extensions", () => {
        expect(isSupportedModelFile("model.glb")).toBe(true);
        expect(isSupportedModelFile("model.ply")).toBe(true);
        expect(isSupportedModelFile("model.PLY?cache=1")).toBe(true);
        expect(isSupportedModelFile("model.obj")).toBe(false);
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
        expect(modelAsset.scene.children).toHaveLength(1);
        expect(modelAsset.scene.children[0].isMesh).toBe(true);
        expect(modelAsset.scene.children[0].rotation.x).toBeCloseTo(-Math.PI / 2);
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
});
