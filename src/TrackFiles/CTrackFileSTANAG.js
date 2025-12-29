/*
    STANAG 4676 Track File Parser
 */

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

    _hasPosLowHigh() {
        try {
            const track = this.data.nitsRoot?.message?.track;
            const trackPoints = track?.segment?.tp;
            if (!trackPoints) return false;
            const tpArray = Array.isArray(trackPoints) ? trackPoints : [trackPoints];
            return tpArray.some(tp => tp.posLow || tp.posHigh);
        } catch (e) {
            return false;
        }
    }

    toMISB(trackIndex = 0) {
        const trackCount = this.getTrackCount();
        if (trackIndex < 0 || trackIndex >= trackCount) {
            console.warn("STANAGToMISB: Invalid track index " + trackIndex + ", file has " + trackCount + " tracks");
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

                let posStr;
                if (this._hasPosLowHigh()) {
                    if (trackIndex === 0) {
                        posStr = tp.posHigh;
                    } else if (trackIndex === 1) {
                        posStr = tp.dynamics?.pos?.["#text"];
                    } else if (trackIndex === 2) {
                        posStr = tp.posLow;
                    }
                } else {
                    posStr = tp.dynamics?.pos?.["#text"];
                }

                if (!posStr) {
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
                console.warn("STANAGToMISB: No valid track points found for track index " + trackIndex);
                return false;
            }

            return misb;
        } catch (e) {
            console.warn("STANAGToMISB: Error parsing STANAG data: " + e.message);
            return false;
        }
    }

    getShortName(trackIndex = 0, trackFileName = "") {
        let baseName = trackFileName ? trackFileName.replace(/\.[^/.]+$/, "") : "STANAG Track";
        if (this._hasPosLowHigh()) {
            if (trackIndex === 0) {
                return baseName + " (Platform)";
            } else if (trackIndex === 1) {
                return baseName;
            } else if (trackIndex === 2) {
                return baseName + " (Ground)";
            }
        }
        return baseName;
    }

    hasMoreTracks(trackIndex = 0) {
        return trackIndex < this.getTrackCount() - 1;
    }

    getTrackCount() {
        if (this._hasPosLowHigh()) {
            return 3;
        }
        return 1;
    }

    extractObjects() {
    }
}
