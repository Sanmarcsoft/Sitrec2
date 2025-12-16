import {CTrackFile} from "./CTrackFile";
import {CGeoJSON} from "./geoJSONUtils";

export class CTrackFileJSON extends CTrackFile {
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
