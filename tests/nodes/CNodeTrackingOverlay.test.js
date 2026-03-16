import {Vector3} from "three";

jest.mock("../../src/nodes/CNodeViewUI", () => ({
    CNodeViewUI: class {}
}));

jest.mock("../../src/assert", () => ({
    assert: jest.fn()
}));

jest.mock("../../src/Globals", () => ({
    Globals: {exportTagNumber: 0},
    NodeMan: {},
    Sit: {frames: 0}
}));

jest.mock("../../src/utils", () => ({
    radians: (degrees) => degrees * Math.PI / 180
}));

jest.mock("../../src/nodes/CNodeControllerVarious", () => ({
    extractFOV: (value) => value
}));

jest.mock("../../src/ViewUtils", () => ({
    mouseToCanvas: () => [0, 0]
}));

jest.mock("../../src/nodes/CNodeVideoView", () => ({
    CNodeVideoView: class {}
}));

jest.mock("../../src/CEventManager", () => ({
    EventManager: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
    }
}));

const {Sit} = require("../../src/Globals");
const {CNodeTrackingOverlay} = require("../../src/nodes/CNodeTrackingOverlay.js");

describe("CNodeTrackingOverlay no-video guards", () => {
    test("getValueFrame falls back to camera LOS when video geometry is unavailable", () => {
        const baseLOS = {
            position: new Vector3(1, 2, 3),
            heading: new Vector3(0, 0, -1),
            up: new Vector3(0, 1, 0),
            right: new Vector3(1, 0, 0)
        };

        const overlay = {
            in: {
                cameraLOSNode: {
                    getValueFrame: jest.fn(() => baseLOS)
                },
                fovNode: {
                    getValueFrame: jest.fn(() => 30)
                }
            },
            overlayView: {
                videoWidth: 0,
                videoHeight: 0,
                originalVideoWidth: 0,
                originalVideoHeight: 0
            },
            hasVideoGeometry: CNodeTrackingOverlay.prototype.hasVideoGeometry,
            ensureOverlayGeometryReady: CNodeTrackingOverlay.prototype.ensureOverlayGeometryReady
        };

        const result = CNodeTrackingOverlay.prototype.getValueFrame.call(overlay, 0);

        expect(result).toBe(baseLOS);
        expect(overlay.in.cameraLOSNode.getValueFrame).toHaveBeenCalledWith(0);
        expect(result.heading.equals(baseLOS.heading)).toBe(true);
    });

    test("updateCurve keeps placeholder points finite before a video is loaded", () => {
        const originalFrames = Sit.frames;
        Sit.frames = 3;

        const overlay = {
            keyframes: [],
            overlayView: {
                widthPx: 640,
                heightPx: 480,
                videoWidth: 0,
                videoHeight: 0,
                originalVideoWidth: 0,
                originalVideoHeight: 0
            },
            hasVideoGeometry: CNodeTrackingOverlay.prototype.hasVideoGeometry,
            getFallbackTrackPoint: CNodeTrackingOverlay.prototype.getFallbackTrackPoint
        };

        try {
            CNodeTrackingOverlay.prototype.updateCurve.call(overlay);

            expect(overlay.pointsXY).toEqual([
                [320, 240],
                [320, 240],
                [320, 240]
            ]);

            for (const [x, y] of overlay.pointsXY) {
                expect(Number.isFinite(x)).toBe(true);
                expect(Number.isFinite(y)).toBe(true);
            }
        } finally {
            Sit.frames = originalFrames;
        }
    });
});
