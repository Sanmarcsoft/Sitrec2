import {CTrackFile} from "./CTrackFile";
import {CGeoJSON} from "../geoJSONUtils";

export class CTrackFileJSON extends CTrackFile {
    static canHandle(filename, data) {
        if (!data || typeof data !== 'object') {
            return false;
        }
        try {
            if (data.type !== "FeatureCollection" || !data.features || data.features.length === 0) {
                return false;
            }
            const firstFeature = data.features[0];
            if (!firstFeature || !firstFeature.geometry || !firstFeature.properties) {
                return false;
            }
            if (firstFeature.geometry.type !== "Point") {
                return false;
            }
            if (!firstFeature.properties.thresherId && !firstFeature.properties.dtg) {
                return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    constructor(data) {
        super(data);
        this.geoJSON = new CGeoJSON();
        this.geoJSON.json = data;
    }

    doesContainTrack() {
        return this.data && this.data.features && this.data.features.length > 0;
    }

    toMISB(trackIndex = 0) {
        return this.geoJSON.toMISB(trackIndex);
    }

    getShortName(trackIndex = 0, trackFileName = "") {
        return this.geoJSON.shortTrackIDForIndex(trackIndex);
    }

    hasMoreTracks(trackIndex = 0) {
        const count = this.getTrackCount();
        return trackIndex < count - 1;
    }

    getTrackCount() {
        return this.geoJSON.countTracks();
    }

    extractObjects() {
    }
}
