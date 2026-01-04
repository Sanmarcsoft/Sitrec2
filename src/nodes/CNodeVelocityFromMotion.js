import {CNode} from "./CNode";
import {Sit} from "../Globals";

export class CNodeVelocityFromMotion extends CNode {
    constructor(v) {
        super(v);
        this.frames = v.frames ?? Sit.frames;
        this.motionData = v.motionData ?? [];
        this.metersPerPixel = v.metersPerPixel ?? 1;
    }

    setMotionData(data, metersPerPixel) {
        this.motionData = data;
        this.metersPerPixel = metersPerPixel;
        this.frames = data.length;
    }

    getValueFrame(frame) {
        const f = Math.floor(frame);
        if (f < 0 || f >= this.motionData.length) {
            return {dx: 0, dy: 0, confidence: 0};
        }
        const m = this.motionData[f];
        if (!m) {
            return {dx: 0, dy: 0, confidence: 0};
        }
        return {
            dx: (m.dx ?? 0) * this.metersPerPixel * Sit.fps,
            dy: -(m.dy ?? 0) * this.metersPerPixel * Sit.fps,
            confidence: m.confidence ?? 0,
        };
    }
}
