// The compass UI displays the compass rose and the heading
// base on an input camera node

import {CNodeViewUI} from "./CNodeViewUI";
import {getCompassHeading} from "../SphericalMath";
import {MV3} from "../threeUtils";
import {EUSToLLA} from "../LLA-ECEF-ENU";
import {forward as mgrsForward} from "mgrs";
import {degrees} from "../utils";
import {NodeMan} from "../Globals";

export class   CNodeMQ9UI extends CNodeViewUI {

    constructor(v) {
        super(v);
        this.input("camera");  // a camera node

        this.cx = 50;
        this.cy = 50;
        this.doubleClickFullScreen = false;

        this.gridCols = 60;
        this.gridRows = 30;
        this.gridTexts = [];

        const grey = '#888888';

        // Left side text (dummy - grey)
        this.addGridText(1, 1, "JAREA", grey);
        this.addGridText(1, 2, "NAR", grey);
        this.addGridText(1, 3, "IR WHT", grey);
        this.addGridText(1, 4, "P1", grey);
        this.addGridText(1, 5, "92/131", grey);
        this.addGridText(1, 6, "1173", grey);
        this.addGridText(1, 7, "23C", grey);

        // Right side top - ACFT position (dynamic)
        this.addGridText(51, 5, "ACFT");
        this.acftZone = this.addGridText(51, 6, "38S KC");
        this.acftEasting = this.addGridText(47, 7, "00000 00000");
        this.acftAlt = this.addGridText(48, 8, "00000 MSL");

        // Right side middle (dummy - grey)
        this.addGridText(51, 12, "LST", grey);
        this.addGridText(51, 13, "IDLE", grey);
        this.addGridText(51, 14, "1111", grey);

        // Right side bottom - target position (dynamic)
        this.targetZone = this.addGridText(44, 21, "38S KC+");
        this.targetEasting = this.addGridText(43, 22, "00000 00000+");
        this.targetBRG = this.addGridText(43, 23, "BRG       000");
        this.targetSLR = this.addGridText(43, 24, "SLR    0000M+");
        this.targetGRN = this.addGridText(43, 25, "GRN    0000M+");
        this.addGridText(43, 26, "TWD     103M+", grey);
        this.addGridText(43, 27, "ELV    489FT+", grey);

        // Bottom (dummy - grey)
        this.addGridText(1, 28, "SEL", grey);
        this.addGridText(1, 29, "00:03:59", grey);
        this.addGridText(26, 28, "ELRF", grey);
    }

    addGridText(col, row, text, color = '#FFFFFF') {
        const entry = { col, row, text, color };
        this.gridTexts.push(entry);
        return entry;
    }


    renderCanvas(frame) {
        if (this.overlayView && !this.overlayView.visible) return;


        // get the three.js camera from the camera node
        const camera = this.in.camera.camera;
        // get the camera's forward vector, the negative z basis from its matrix
        const forward = MV3(camera.matrixWorld.elements.slice(8,11));


        // get the heading of the camera, in radians
        // also used by CNodeCompassUI
        const heading = getCompassHeading(camera.position, forward, camera);

        // Update ACFT position from camera
        const lla = EUSToLLA(camera.position);
        const mgrs = mgrsForward([lla.y, lla.x], 5);
        const zone = mgrs.substring(0, 5);
        const easting = mgrs.substring(5, 10);
        const northing = mgrs.substring(10, 15);
        const altFeet = Math.round(lla.z * 3.28084);
        this.acftZone.text = zone;
        this.acftEasting.text = `${easting} ${northing}`;
        this.acftAlt.text = `${altFeet} MSL`;

        // Update target position if available
        if (!this.in.target) {
            if (NodeMan.exists("targetTrackSwitchSmooth")) {
                this.addInput("target", "targetTrackSwitchSmooth");
            }
        }
        if (this.in.target) {
            const targetPos = this.in.target.p(frame);
            const targetLLA = EUSToLLA(targetPos);
            const targetMgrs = mgrsForward([targetLLA.y, targetLLA.x], 5);
            const targetZoneStr = targetMgrs.substring(0, 3) + " " + targetMgrs.substring(3, 5) + " " + targetMgrs.substring(5, 10);
            const targetEastingStr = ""; // targetMgrs.substring(5, 10);
            const targetNorthingStr = targetMgrs.substring(10, 15);
            this.targetZone.text = `${targetZoneStr}+`;
            this.targetEasting.text = `${targetEastingStr} ${targetNorthingStr}+`;

            // Bearing from camera to target (true bearing clockwise from north)
            const toTarget = targetPos.clone().sub(camera.position);
            const bearingRad = getCompassHeading(camera.position, toTarget.normalize(), null);
            const bearingDeg = ((degrees(bearingRad) % 360) + 360) % 360;
            this.targetBRG.text = `BRG       ${Math.round(bearingDeg).toString().padStart(3, '0')}`;

            // Slant range (camera to target LOS length)
            const slantRange = camera.position.distanceTo(targetPos);
            this.targetSLR.text = `SLR   ${Math.round(slantRange).toString().padStart(5)}M+`;

            // Ground range (horizontal distance)
            const camPosGround = camera.position.clone();
            const targetPosGround = targetPos.clone();
            camPosGround.y = 0;
            targetPosGround.y = 0;
            const groundRange = camPosGround.distanceTo(targetPosGround);
            this.targetGRN.text = `GRN   ${Math.round(groundRange).toString().padStart(5)}M+`;
        }

        // after updating any text (none yet), render the text
        super.renderCanvas(frame)

        const c = this.ctx;

        // Render grid-based text
        const charWidth = this.widthPx / this.gridCols;
        const charHeight = this.heightPx / this.gridRows;
        const fontSize = Math.floor(charHeight * 0.9);
        c.font = `${fontSize}px monospace`;
        c.textBaseline = 'top';
        c.textAlign = 'left';
        for (const t of this.gridTexts) {
            c.fillStyle = t.color;
            const x = (t.col - 1) * charWidth;
            const y = (t.row - 1) * charHeight;
            c.fillText(t.text, x, y);
        }


        // draw the letter N in the center
        c.fillStyle = '#FF00FF';
        c.font = this.px(1.5)+'px Arial';
        c.textAlign = 'center';
        c.textBaseline = 'middle';

        const x = this.rx_square(this.cx,this.cy+27,heading);
        const y = this.ry(this.cx,this.cy+27,heading);

        c.fillText('N', x, y);


        const crosshairWidth = 1
        const crosshairColor = '#FF00FF'
        const crosshairGap = 2
        const crosshairLength = 6

        // draw four lines to make a crosshair with a gap in the    middle
        c.strokeStyle = crosshairColor;
        c.lineWidth = crosshairWidth;
        c.beginPath();
        c.moveTo(this.px_square(this.cx), this.py(this.cy - crosshairLength));
        c.lineTo(this.px_square(this.cx), this.py(this.cy - crosshairGap));
        c.moveTo(this.px_square(this.cx), this.py(this.cy + crosshairGap));
        c.lineTo(this.px_square(this.cx), this.py(this.cy + crosshairLength));
        c.moveTo(this.px_square(this.cx - crosshairLength), this.py(this.cy));
        c.lineTo(this.px_square(this.cx - crosshairGap), this.py(this.cy));
        c.moveTo(this.px_square(this.cx + crosshairGap), this.py(this.cy));
        c.lineTo(this.px_square(this.cx + crosshairLength), this.py(this.cy));
        c.stroke();


    }


}