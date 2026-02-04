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

        // Left side text (dummy - grey, left aligned)
        this.addGridText(1, 1, "JAREA", grey, 'left');
        this.addGridText(1, 2, "NAR", grey, 'left');
        this.addGridText(1, 3, "IR WHT", grey, 'left');
        this.addGridText(1, 4, "P1", grey, 'left');
        this.addGridText(1, 5, "92/131", grey, 'left');
        this.addGridText(1, 6, "1173", grey, 'left');
        this.addGridText(1, 7, "23C", grey, 'left');

        // Right side top - ACFT position (dynamic, right aligned)
        this.addGridText(60, 5, "ACFT", '#FFFFFF', 'right');
        this.acftZone = this.addGridText(60, 6, "38S KC", '#FFFFFF', 'right');
        this.acftEasting = this.addGridText(60, 7, "00000 00000", '#FFFFFF', 'right');
        this.acftAlt = this.addGridText(60, 8, "00000 MSL", '#FFFFFF', 'right');

        // Right side middle (dummy - grey, right aligned)
        this.addGridText(60, 12, "LST", grey, 'right');
        this.addGridText(60, 13, "IDLE", grey, 'right');
        this.addGridText(60, 14, "1111", grey, 'right');

        // Right side bottom - target position (dynamic, right aligned)
        this.targetZone = this.addGridText(60, 21, "38S KC+", '#FFFFFF', 'right');
        this.targetEasting = this.addGridText(60, 22, "00000 00000+", '#FFFFFF', 'right');
        this.targetBRG = this.addGridText(60, 23, "BRG       000", '#FFFFFF', 'right');
        this.targetSLR = this.addGridText(60, 24, "SLR    0000M+", '#FFFFFF', 'right');
        this.targetGRN = this.addGridText(60, 25, "GRN    0000M+", '#FFFFFF', 'right');
        this.addGridText(60, 26, "TWD     103M+", grey, 'right');
        this.addGridText(60, 27, "ELV    489FT+", grey, 'right');

        // Bottom (dummy - grey)
        this.addGridText(1, 28, "SEL", grey, 'left');
        this.addGridText(1, 29, "00:03:59", grey, 'left');
        this.addGridText(30, 28, "ELRF", grey, 'center');
    }

    addGridText(col, row, text, color = '#FFFFFF', align = 'left') {
        const entry = { col, row, text, color, align };
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
        for (const t of this.gridTexts) {
            c.fillStyle = t.color;
            c.textAlign = t.align;
            let x;
            if (t.align === 'right') {
                x = t.col * charWidth;
            } else if (t.align === 'center') {
                x = (t.col - 0.5) * charWidth;
            } else {
                x = (t.col - 1) * charWidth;
            }
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