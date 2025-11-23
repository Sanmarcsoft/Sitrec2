// Dispaly an arrow from an object to a celestial body

import {DebugArrowAB, removeDebugArrow} from "../threeExt";
import {CNode} from "./CNode";
import {guiShowHide} from "../Globals";
import {convertColorInput} from "../ConvertColorInputs";
import {Raycaster, Vector3} from "three";
import * as LAYER from "../LayerMasks";
import {GlobalScene} from "../LocalFrame";
import {assert} from "../assert";

export class CNodeBackgroundFlowIndicator extends CNode {
    constructor(v) {
        v.color ??= "white";
        v.length ??= 1000;
        super(v);
        convertColorInput(v,"color",this.id)
        this.body = v.body;    // "Sun", "Moon", "Mars", etc
        this.input("length");  // length of arrow
        this.input("color");   // color of arrow
        this.arrowName = "backgroundFlow"

        guiShowHide.add(this, 'visible').onChange( (v) => {
            if (v) {
                this.update(0);
            } else {
                this.remove();
            }
        })
            .name("Background Flow Indicator")
            .tooltip("Display an arrow indicating how much the background will move in the next frame/n" +
                "Useful for syncing the sim with video (use View/Vid Overlay)")


    }

    update(f) {
        if (!this.visible) return;

        const cameraLOS = NodeMan.get("JetLOSCameraCenter", false)
        if (!cameraLOS) return;

        const camera = NodeMan.get("lookCamera", false);
        if (!camera) return;
        //const cameraPos = camera.camera.position.clone();

        // get camera vectors at f and f+1

        const losTrackA = cameraLOS.getValue(f);
        const losTrackB = cameraLOS.getValue(f + 1);

        const losA = losTrackA.heading;
        const losB = losTrackB.heading;

        assert(losA && losB, "No LOS values found");
        assert(typeof losA.clone === "function","Invalid LOS value")

        const cameraPosA = losTrackA.position;
        const cameraPosB = losTrackB.position;

        const rayA = new Raycaster(cameraPosA, losA)
        rayA.layers.mask  |= LAYER.MASK_MAIN | LAYER.MASK_LOOK;

        const rayB = new Raycaster(cameraPosB, losB)
        rayB.layers.mask  |= LAYER.MASK_MAIN | LAYER.MASK_LOOK;


        const terrainNode = NodeMan.get("TerrainModel", false);

        // attmpet to get the closest intersecting objects/points on the terrain model

        let obA = terrainNode.getClosestIntersect(rayA, terrainNode);
        let obB = terrainNode.getClosestIntersect(rayB, terrainNode);

        let pointA, pointB;

        if (obA && obB) {
            pointA = obA.point;
            pointB = obB.point;

            // the actual points on the surface plane
           // DebugSphere("FlowA", pointA, 0.5, "#80FF00", GlobalScene, LAYER.MASK_LOOKRENDER)  // green A
           // DebugSphere("FlowB"+f, pointB, 0.5, "#FF8000", GlobalScene, LAYER.MASK_LOOKRENDER)  // blue B


            // move them 1% closer to cameraPos
            // which will ensure they are not underground/underwater
            pointA.lerp(cameraPosA, 0.01);
            pointB.lerp(cameraPosB, 0.01);

        } else {
            // fallback to two points 10km away from the camera in the LOS directions
            pointA = cameraPosA.clone().add(losA.clone().multiplyScalar(10000))
            pointB = cameraPosB.clone().add(losB.clone().multiplyScalar(10000))
        }


        const AtoB = new Vector3().subVectors(pointB, pointA);


        DebugArrowAB(this.arrowName+"20", pointA, pointA.clone().add(AtoB.clone().multiplyScalar(20)), "#a0a0a0",       true, GlobalScene, 20, LAYER.MASK_LOOKRENDER);
        DebugArrowAB(this.arrowName,      pointA, pointA.clone().add(AtoB.clone().multiplyScalar(1)), this.in.color.v0, true, GlobalScene, 20, LAYER.MASK_LOOKRENDER);
    }


    remove() {
        removeDebugArrow(this.arrowName)
        removeDebugArrow(this.arrowName+"20")

    }

    dispose() {
        this.remove();
        super.dispose();
    }


}