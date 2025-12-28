import {CTrackFile} from "./CTrackFile";
import {MISB, MISBFields} from "../MISBFields";
import {timeStrToEpoch} from "../DateTimeUtils";

export class CTrackFileSTANAG extends CTrackFile {
    static canHandle(filename, data) {
        if (!data || typeof data !== 'object') {
            return false;
        }
        try {
            return !!(data.nitsRoot?.message?.track);
        } catch (e) {
            return false;
        }
    }

    doesContainTrack() {
        if (!this.data || typeof this.data !== 'object') {
            return false;
        }
        
        try {
            if (this.data.nitsRoot?.message?.track) {
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    toMISB(trackIndex = 0) {
        if (trackIndex !== 0) {
            console.warn("STANAGToMISB: STANAG XML files only contain a single track, index " + trackIndex + " is invalid");
            return false;
        }

        if (!this.data || typeof this.data !== 'object') {
            console.warn("STANAGToMISB: No valid STANAG data");
            return false;
        }

        try {
            if (!this.doesContainTrack()) {
                console.warn("STANAGToMISB: No track in STANAG file");
                return false;
            }

            const message = this.data.nitsRoot?.message;
            if (!message || !message.baseTime || !message.track) {
                console.warn("STANAGToMISB: Invalid STANAG XML structure");
                return false;
            }

            const baseTime = timeStrToEpoch(message.baseTime["#text"]);
            const relTimeIncrement = message.relTimeIncrement?.["#text"] ? Number(message.relTimeIncrement["#text"]) : 0;
            const track = message.track;
            const trackPoints = track.segment?.tp;

            if (!trackPoints) {
                console.warn("STANAGToMISB: No track points found");
                return false;
            }

            const tpArray = Array.isArray(trackPoints) ? trackPoints : [trackPoints];
            const misb = [];

            for (let i = 0; i < tpArray.length; i++) {
                const tp = tpArray[i];
                const relTime = tp.relTime?.["#text"] ? Number(tp.relTime["#text"]) : 0;
                const posStr = tp.dynamics?.pos?.["#text"];

                if (!posStr) {
                    console.warn("STANAGToMISB: Track point " + i + " missing position data");
                    continue;
                }

                const coords = posStr.trim().split(/\s+/);
                if (coords.length < 3) {
                    console.warn("STANAGToMISB: Track point " + i + " has invalid position format");
                    continue;
                }

                const lat = Number(coords[0]);
                const lon = Number(coords[1]);
                const alt = Number(coords[2]);

                const time = baseTime + (relTime * relTimeIncrement * 1000);

                misb[misb.length] = new Array(MISBFields);
                misb[misb.length - 1][MISB.UnixTimeStamp] = time;
                misb[misb.length - 1][MISB.SensorLatitude] = lat;
                misb[misb.length - 1][MISB.SensorLongitude] = lon;
                misb[misb.length - 1][MISB.SensorTrueAltitude] = alt;
            }

            if (misb.length === 0) {
                console.warn("STANAGToMISB: No valid track points found");
                return false;
            }

            return misb;
        } catch (e) {
            console.warn("STANAGToMISB: Error parsing STANAG data: " + e.message);
            return false;
        }
    }

    getShortName(trackIndex = 0, trackFileName = "") {
        if (trackFileName) {
            return trackFileName.replace(/\.[^/.]+$/, "");
        }
        return "STANAG Track";
    }

    hasMoreTracks(trackIndex = 0) {
        return false;
    }

    getTrackCount() {
        return 1;
    }

    extractObjects() {
    }
}
