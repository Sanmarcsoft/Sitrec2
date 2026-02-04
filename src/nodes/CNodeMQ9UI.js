// The compass UI displays the compass rose and the heading
// base on an input camera node

import {CNodeViewUI} from "./CNodeViewUI";
import {getCompassHeading} from "../SphericalMath";
import {MV3} from "../threeUtils";
import {getPointBelow} from "../threeExt";
import {EUSToLLA, haversineDistanceKM} from "../LLA-ECEF-ENU";
import {forward as mgrsForward} from "mgrs";
import {degrees} from "../utils";
import {NodeMan} from "../Globals";

export class   CNodeMQ9UI extends CNodeViewUI {

    constructor(v) {
        super(v);
        this.input("camera");  // a camera node, this is the camera track

        // optional camera track for reticle display
        this.addInput("cameraTrack", NodeMan.get("cameraTrackSwitchSmooth"), true);

        this.cx = 50;
        this.cy = 50;
        this.doubleClickFullScreen = false;

        this.gridCols = 60;
        this.gridRows = 30;
        this.gridTexts = [];

        // Display mode indices for cycling (0 = MGRS, 1 = Lat/Long decimal, 2 = Lat/Long DMS)
        this.acftPosMode = v.acftPosMode ?? 0;
        this.targetPosMode = v.targetPosMode ?? 0;
        // Altitude mode (0 = MSL, 1 = HAT)
        this.acftAltMode = v.acftAltMode ?? 0;
        this.targetAltMode = v.targetAltMode ?? 0;
        // Distance mode (0 = M, 1 = KM, 2 = NM)
        this.slrMode = v.slrMode ?? 0;
        this.grnMode = v.grnMode ?? 0;
        // IR mode (0 = IR WHT, 1 = IR BLK, 2 = WHT, 3 = BLK, 4 = EO)
        this.irMode = v.irMode ?? 0;

        this.addSimpleSerial("acftPosMode");
        this.addSimpleSerial("targetPosMode");
        this.addSimpleSerial("acftAltMode");
        this.addSimpleSerial("targetAltMode");
        this.addSimpleSerial("slrMode");
        this.addSimpleSerial("grnMode");
        this.addSimpleSerial("irMode");

        const grey = '#888888';

        // Left side text (dummy - grey, left aligned)
        this.addGridText(1, 1, "JAREA", grey, 'left');
        this.addGridText(1, 2, "NAR", grey, 'left');
        // IR mode - clickable to cycle IR WHT/IR BLK/WHT/BLK/EO
        this.irModeText = this.addGridText(1, 3, "IR WHT", '#FFFFFF', 'left', 'irMode');
        this.addGridText(1, 4, "P1", grey, 'left');
        this.addGridText(1, 5, "92/131", grey, 'left');
        this.addGridText(1, 6, "1173", grey, 'left');
        this.addGridText(1, 7, "23C", grey, 'left');

        // Right side top - ACFT position (dynamic, right aligned)
        this.addGridText(60, 5, "ACFT", '#FFFFFF', 'right');
        // ACFT position rows - clickable to cycle MGRS/LatLon/DMS
        this.acftZone = this.addGridText(60, 6, "38S KC", '#FFFFFF', 'right', 'acftPos');
        this.acftEasting = this.addGridText(60, 7, "00000 00000", '#FFFFFF', 'right', 'acftPos');
        // ACFT altitude - clickable to cycle MSL/HAT
        this.acftAlt = this.addGridText(60, 8, "00000 MSL", '#FFFFFF', 'right', 'acftAlt');

        // Right side middle (dummy - grey, right aligned)
        this.addGridText(60, 12, "LST", grey, 'right');
        this.addGridText(60, 13, "IDLE", grey, 'right');
        this.addGridText(60, 14, "1111", grey, 'right');

        // Right side bottom - target position (dynamic, right aligned)
        // Target position rows - clickable to cycle MGRS/LatLon/DMS
        this.targetZone = this.addGridText(60, 21, "38S KC", '#FFFFFF', 'right', 'targetPos');
        this.targetEasting = this.addGridText(60, 22, "00000 00000", '#FFFFFF', 'right', 'targetPos');
        // BRG - label left-aligned, value right-aligned
        this.addGridText(47, 23, "BRG", '#FFFFFF', 'left');
        this.targetBRGVal = this.addGridText(60, 23, "000", '#FFFFFF', 'right');
        // SLR - label left-aligned, value right-aligned, clickable to cycle M/KM/NM
        this.addGridText(47, 24, "SLR", '#FFFFFF', 'left');
        this.targetSLRVal = this.addGridText(60, 24, "0000M", '#FFFFFF', 'right', 'slr');
        // GRN - label left-aligned, value right-aligned, clickable to cycle M/KM/NM
        this.addGridText(47, 25, "GRN", '#FFFFFF', 'left');
        this.targetGRNVal = this.addGridText(60, 25, "0000M", '#FFFFFF', 'right', 'grn');
        this.addGridText(47, 26, "TWD", grey, 'left');
        this.addGridText(60, 26, "103M", grey, 'right');
        this.addGridText(47, 27, "ELV", grey, 'left');
        this.addGridText(60, 27, "489FT", grey, 'right');

        // Bottom (dummy - grey)
        this.addGridText(1, 28, "SEL", grey, 'left');
        this.addGridText(1, 29, "00:03:59", grey, 'left');
        this.addGridText(30, 28, "ELRF", grey, 'center');

        // Enable pointer events for click detection
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
    }

