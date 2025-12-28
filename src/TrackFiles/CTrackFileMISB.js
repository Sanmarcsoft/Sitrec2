import {CTrackFile} from "./CTrackFile";
import {MISB, MISBFields} from "../MISBFields";

export class CTrackFileMISB extends CTrackFile {
    static canHandle(filename, data) {
        if (!data || !Array.isArray(data)) {
            return false;
        }
        if (data.length === 0) {
            return false;
        }
        const firstRow = data[0];
        if (!Array.isArray(firstRow)) {
            return false;
        }
        if (firstRow[MISB.UnixTimeStamp] !== undefined && firstRow[MISB.UnixTimeStamp] !== null) {
            return true;
        }
        return false;
    }

    doesContainTrack() {
        if (!this.data || !Array.isArray(this.data)) {
            return false;
        }
        if (this.data.length === 0) {
            return false;
        }
        const firstRow = this.data[0];
        if (!Array.isArray(firstRow)) {
            return false;
        }
        const lat = firstRow[MISB.SensorLatitude];
        const lon = firstRow[MISB.SensorLongitude];
        return lat !== undefined && lat !== null && lon !== undefined && lon !== null;
    }

    _hasCenter() {
        if (!this.data || this.data.length === 0) {
            return false;
        }
        const firstRow = this.data[0];
        const lat = firstRow[MISB.FrameCenterLatitude];
        const lon = firstRow[MISB.FrameCenterLongitude];
        return lat !== undefined && lat !== null && lon !== undefined && lon !== null;
    }

    _hasAngles() {
        if (!this.data || this.data.length === 0) {
            return false;
        }
        const firstRow = this.data[0];
        const pitch = firstRow[MISB.PlatformPitchAngle];
        return typeof pitch === 'number' && !isNaN(pitch);
    }

    _hasFOV() {
        if (!this.data || this.data.length === 0) {
            return false;
        }
        const firstRow = this.data[0];
        const fov = firstRow[MISB.SensorVerticalFieldofView];
        return fov !== undefined && fov !== null && !isNaN(Number(fov));
    }

    toMISB(trackIndex = 0) {
        if (!this.data || !Array.isArray(this.data) || this.data.length === 0) {
            console.warn("CTrackFileMISB.toMISB: No valid data");
            return false;
        }

        const trackCount = this.getTrackCount();
        if (trackIndex < 0 || trackIndex >= trackCount) {
            console.warn(`CTrackFileMISB.toMISB: Invalid track index ${trackIndex}, file has ${trackCount} tracks`);
            return false;
        }

        if (trackIndex === 0) {
            return this.data;
        }

        if (trackIndex === 1 && this._hasCenter()) {
            const centerMisb = [];
            for (let i = 0; i < this.data.length; i++) {
                const row = this.data[i];
                const centerLat = row[MISB.FrameCenterLatitude];
                const centerLon = row[MISB.FrameCenterLongitude];
                const centerElev = row[MISB.FrameCenterElevation];
                if (centerLat === null || centerLat === undefined ||
                    centerLon === null || centerLon === undefined) {
                    continue;
                }
                const newRow = new Array(MISBFields).fill(null);
                newRow[MISB.UnixTimeStamp] = row[MISB.UnixTimeStamp];
                newRow[MISB.SensorLatitude] = centerLat;
                newRow[MISB.SensorLongitude] = centerLon;
                newRow[MISB.SensorTrueAltitude] = centerElev ?? 0;
                centerMisb.push(newRow);
            }
            if (centerMisb.length === 0) {
                console.warn("CTrackFileMISB.toMISB: No valid center track points");
                return false;
            }
            return centerMisb;
        }

        return false;
    }

    getShortName(trackIndex = 0, trackFileName = "") {
        let baseName = "";
        if (this.data && this.data.length > 0) {
            const tailNumber = this.data[0][MISB.PlatformTailNumber];
            if (tailNumber !== null && tailNumber !== undefined && tailNumber !== "") {
                baseName = tailNumber;
            }
        }
        if (!baseName && trackFileName) {
            baseName = trackFileName.replace(/\.[^/.]+$/, "");
        }
        if (!baseName) {
            baseName = "MISB Track";
        }
        if (trackIndex === 1) {
            return "Center_" + baseName;
        }
        return baseName;
    }

    hasMoreTracks(trackIndex = 0) {
        return trackIndex < this.getTrackCount() - 1;
    }

    getTrackCount() {
        if (this._hasCenter()) {
            return 2;
        }
        return 1;
    }

    extractObjects() {
    }
}
