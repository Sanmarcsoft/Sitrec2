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
        
        // Original video dimensions (before any resizing due to videoMaxSize setting)
        // These are set once when the video is first loaded and never changed
        // Used for tracking/analysis coordinate conversion
        this.originalVideoWidth = 0
        this.originalVideoHeight = 0

        // Stabilization support
        this.stabilizationEnabled = false;
        this.stabilizationData = null;  // Map of frame -> {x, y} offsets
        this.stabilizationReferencePoint = null; // {x, y} - the fixed point
        this.stabilizationDirectOffset = false;  // true = use offsets directly (motion analysis)
        this.stabilizedImageCache = [];  // Cache for stabilized frames

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

    // Set stabilization data from tracking
    // directOffset: if true, trackingData contains direct pixel offsets to apply
    //               if false, trackingData contains tracked positions to center on referencePoint
    setStabilizationData(trackingData, referencePoint, directOffset = false) {
        this.stabilizationData = new Map(trackingData);
        this.stabilizationReferencePoint = referencePoint;
        this.stabilizationDirectOffset = directOffset;
        // Clear stabilized cache when data changes
        this.stabilizedImageCache = [];
    }

    // Enable/disable stabilization
    setStabilizationEnabled(enabled) {
        this.stabilizationEnabled = enabled;
        if (!enabled) {
            // Clear cache when disabling
            this.stabilizedImageCache = [];
        }
    }

    // Get stabilized image for a frame
    getStabilizedImage(frame, originalImage) {
        if (!this.stabilizationEnabled || !this.stabilizationData || !this.stabilizationReferencePoint) {
            return originalImage;
        }

        // Check cache
        if (this.stabilizedImageCache[frame]) {
            return this.stabilizedImageCache[frame];
        }

        const trackPos = this.stabilizationData.get(frame);
        if (!trackPos) {
            // No tracking data for this frame, return original
            return originalImage;
        }

        // Calculate shift based on mode
        let shiftX, shiftY;
        if (this.stabilizationDirectOffset) {
            // Direct offset mode (motion analysis): offsets are cumulative motion to cancel
            shiftX = trackPos.x;
            shiftY = trackPos.y;
        } else {
            // Point tracking mode: shift to keep tracked point at reference position
            shiftX = this.stabilizationReferencePoint.x - trackPos.x;
            shiftY = this.stabilizationReferencePoint.y - trackPos.y;
        }

        // Create shifted image
        const canvas = document.createElement('canvas');
        canvas.width = originalImage.width || originalImage.videoWidth;
        canvas.height = originalImage.height || originalImage.videoHeight;
        const ctx = canvas.getContext('2d');

        // Fill with black background
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw shifted image
        ctx.drawImage(originalImage, shiftX, shiftY);

        // Cache the result
        this.stabilizedImageCache[frame] = canvas;

        return canvas;
    }

    flushEntireCache() {

        this.imageCache = [] // full sized images
        this.imageDataCache = []
        this.frameCache = []
        this.stabilizedImageCache = []

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