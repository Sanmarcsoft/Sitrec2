import {CNodeViewText} from "./CNodeViewText.js";
import {altitudeAboveSphere, getAzElFromPositionAndForward} from "../SphericalMath";
import {NodeMan} from "../Globals";

export class CNodeViewEphemeris extends CNodeViewText {
    constructor(v) {
        v.title = 'Satellite Ephemeris';
        v.idPrefix = 'ephemeris-view';
        v.hideOnFileDrop = false;
        v.maxMessages = 0;

        super(v);

        this.lastUpdateTime = 0;
        this.updateInterval = 1000;

        this.nightSkyNode = v.nightSkyNode;
    }

    getOutputAreaHeight() {
        return 'calc(100% - 40px)';
    }

    addTabButtons() {
    }

    update(f) {
        const now = Date.now();
        if (now - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = now;

        this.updateEphemeris();
    }

    updateEphemeris() {
        if (!this.nightSkyNode || !this.nightSkyNode.satellites || !this.nightSkyNode.satellites.TLEData) {
            return;
        }

        const satellites = this.nightSkyNode.satellites;
        const tleData = satellites.TLEData;
        const lookCamera = NodeMan.get("lookCamera", false);
        
        if (!lookCamera) {
            return;
        }

        const cameraPos = lookCamera.camera.position;
        const satData = [];

        for (let i = 0; i < tleData.satData.length; i++) {
            const sat = tleData.satData[i];
            
            if (!sat.visible || !sat.eus) {
                continue;
            }

            const satPos = sat.eus;
            const toSat = satPos.clone().sub(cameraPos);
            const range = toSat.length();
            const forward = toSat.clone().normalize();

            const [az, el] = getAzElFromPositionAndForward(cameraPos, forward);
            
            if (el < 0) {
                continue;
            }

            const altitude = altitudeAboveSphere(satPos);

            satData.push({
                name: sat.name || `SAT ${sat.number}`,
                az: az,
                el: el,
                range: range / 1000,
                altitude: altitude / 1000
            });
        }

        satData.sort((a, b) => b.el - a.el);

        const top30 = satData.slice(0, 30);

        this.clearOutput();

        const header = this.formatRow("Name", "Az", "El", "Range", "Alt");
        const separator = "─".repeat(80);

        this.addMessage(header, '#00ff00');
        this.addMessage(separator, '#00ff00');

        for (const sat of top30) {
            const row = this.formatRow(
                sat.name.substring(0, 30),
                sat.az.toFixed(1),
                sat.el.toFixed(1),
                sat.range.toFixed(0),
                sat.altitude.toFixed(0)
            );
            this.addMessage(row);
        }
    }

    formatRow(name, az, el, range, alt) {
        const namePad = 32;
        const azPad = 8;
        const elPad = 8;
        const rangePad = 10;
        const altPad = 10;

        const nameStr = String(name).padEnd(namePad, ' ');
        const azStr = String(az).padStart(azPad, ' ');
        const elStr = String(el).padStart(elPad, ' ');
        const rangeStr = String(range).padStart(rangePad, ' ');
        const altStr = String(alt).padStart(altPad, ' ');

        return `${nameStr}${azStr}${elStr}${rangeStr}${altStr}`;
    }
}