    addGridText(col, row, text, color = '#FFFFFF', align = 'left', clickGroup = null) {
        const entry = { col, row, text, color, align, clickGroup, bbox: null };
        this.gridTexts.push(entry);
        return entry;
    }

    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (const t of this.gridTexts) {
            if (t.clickGroup && t.bbox) {
                if (x >= t.bbox.x && x <= t.bbox.x + t.bbox.w &&
                    y >= t.bbox.y && y <= t.bbox.y + t.bbox.h) {
                    this.cycleDisplayMode(t.clickGroup);
                    return;
                }
            }
        }
    }

    cycleDisplayMode(group) {
        switch (group) {
            case 'acftPos':
                // Cycle: 0=MGRS, 1=Decimal, 2=DMS
                this.acftPosMode = (this.acftPosMode + 1) % 3;
                break;
            case 'targetPos':
                this.targetPosMode = (this.targetPosMode + 1) % 3;
                break;
            case 'acftAlt':
                // Cycle: 0=MSL, 1=HAT
                this.acftAltMode = (this.acftAltMode + 1) % 2;
                break;
            case 'slr':
                // Cycle: 0=M, 1=KM, 2=NM
                this.slrMode = (this.slrMode + 1) % 3;
                break;
            case 'grn':
                this.grnMode = (this.grnMode + 1) % 3;
                break;
            case 'irMode':
                // Cycle: 0=IR WHT, 1=IR BLK, 2=WHT, 3=BLK, 4=EO
                this.irMode = (this.irMode + 1) % 5;
                break;
        }
    }

    // Format latitude in DMS: DD°MM'SS.S"N/S
    formatLatDMS(lat) {
        const dir = lat >= 0 ? 'N' : 'S';
        lat = Math.abs(lat);
        const deg = Math.floor(lat);
        const minFloat = (lat - deg) * 60;
        const min = Math.floor(minFloat);
        const sec = (minFloat - min) * 60;
        return `${deg.toString().padStart(2, '0')}°${min.toString().padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${dir}`;
    }

    // Format longitude in DMS: DD°MM'SS.S"E/W (no leading zero on degrees)
    formatLonDMS(lon) {
        const dir = lon >= 0 ? 'E' : 'W';
        lon = Math.abs(lon);
        const deg = Math.floor(lon);
        const minFloat = (lon - deg) * 60;
        const min = Math.floor(minFloat);
        const sec = (minFloat - min) * 60;
        return `${deg}°${min.toString().padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${dir}`;
    }

    // Format distance based on mode (0=M, 1=KM, 2=NM)
    // Meters: 0 decimal places, KM/NM: 2 decimal places
    formatDistance(meters, mode) {
        switch (mode) {
            case 0: // Meters - integer
                return `${Math.round(meters)}M`;
            case 1: // Kilometers (1 km = 1000 m) - 2 decimal places
                return `${(meters / 1000).toFixed(2)}KM`;
            case 2: // Nautical miles (1 NM = 1852 m) - 2 decimal places
                return `${(meters / 1852).toFixed(2)}NM`;
            default:
                return `${Math.round(meters)}M`;
        }
    }

    // Get terrain elevation at a lat/lon position (returns meters)
    getTerrainElevation(lla) {
        const terrainNode = NodeMan.get("TerrainModel", false);
        if (terrainNode && terrainNode.maps && terrainNode.UI) {
            const map = terrainNode.maps[terrainNode.UI.mapType]?.map;
            if (map) {
                let elevation = map.getElevationInterpolated(lla.x, lla.y);
                if (elevation < 0) elevation = 0;
                return elevation;
            }
        }
        return 0;
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

        // Update IR mode text based on current mode
        const irModeLabels = ['IR WHT', 'IR BLK', 'WHT', 'BLK', 'EO'];
        this.irModeText.text = irModeLabels[this.irMode];

        // Update ACFT position from camera
        // lla.x = latitude, lla.y = longitude, lla.z = altitude (meters)
        const lla = EUSToLLA(camera.position);

        // Format ACFT position based on display mode
        if (this.acftPosMode === 0) {
            // MGRS format: Zone (3 chars) + Grid Square (2 chars) on line 1, Easting + Northing on line 2
            const mgrs = mgrsForward([lla.y, lla.x], 5);
            const zone = mgrs.substring(0, 5);
            const easting = mgrs.substring(5, 10);
            const northing = mgrs.substring(10, 15);
            this.acftZone.text = zone;
            this.acftEasting.text = `${easting} ${northing}`;
        } else if (this.acftPosMode === 1) {
            // Decimal degrees: lat on line 1, lon on line 2
            this.acftZone.text = `${lla.x.toFixed(5)}`;
            this.acftEasting.text = `${lla.y.toFixed(5)}`;
        } else {
            // DMS format: DD°MM'SS.S"N/S for lat, DDD°MM'SS.S"E/W for lon
            this.acftZone.text = this.formatLatDMS(lla.x);
            this.acftEasting.text = this.formatLonDMS(lla.y);
        }

        // Format ACFT altitude based on display mode
        // Altitude is in meters, convert to feet (1 meter = 3.28084 feet)
        // Use toLocaleString() to add commas for thousands
        const altMSL = lla.z;
        const altFeetMSL = Math.round(altMSL * 3.28084);
        if (this.acftAltMode === 0) {
            // MSL: Mean Sea Level altitude
            this.acftAlt.text = `${altFeetMSL.toLocaleString()} MSL`;
        } else {
            // HAT: Height Above Terrain = altitude - terrain elevation
            const terrainElevation = this.getTerrainElevation(lla);
            const hatMeters = altMSL - terrainElevation;
            const hatFeet = Math.round(hatMeters * 3.28084);
            this.acftAlt.text = `${hatFeet.toLocaleString()} HAT`;
        }

        // Update target position if available
        if (!this.in.target) {
            if (NodeMan.exists("targetTrackSwitchSmooth")) {
                this.addInput("target", "targetTrackSwitchSmooth");
            }
        }
        if (this.in.target) {
            const targetPos = this.in.target.p(frame);
            const targetLLA = EUSToLLA(targetPos);

            // Format target position based on display mode
            if (this.targetPosMode === 0) {
                // MGRS format
                const targetMgrs = mgrsForward([targetLLA.y, targetLLA.x], 5);
                const targetZoneStr = targetMgrs.substring(0, 3) + " " + targetMgrs.substring(3, 5) + " " + targetMgrs.substring(5, 10);
                const targetNorthingStr = targetMgrs.substring(10, 15);
                this.targetZone.text = targetZoneStr;
                this.targetEasting.text = targetNorthingStr;
            } else if (this.targetPosMode === 1) {
                // Decimal degrees
                this.targetZone.text = `${targetLLA.x.toFixed(5)}`;
                this.targetEasting.text = `${targetLLA.y.toFixed(5)}`;
            } else {
                // DMS format
                this.targetZone.text = this.formatLatDMS(targetLLA.x);
                this.targetEasting.text = this.formatLonDMS(targetLLA.y);
            }

            // Bearing from camera to target
            // Calculate true bearing (clockwise from north) using horizontal vector from camera to target
            const toTarget = targetPos.clone().sub(camera.position);
            const bearingRad = getCompassHeading(camera.position, toTarget.normalize(), null);
            // Convert radians to degrees, normalize to 0-360 range
            const bearingDeg = ((degrees(bearingRad) % 360) + 360) % 360;
            this.targetBRGVal.text = `${Math.round(bearingDeg)} T`;

            // SLR: Slant Range - direct 3D distance from camera to target (line-of-sight distance)
            const slantRange = camera.position.distanceTo(targetPos);
            this.targetSLRVal.text = this.formatDistance(slantRange, this.slrMode);

            // GRN: Ground Range - distance along ground surface between projected points
            // Project camera and target positions onto terrain/sphere surface using getPointBelow
            const camGroundPos = getPointBelow(camera.position);
            const targetGroundPos = getPointBelow(targetPos);
            // Convert ground positions to lat/lon and use Haversine formula for great-circle distance
            const camGroundLLA = EUSToLLA(camGroundPos);
            const targetGroundLLA = EUSToLLA(targetGroundPos);
            // haversineDistanceKM returns distance in km, convert to meters
            const groundRangeKM = haversineDistanceKM(camGroundLLA.x, camGroundLLA.y, targetGroundLLA.x, targetGroundLLA.y);
            const groundRange = groundRangeKM * 1000;
            this.targetGRNVal.text = this.formatDistance(groundRange, this.grnMode);
        }

        // after updating any text (none yet), render the text
        super.renderCanvas(frame)

        const c = this.ctx;

        // Get video rect to match grid to video aspect
        // Use mirrorVideo (overlay on lookView) if available, otherwise video
        let gridX = 0, gridY = 0, gridW = this.widthPx, gridH = this.heightPx;
        let videoView = NodeMan.get("mirrorVideo", false);
        if (!videoView) {
            videoView = NodeMan.get("video", false);
        }
        if (videoView && videoView.getSourceAndDestCoords) {
            videoView.getSourceAndDestCoords();
            gridX = videoView.dx;
            gridY = videoView.dy;
            gridW = videoView.dWidth;
            gridH = videoView.dHeight;
        } else {
            // No video: center on look view, clamp to 16:9 max aspect
            const maxAspect = 16 / 9;
            const viewAspect = this.widthPx / this.heightPx;
            if (viewAspect > maxAspect) {
                gridW = this.heightPx * maxAspect;
                gridH = this.heightPx;
                gridX = (this.widthPx - gridW) / 2;
                gridY = 0;
            }
        }

        // Render grid-based text (inset by one character on left and right)
        const charWidth = gridW / (this.gridCols + 2);
        const charHeight = gridH / this.gridRows;
        gridX += charWidth;
        gridW -= charWidth * 2;
        const fontSize = Math.floor(charHeight * 0.9);
        c.font = `${fontSize}px monospace`;
        c.textBaseline = 'top';
        for (const t of this.gridTexts) {
            c.fillStyle = t.color;
            c.textAlign = t.align;
            let x;
            if (t.align === 'right') {
                x = gridX + t.col * charWidth;
            } else if (t.align === 'center') {
                x = gridX + (t.col - 0.5) * charWidth;
            } else {
                x = gridX + (t.col - 1) * charWidth;
            }
            const y = gridY + (t.row - 1) * charHeight;
            c.fillText(t.text, x, y);

            // Store bounding box for click detection on clickable elements
            if (t.clickGroup) {
                const textWidth = c.measureText(t.text).width;
                let bboxX;
                if (t.align === 'right') {
                    bboxX = x - textWidth;
                } else if (t.align === 'center') {
                    bboxX = x - textWidth / 2;
                } else {
                    bboxX = x;
                }
                t.bbox = { x: bboxX, y: y, w: textWidth, h: charHeight };
            }
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

        // Heading graticule at top of display
        // Get track heading from camera track velocity
        let trackHeadingDeg = 0;
        if (this.in.cameraTrack) {
            const trackPos = this.in.cameraTrack.p(frame);
            const nextFrame = frame + 1;
            const nextPos = this.in.cameraTrack.p(nextFrame);
            const velocity = nextPos.clone().sub(trackPos);
            if (velocity.lengthSq() > 0.001) {
                const trackHeadingRad = getCompassHeading(trackPos, velocity.normalize(), null);
                trackHeadingDeg = ((degrees(trackHeadingRad) % 360) + 360) % 360;
            }
        }

        // Camera azimuth relative to track heading
        const cameraHeadingDeg = ((degrees(heading) % 360) + 360) % 360;
        let relativeAzimuth = cameraHeadingDeg - trackHeadingDeg;
        if (relativeAzimuth > 180) relativeAzimuth -= 360;
        if (relativeAzimuth < -180) relativeAzimuth += 360;

        // Graticule dimensions - use same fontSize as grid text
        const gratCenterX = gridX + gridW / 2;
        const gratWidth = gridW * 0.25;
        const boxPadding = charWidth * 0.05;
        const boxWidth = charWidth * 3 + boxPadding * 2;
        const boxHeight = charHeight * 1.1;
        const tickHeight = charHeight * 0.6;
        const triSize = charHeight * 0.4;
        const gratY = gridY + charHeight * 0.2;
        const scaleY = gratY + boxHeight + triSize + tickHeight;

        c.strokeStyle = '#FFFFFF';
        c.fillStyle = '#FFFFFF';
        c.lineWidth = 1;

        // Draw the scale line
        c.beginPath();
        c.moveTo(gratCenterX - gratWidth / 2, scaleY);
        c.lineTo(gratCenterX + gratWidth / 2, scaleY);
        c.stroke();

        // Draw ticks above the line
        const tickAngles = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];
        const majorTicks = [-180, -90, 0, 90, 180];
        for (const angle of tickAngles) {
            const tickX = gratCenterX + (angle / 180) * (gratWidth / 2);
            const isMajor = majorTicks.includes(angle);
            const th = isMajor ? tickHeight : tickHeight * 0.5;
            c.beginPath();
            c.moveTo(tickX, scaleY);
            c.lineTo(tickX, scaleY - th);
            c.stroke();
        }

        // Draw heading box with track heading value (T outside box)
        c.strokeRect(gratCenterX - boxWidth / 2, gratY, boxWidth, boxHeight);
        c.font = `${fontSize}px monospace`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`${Math.round(trackHeadingDeg)}`, gratCenterX, gratY + boxHeight / 2);
        // T outside the box to the right
        c.textAlign = 'left';
        c.fillText('T', gratCenterX + boxWidth / 2 + 2, gratY + boxHeight / 2);

        // Draw solid triangle below the box pointing down
        c.beginPath();
        c.moveTo(gratCenterX - triSize / 2, gratY + boxHeight);
        c.lineTo(gratCenterX + triSize / 2, gratY + boxHeight);
        c.lineTo(gratCenterX, gratY + boxHeight + triSize);
        c.closePath();
        c.fill();

        // Draw inverted V (caret) for camera azimuth with number below
        const caretX = gratCenterX + (relativeAzimuth / 180) * (gratWidth / 2);
        const caretY = scaleY + charHeight * 0.15;
        const caretSize = charHeight * 0.4;
        c.beginPath();
        c.moveTo(caretX - caretSize / 2, caretY + caretSize);
        c.lineTo(caretX, caretY);
        c.lineTo(caretX + caretSize / 2, caretY + caretSize);
        c.stroke();

        // Draw relative azimuth number below the caret
        c.font = `${fontSize}px monospace`;
        c.textAlign = 'center';
        c.fillText(`${Math.round(relativeAzimuth)}`, caretX, caretY + caretSize + charHeight * 0.6);

    }


}