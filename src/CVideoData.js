import {assert} from "./assert.js";

export class CVideoData {
    constructor(v) {
        this.percentLoaded = 0;

        this.frames = v.frames

        this.videoSpeed = v.videoSpeed ?? 1 // what speed the original video was

        // increase the number of frames
        // to account for original speed
        // e.g. if video was 10x timelapse, then we need 10x the virtual frames
        // to play back in real time
        this.frames *= this.videoSpeed;

        // just give some defaults. actual images will override
        this.videoWidth = 100
        this.videoHeight = 100

        this.flushEntireCache();

    }

    // virtual functions
    getImage(frame) {
        assert(0, "CVideoData: getImage: not implemented")
        return null;
    }

    isFrameLoaded(frame) {
        const img = this.imageCache[frame];
        return img && img.width > 0 && img.height > 0;
    }

    async waitForFrame(frame, timeout = 5000) {
        this.getImage(frame);
        const start = performance.now();
        while (!this.isFrameLoaded(frame)) {
            if (performance.now() - start > timeout) {
                console.warn(`waitForFrame timeout for frame ${frame}`);
                return false;
            }
            await new Promise(r => setTimeout(r, 10));
        }
        return true;
    }

    update() {
        // nothing to do here
    }

    flushEntireCache() {

        this.imageCache = [] // full sized images
        this.imageDataCache = []
        this.frameCache = []

        for (let i = 0; i < this.frames; i++) {
            this.imageCache.push(new Image())
            this.imageDataCache.push(null)
        }

    }

    stopStreaming() {
        this.flushEntireCache()
    }

    dispose() {
        this.stopStreaming()
        this.imageCache = null
        this.imageDataCache = null
        this.frameCache = null
        this.imageCacheTiny = null
    }

}