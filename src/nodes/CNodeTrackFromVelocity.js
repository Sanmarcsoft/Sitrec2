import {CNodeTrack} from "./CNodeTrack";
import {NodeMan, Sit} from "../Globals";
import {getLocalNorthVector, getLocalUpVector} from "../SphericalMath";
import {radians} from "../utils";
import {V3} from "../threeUtils";
import {wgs84} from "../LLA-ECEF-ENU";

export class CNodeTrackFromVelocity extends CNodeTrack {
    constructor(v) {
        if (v.frames === undefined) {
            v.frames = Sit.frames;
            super(v);
            this.useSitFrames = true;
        } else {
            super(v);
        }

        this.input("origin");
        this.input("velocity");
        this.optionalInputs(["terrain"]);

        this.agl = v.agl ?? 1;

        this.recalculate();
    }

    recalculate() {
        this.array = [];

        const radius = wgs84.RADIUS;
        const pos = this.in.origin.p(0).clone();

        for (let f = 0; f < this.frames; f++) {
            const groundPos = this.getGroundPoint(pos);

            this.array.push({
                position: groundPos.clone(),
            });

            const vel = this.in.velocity.v(f);
            if (vel && (vel.speed !== undefined || vel.dx !== undefined)) {
                const up = getLocalUpVector(pos, radius);
                const north = getLocalNorthVector(pos);

                let moveVector;
                if (vel.speed !== undefined && vel.heading !== undefined) {
                    const fwd = north.clone();
                    fwd.applyAxisAngle(up, radians(-vel.heading));
                    moveVector = fwd.multiplyScalar(vel.speed / Sit.fps);
                } else if (vel.dx !== undefined && vel.dy !== undefined) {
                    const east = V3().crossVectors(up, north);
                    moveVector = north.clone().multiplyScalar(vel.dy / Sit.fps);
                    moveVector.add(east.clone().multiplyScalar(vel.dx / Sit.fps));
                }

                if (moveVector) {
                    pos.add(moveVector);

                    const rightAxis = V3().crossVectors(up, moveVector);
                    if (rightAxis.lengthSq() > 0.0001) {
                        const newUp = getLocalUpVector(pos, radius);
                        const newNorth = getLocalNorthVector(pos);
                        const newRight = V3().crossVectors(newUp, newNorth);
                    }
                }
            }
        }
    }

    getGroundPoint(pos) {
        const terrainNode = this.in.terrain ?? NodeMan.get("TerrainModel", false);
        if (terrainNode) {
            return terrainNode.getPointBelow(pos, this.agl, false);
        }
        const up = getLocalUpVector(pos);
        const groundLevel = wgs84.RADIUS;
        const centerToPos = pos.clone().add(V3(0, wgs84.RADIUS, 0));
        const distFromCenter = centerToPos.length();
        const adjustment = distFromCenter - groundLevel - this.agl;
        return pos.clone().sub(up.multiplyScalar(adjustment));
    }
}
