import {CVideoData} from "./CVideoData";
import {versionString} from "./utils";

export class CFramesVideoData extends CVideoData {
    constructor(v) {
        super(v)

        this.tinyName = v.tinyName;
        this.fullName = v.fullName;
    }

    update() {
        // calculate the loaded percentage
        let count = 0;
        for (let f = 0; f < this.frames; f++) {
            if (this.imageCache[f] !== undefined && this.imageCache[f] !== null && this.imageCache[f].width > 0) {
                count++;

                this.videoWidth = this.imageCache[f].width
                this.videoHeight = this.imageCache[f].height
                if (this.originalVideoWidth === 0) {
                    this.originalVideoWidth = this.imageCache[f].width
                    this.originalVideoHeight = this.imageCache[f].height
                }
            }
        }
        this.videoPercentLoaded = Math.floor(100 * count / this.frames);

        if (!this.startedLoadingFull) {
            this.startedLoadingFull = true;
            for (let i = 0; i < this.frames; i++) {
                this.imageCache[i].src = this.fullName(i) + "?v=1" + versionString
            }
        }
    }

    getImage(frame) {
        let image = this.imageCache[frame];

        if (image === undefined || image.width === 0)
            image = null;
        return image;
    }


    dispose() {
        super.dispose();
        this.imageCache = null;
        this.fullName = null;
        this.startedLoadingFull = false;
        this.groups = null;
    }

}