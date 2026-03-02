import {CNode3DGroup} from "./CNode3DGroup";
import * as THREE from "three";
import {setRenderOne, Sit} from "../Globals";
import {dispose} from "../threeExt";
import {V3} from "../threeUtils";
import {getLocalUpVector} from "../SphericalMath";
import * as LAYER from "../LayerMasks";

// CNodeContrail renders a flat horizontal white ribbon trailing behind a track,
// drifting with wind over time. Rebuilt every frame based on the current playback position.
export class CNodeContrail extends CNode3DGroup {
    constructor(v) {
        v.layers ??= LAYER.MASK_HELPERS;
        super(v);

        this.input("track");
        this.optionalInputs(["wind"]);

        this.duration = v.duration ?? 100;         // seconds of trail
        this.sampleInterval = v.sampleInterval ?? 5; // seconds between samples
        this.ribbonWidth = v.ribbonWidth ?? 50;    // meters

        this.mesh = null;

        this.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
    }

    dispose() {
        this.removeMesh();
        this.material.dispose();
        super.dispose();
    }

    removeMesh() {
        if (this.mesh) {
            this.group.remove(this.mesh);
            dispose(this.mesh.geometry);
            this.mesh = null;
        }
    }

    update(frame) {
        super.update(frame);
        this.rebuildRibbon(frame);
        setRenderOne(true);
    }

    rebuildRibbon(frame) {
        this.removeMesh();

        const track = this.in.track;
        const wind = this.in.wind;
        const fps = Sit.fps;

        const durationFrames = this.duration * fps;
        const sampleStep = this.sampleInterval * fps;

        const startFrame = Math.max(0, Math.floor(frame - durationFrames));
        const endFrame = Math.min(frame, track.frames - 1);

        if (endFrame <= startFrame) return;

        // Collect sample points with wind offset
        const points = [];

        // Sample from oldest to newest (startFrame to endFrame)
        for (let f = startFrame; f <= endFrame; f += sampleStep) {
            const pos = track.p(f);
            if (!pos || isNaN(pos.x)) continue;

            const point = pos.clone();

            // Apply wind drift: elapsed time since this point was "emitted"
            if (wind) {
                const elapsedSeconds = (frame - f) / fps;
                const windPerFrame = wind.v(frame);
                // wind.v() returns displacement per frame in ECEF
                // total displacement = windPerFrame * elapsedFrames = windPerFrame * elapsedSeconds * fps
                point.add(windPerFrame.multiplyScalar(elapsedSeconds * fps));
            }

            points.push(point);
        }

        // Always include the current frame position (no wind offset since T=0)
        const lastSampledFrame = startFrame + Math.floor((endFrame - startFrame) / sampleStep) * sampleStep;
        if (lastSampledFrame < endFrame) {
            const pos = track.p(endFrame);
            if (pos && !isNaN(pos.x)) {
                points.push(pos.clone());
            }
        }

        if (points.length < 2) return;

        // Compute midpoint for precision (same pattern as CNodeDisplayTrack)
        const mid = V3(0, 0, 0);
        for (const p of points) {
            mid.add(p);
        }
        mid.divideScalar(points.length);

        // Build ribbon geometry: flat horizontal quads between consecutive points
        const vertices = [];
        const halfWidth = this.ribbonWidth / 2;

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // Segment direction
            const dir = p2.clone().sub(p1);
            if (dir.lengthSq() < 1e-8) continue;
            dir.normalize();

            // Local up at midpoint of segment
            const segMid = p1.clone().add(p2).multiplyScalar(0.5);
            const up = getLocalUpVector(segMid);

            // Width direction: perpendicular to both direction and up
            const widthDir = V3().crossVectors(dir, up).normalize().multiplyScalar(halfWidth);

            // Quad corners (relative to mid for precision)
            const p1L = V3(p1.x - mid.x - widthDir.x, p1.y - mid.y - widthDir.y, p1.z - mid.z - widthDir.z);
            const p1R = V3(p1.x - mid.x + widthDir.x, p1.y - mid.y + widthDir.y, p1.z - mid.z + widthDir.z);
            const p2L = V3(p2.x - mid.x - widthDir.x, p2.y - mid.y - widthDir.y, p2.z - mid.z - widthDir.z);
            const p2R = V3(p2.x - mid.x + widthDir.x, p2.y - mid.y + widthDir.y, p2.z - mid.z + widthDir.z);

            // Triangle 1: p1L, p2L, p2R
            vertices.push(p1L.x, p1L.y, p1L.z);
            vertices.push(p2L.x, p2L.y, p2L.z);
            vertices.push(p2R.x, p2R.y, p2R.z);

            // Triangle 2: p1L, p2R, p1R
            vertices.push(p1L.x, p1L.y, p1L.z);
            vertices.push(p2R.x, p2R.y, p2R.z);
            vertices.push(p1R.x, p1R.y, p1R.z);
        }

        if (vertices.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
        geometry.computeVertexNormals();

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.position.set(mid.x, mid.y, mid.z);
        this.group.add(this.mesh);
        this.propagateLayerMask();
    }
}
