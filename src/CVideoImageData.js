import {CVideoData} from "./CVideoData";
import {assert} from "./assert";
import {FileManager} from "./Globals";

export class CVideoImageData extends CVideoData {
    constructor(v, loadedCallback, errorCallback) {
        super(v, loadedCallback, errorCallback);
        assert(v.img, "CVideoImageData: img is undefined");
        this.img = v.img

        this.videoWidth = this.img.width;
        this.videoHeight = this.img.height;

        this.filename = v.filename;
        this.deleteAfterUsing = v.deleteAfterUsing ?? true;
        loadedCallback(this);
    }

    getImage(frame) {
        return this.getStabilizedImage(frame, this.img);
    }

    dispose() {
        this.stopStreaming();
        super.dispose();
        if (this.deleteAfterUsing) {
            // we want to delete the image from the file manager
            FileManager.disposeRemove(this.filename);
        }
        this.img = null;
    }
}