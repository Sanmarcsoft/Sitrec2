export class CTrackFile {
    constructor(data) {
        this.data = data;
    }

    static canHandle(filename, data) {
        throw new Error("static canHandle must be implemented by subclass");
    }

    doesContainTrack() {
        throw new Error("doesContainTrack must be implemented by subclass");
    }

    toMISB(trackIndex = 0) {
        throw new Error("toMISB must be implemented by subclass");
    }

    getShortName(trackIndex = 0, trackFileName = "") {
        throw new Error("getShortName must be implemented by subclass");
    }

    hasMoreTracks(trackIndex = 0) {
        throw new Error("hasMoreTracks must be implemented by subclass");
    }

    getTrackCount() {
        throw new Error("getTrackCount must be implemented by subclass");
    }
}
