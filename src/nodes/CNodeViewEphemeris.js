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

    namePad = 20;
    azPad = 5;
    elPad = 5;
    rangePad = 6;
    altPad = 6;

    totalPad = this.namePad + this.azPad + this.elPad + this.rangePad + this.altPad;

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
        const separator = "─".repeat(this.totalPad);

        this.addMessage(header, '#00ff00');
        this.addMessage(separator, '#00ff00');

        for (const sat of top30) {
            const row = this.formatRow(
                sat.name.substring(0, this.namePad-1).trim(),
                sat.az.toFixed(1),
                sat.el.toFixed(1),
                sat.range.toFixed(0),
                sat.altitude.toFixed(0)
            );
            this.addMessage(row);
        }
    }

    formatRow(name, az, el, range, alt) {


        const nameStr = String(name).padEnd(this.namePad, '\u00A0');
        const azStr = String(az).padStart(this.azPad, '\u00A0');
        const elStr = String(el).padStart(this.elPad, '\u00A0');
        const rangeStr = String(range).padStart(this.rangePad, '\u00A0');
        const altStr = String(alt).padStart(this.altPad, '\u00A0');

        return `${nameStr}${azStr}${elStr}${rangeStr}${altStr}`;
    }
}
