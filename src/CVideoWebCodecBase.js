import {Globals, infoDiv, setRenderOne, Sit} from "./Globals";
import {assert} from "./assert";
import {loadImage} from "./utils";
import {CVideoAndAudio} from "./CVideoAndAudio";
import {par} from "./par";
import {isLocal} from "./configUtils";
import {showError, showErrorOnce} from "./showError";

/**
 * Base class for WebCodec-based video data handlers
 * Provides common frame caching, group management, and decoder functionality
 * 
 * Key responsibilities:
 * - Manages VideoDecoder instance and configuration
 * - Implements frame group system for efficient memory usage
 * - Handles on-demand decoding of frame groups (keyframe + deltas)
 * - Manages ImageBitmap cache with automatic purging
 * - Provides frame resizing based on videoMaxSize setting
 * - Handles decoder errors and recreation
 * 
 * Frame group system:
 * - Groups start with keyframes and include following delta frames
 * - Only decodes groups when needed (on-demand)
 * - Keeps configurable cache window around current frame
 * - Automatically purges distant groups to save GPU memory
 * 
 * Memory management:
 * - Converts VideoFrames to ImageBitmaps for GPU efficiency
 * - Properly closes ImageBitmaps when purging
 * - Tracks GPU memory usage estimates
 * - Implements cache window based on available device memory
 * 
 * Subclass responsibilities:
 * - MP4: Handles demuxed chunks from MP4Demuxer
 * - H264: Processes raw H.264 elementary streams
 * - Both override specific methods for their format
 */
export class CVideoWebCodecBase extends CVideoAndAudio {

    constructor(v, loadedCallback, errorCallback) {
        super(v);
        
        this.format = "";
        this.error = false;
        this.loaded = false;
        this.loadedCallback = loadedCallback;
        this.errorCallback = errorCallback;
        
        // Store filename for debugging
        this.filename = v.dropFile ? v.dropFile.name : (v.filename || "Unknown");

        // Check WebCodec compatibility
        this.incompatible = true;
        try {
            if (VideoDecoder !== undefined) {
                this.incompatible = false;
            }
        } catch (e) {
        }

        if (this.incompatible) {
            console.log("Video Playback Requires up-to-date WebCodec Browser (Chrome/Edge/Safari)");
            this.errorImage = null;
            loadImage('./data/images/errorImage.png').then(result => {
                this.errorImage = result;
                if (errorCallback) errorCallback("WebCodec not supported");
            });
            return;
        }

        // Initialize common caching variables
        this.initializeCommonVariables();
    }

    initializeCommonVariables() {
        this.frames = 0;
        this.lastGetImageFrame = 0;
        this.chunks = []; // per frame chunks
        this.groups = []; // groups for frames+delta
        this.groupsPending = 0;
        this.nextRequest = null;
        this.requestQueue = [];
        this.incomingFrame = 0;
        this.lastTimeStamp = -1;
        this.lastDecodeInfo = "";
        this.blankFrame = null; // Will be created once we know video dimensions
        this.blankFrameCanvas = null; // Temporary canvas for blank frame creation
        this.blankFramePending = false; // Flag indicating blank frame creation is in progress
        this.decodeFrameIndex = 0; // Simple counter for decode order
        this.c_tmp = null; // Temporary canvas (if used)
        this.ctx_tmp = null; // Temporary canvas context (if used)
    }

    /**
     * Create decoder with common output/error handling
     * Subclasses can override createDecoderCallbacks() to customize behavior
     */
    createDecoder() {
        const callbacks = this.createDecoderCallbacks();
        this.decoder = new VideoDecoder(callbacks);
        return this.decoder;
    }

    /**
     * Create decoder callbacks - can be overridden by subclasses
     */
    createDecoderCallbacks() {
        return {
            output: videoFrame => {
                this.format = videoFrame.format;
                this.lastDecodeInfo = "last frame.timestamp = " + videoFrame.timestamp + "<br>";

                // Find the group this frame belongs to
                let groupNumber = 0;
                while (groupNumber + 1 < this.groups.length && videoFrame.timestamp >= this.groups[groupNumber + 1].timestamp)
                    groupNumber++;
                const group = this.groups[groupNumber];

                // Calculate the frame number from group position and pending count
                const frameNumber = group.frame + group.length - group.pending;
                
                this.processDecodedFrame(frameNumber, videoFrame, group);
            },
            error: e => {
                showError("Decoder error:", e);
                this.handleDecoderError(e);
            }
        };
    }

    /**
     * Resize a video frame based on videoMaxSize setting
     * Returns the original frame if no resizing needed
     */
    resizeFrameIfNeeded(image) {
        // Check if videoMaxSize is set
        const videoMaxSize = Globals.settings?.videoMaxSize;
        if (!videoMaxSize || videoMaxSize === "None") {
            return image;
        }
        
        // Map resolution names to longest edge dimensions
        const resolutionMap = {
            "1080P": 1920,  // 1920x1080
            "720P": 1280,   // 1280x720
            "480P": 854,    // 854x480
            "360P": 640     // 640x360
        };
        
        const maxSize = resolutionMap[videoMaxSize];
        if (!maxSize || isNaN(maxSize)) {
            return image;
        }
        
        // Check if resizing is needed
        const maxDimension = Math.max(image.width, image.height);
        if (maxDimension <= maxSize) {
            return image; // No resizing needed
        }
        
        // Calculate new dimensions maintaining aspect ratio
        const scaleFactor = maxSize / maxDimension;
        const newWidth = Math.round(image.width * scaleFactor);
        const newHeight = Math.round(image.height * scaleFactor);
        
        let canvas = null;
        try {
            // Create a canvas for resizing
            canvas = document.createElement("canvas");
            canvas.width = newWidth;
            canvas.height = newHeight;
            const ctx = canvas.getContext("2d");
            
            // Draw the image scaled down
            ctx.drawImage(image, 0, 0, newWidth, newHeight);
            
            // Store reference for cleanup in the Promise chain
            const tempCanvas = canvas;
            
            // Create ImageBitmap from the resized canvas
            return createImageBitmap(canvas).then(resizedImage => {
                // Close the original image to free GPU memory
                try {
                    image.close();
                } catch (e) {
                    console.warn("Error closing original frame:", e);
                }
                
                // Clean up temporary canvas - remove from DOM if attached and dereferenced
                if (tempCanvas && tempCanvas.parentNode) {
                    tempCanvas.parentNode.removeChild(tempCanvas);
                }
                
                return resizedImage;
            }).catch(error => {
                // Clean up on error
                try {
                    image.close();
                } catch (e) {
                    console.warn("Error closing original frame on resize error:", e);
                }
                if (tempCanvas && tempCanvas.parentNode) {
                    tempCanvas.parentNode.removeChild(tempCanvas);
                }
                throw error;
            });
        } catch (error) {
            showError("Error resizing video frame:", error);
            // Ensure canvas cleanup on synchronous errors
            if (canvas && canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }
            return image; // Return original on error
        }
    }

    /**
     * Process a decoded video frame and convert it to ImageBitmap
     * Handles frame resizing, caching, and group completion tracking
     * @param {number} frameNumber - Frame index in the video
     * @param {VideoFrame} videoFrame - Decoded frame from VideoDecoder
     * @param {Object} group - Frame group this frame belongs to
     */
    processDecodedFrame(frameNumber, videoFrame, group) {
        // Check if imageCache is still valid (video might have been disposed)
        if (!this.imageCache) {
            videoFrame.close();
            return;
        }

        // Close any existing frame at this position to avoid memory leaks
        const existingFrame = this.imageCache[frameNumber];
        if (existingFrame && typeof existingFrame.close === 'function') {
            try {
                existingFrame.close();
            } catch (e) {
                // Ignore errors when closing already-closed frames
            }
        }

        createImageBitmap(videoFrame).then(image => {
            // Double-check imageCache still exists (video might have been disposed during async operation)
            if (!this.imageCache) {
                if (typeof image.close === 'function') {
                    try {
                        image.close();
                    } catch (e) {
                        console.warn("Error closing image on cache invalidation:", e);
                    }
                }
                return;
            }

            // Resize frame if needed based on videoMaxSize setting
            const resizePromise = this.resizeFrameIfNeeded(image);
            
            // Handle both sync (image returned as-is) and async (Promise from resizing)
            Promise.resolve(resizePromise).then(processedImage => {
                // Double-check imageCache still exists after async operations
                if (!this.imageCache) {
                    if (typeof processedImage.close === 'function') {
                        try {
                            processedImage.close();
                        } catch (e) {
                            console.warn("Error closing processed image on cache invalidation:", e);
                        }
                    }
                    return;
                }

                this.imageCache[frameNumber] = processedImage;
                if (this.videoWidth !== processedImage.width || this.videoHeight !== processedImage.height) {
                    console.log("New per-frame video dimensions detected: width=" + processedImage.width + ", height=" + processedImage.height);
                    this.videoWidth = processedImage.width;
                    this.videoHeight = processedImage.height;
                }

                if (this.c_tmp === undefined) {
                    this.c_tmp = document.createElement("canvas");
                    this.c_tmp.setAttribute("width", this.videoWidth);
                    this.c_tmp.setAttribute("height", this.videoHeight);
                    this.ctx_tmp = this.c_tmp.getContext("2d");
                }

                // if it's the last one we wanted, then tell the system to render a frame
                if (frameNumber === this.lastGetImageFrame) {
                    setRenderOne(true);
                }

                if (!group.decodeOrder) {
                    group.decodeOrder = [];
                }
                group.decodeOrder.push(frameNumber);

                if (group.pending <= 0) {
                    console.warn("Decoding more frames than were listed as pending at frame " + frameNumber);
                    return;
                }

                group.pending--;
                if (group.pending === 0) {
                    group.loaded = true;
                    this.groupsPending--;
                    this.handleGroupComplete();
                }
            }).catch(error => {
                showError("Error during frame processing/resizing:", error);
                // Ensure proper cleanup on error
                if (this.imageCache && this.imageCache[frameNumber] instanceof ImageBitmap) {
                    try {
                        this.imageCache[frameNumber].close();
                    } catch (e) {
                        console.warn("Error closing frame on processing error:", e);
                    }
                    this.imageCache[frameNumber] = null;
                }
                // Decrement pending count even on error
                if (group && group.pending > 0) {
                    group.pending--;
                    if (group.pending === 0) {
                        group.loaded = false;
                        this.groupsPending--;
                    }
                }
            });
        }).catch(error => {
            showError("Error creating ImageBitmap:", error);
            // Ensure we still close the videoFrame on error
            try {
                videoFrame.close();
            } catch (e) {
                console.warn("Error closing videoFrame on ImageBitmap creation error:", e);
            }
            // Decrement pending count on error
            if (group && group.pending > 0) {
                group.pending--;
                if (group.pending === 0) {
                    group.loaded = false;
                    this.groupsPending--;
                }
            }
        });

        videoFrame.close();
    }

    /**
     * Handle completion of a group - process any queued requests
     */
    handleGroupComplete() {
        if (this.groupsPending === 0) {
            // Handle deferred requests differently for each subclass
            if (this.nextRequest !== null && this.nextRequest >= 0) {
                // CVideoMp4Data style
                this.requestGroup(this.nextRequest);
                this.nextRequest = -1;
            } else if (this.nextRequest && typeof this.nextRequest === 'object') {
                // nextRequest is a group object
                const group = this.nextRequest;
                this.nextRequest = null;
                this.requestGroup(group);
            } else if (this.requestQueue && this.requestQueue.length > 0) {
                // CVideoH264Data style
                const nextGroup = this.requestQueue.shift();
                this.requestGroup(nextGroup);
            }
        }
    }

    /**
     * Handle decoder errors - can be overridden by subclasses
     */
    handleDecoderError(error) {
        showError("Decoder error:", error);
        // Default implementation - subclasses can override for specific error handling
    }

    /**
     * Process chunks into groups (common logic)
     */
    processChunksIntoGroups(encodedChunks) {
        for (let i = 0; i < encodedChunks.length; i++) {
            const chunk = encodedChunks[i];
            chunk.frameNumber = this.frames++;
            this.chunks.push(chunk);

            if (chunk.type === "key") {
                this.groups.push({
                    frame: this.chunks.length - 1,  // first frame of this group
                    length: 1,                      // for now, increase with each delta
                    pending: 0,                     // how many frames requested and pending
                    loaded: false,                  // set when all the frames in the group are loaded
                    timestamp: chunk.timestamp,
                });
            } else {
                const lastGroup = this.groups[this.groups.length - 1];
                if (lastGroup) {
                    assert(chunk.timestamp >= lastGroup.timestamp, "out of group chunk timestamp");
                    lastGroup.length++;
                }
            }
        }
    }

    // find the group object for a given frame
    getGroup(frame) {
        for (let g = 0; g < this.groups.length; g++) {
            const group = this.groups[g];
            if (frame >= group.frame && frame < (group.frame + group.length)) {
                return group;
            }
        }
        // if not found, this might mean the first group has a missing keyframe
        // which means we need to just skip the orphaned delta frames until we get to the next group (which will start with a keyframe)
        // const last = this.groups[this.groups.length - 1];
        // if (last) {
        //     console.warn("(frame = "+frame+" Last frame = " + last.frame + ", length = " + last.length + ", i.e. up to " + (last.frame + last.length - 1));
        // }
        return null;
    }

    getGroupsBetween(start, end) {
        const groups = [];
        for (let g = 0; g < this.groups.length; g++) {
            const group = this.groups[g];
            if (group.frame + group.length >= start && group.frame < end) {
                groups.push(group);
            }
        }
        return groups;
    }

    /**
     * Request that a specific frame be loaded into cache
     * Finds the appropriate group and requests its decoding
     * @param {number} frame - Frame number to request
     */
    requestFrame(frame) {
        if (!this.groups || this.groups.length === 0 || !this.chunks) {
            return; // Not initialized yet
        }

        if (frame > Sit.videoFrames - 1) frame = Sit.videoFrames - 1;
        if (frame < 0) frame = 0;

        const group = this.getGroup(frame);
        if (group === null) {
            return; // No group found
        }
        this.requestGroup(group);
    }

    /**
     * Request decoding of a specific frame group
     * Checks decoder availability and queues if busy
     * @param {Object} group - Group object containing frame range and state
     */
    requestGroup(group) {
        if (!group || typeof group !== "object") {
            console.warn("requestGroup: invalid group", group);
            return;
        }

        if (!this.decoder || !this.chunks) {
            return; // Not initialized yet
        }

        if (group.loaded || group.pending > 0) {
            return;
        }

        // Check if audio is playing and not muted - if so, defer video decoding
        if (this.isAudioActive()) {
            // Check if audio buffer is ready
            if (!this.isAudioReady()) {
                // Audio is still being prepared, defer video decoding
                this.handleBusyDecoder(group);
                return;
            }
        }

        // Check if decoder is busy
        if (this.decoder.decodeQueueSize > 0) {
            this.handleBusyDecoder(group);
            return;
        }
        group.pending = group.length;
        group.loaded = false;
        group.decodeOrder = [];
        this.groupsPending++;

        try {
            for (let i = group.frame; i < group.frame + group.length; i++) {
                if (i < this.chunks.length) {
                    this.decoder.decode(this.chunks[i]);
                } else {
                    console.warn("Trying to decode frame beyond chunks length:", i, ">=", this.chunks.length);
                    group.pending--;
                }
            }

            // Kick the reorder buffer so the tail frames are delivered.
            this.decoder.flush().catch(() => { /* ignore mid-seek aborts */ });
        } catch (error) {
            // Some videos give a lot of these errors,
            // and have jerky playback. e.g. '/Users/mick/Dropbox/Investigating/Rainmaking (1968).mp4'
            showErrorOnce("GROUPDECODEERROR", "Error during group decode:", error);
            group.pending = 0;
            group.loaded = false;
            this.groupsPending--;
        }
    }

    /**
     * Handle busy decoder - different strategies for different subclasses
     */
    handleBusyDecoder(group) {
        // CVideoMp4Data uses nextRequest
        if (this.nextRequest !== undefined) {
            this.nextRequest = group;
        }
        // CVideoH264Data uses requestQueue
        if (this.requestQueue && !this.requestQueue.includes(group)) {
            this.requestQueue.push(group);
        }
    }

    purgeGroupsExcept(keep) {
        for (let g in this.groups) {
            const group = this.groups[g];
            if (!keep.has(group) && group.loaded) {
                assert(this.imageCache, "imageCache is undefined when purging groups but groups.length = " + this.groups.length);

                for (let i = group.frame; i < group.frame + group.length; i++) {
                    // release all the frames in this group
                    // Close imageCache (ImageBitmap for WebCodec videos)
                    if (this.imageCache[i]) {
                        // Only close ImageBitmap objects, not regular images
                        if (this.imageCache[i] instanceof ImageBitmap) {
                            try {
                                this.imageCache[i].close(); // Close ImageBitmap to free GPU memory
                            } catch (e) {
                                console.warn("Error closing ImageBitmap during purge:", e);
                            }
                        }
                        this.imageCache[i] = null; // Use null instead of undefined for better garbage collection
                    }
                    
                    // Clean up data caches
                    if (this.imageDataCache && this.imageDataCache[i]) {
                        this.imageDataCache[i] = null;
                    }
                    if (this.frameCache && this.frameCache[i]) {
                        this.frameCache[i] = null;
                    }
                }
                group.loaded = false;
                group.pending = 0; // Reset pending count to prevent stale data
                group.decodeOrder = []; // Clear decode order to free memory
            }
        }
    }

    /**
     * Get the image for a specific frame, loading it if necessary
     * Implements intelligent caching with lookahead/behind windows
     * Returns closest available frame if exact frame not ready
     * @param {number} frame - Frame number to retrieve
     * @returns {ImageBitmap|Canvas|null} The frame image or blank frame
     */
    getImage(frame) {
        frame = Math.floor(frame / this.videoSpeed);

        if (this.incompatible || this.fallbackMode) {
            return this.errorImage;
        }

        // Safety checks - if not initialized yet, return blank frame if possible
        if (!this.groups || this.groups.length === 0 || !this.imageCache || !this.chunks) {
            return this.createBlankFrame();
        }

        // Check for invalid frame numbers - return blank frame instead of null
        if (frame < 0 || frame >= this.chunks.length) {
            return this.createBlankFrame();
        }

        // Detect concurrent frame requests from different timeline positions (thrashing)
        // Skip if this is just normal playback (frame === par.frame)
        const now = performance.now();
        if (this.lastGetImageFrame !== undefined && this.lastGetImageTime !== undefined && frame !== par.frame) {
            const frameDelta = Math.abs(frame - this.lastGetImageFrame);
            const timeDelta = now - this.lastGetImageTime;
            if (frameDelta > 100 && timeDelta < 100) {
                console.warn(`[Video thrashing] Large frame jump: ${this.lastGetImageFrame} -> ${frame} (delta=${frameDelta}) in ${timeDelta.toFixed(0)}ms. Multiple systems may be requesting different frames.`);
            }
        }
        this.lastGetImageTime = now;

        let cacheWindow = 30; // how much we seek ahead (and keep behind)
        const mem = navigator.deviceMemory;
        if (mem !== undefined && mem >= 8) {
            // 8GB or more, then we can afford to cache more
            cacheWindow = 100;

            // PATCH - if we are local, or Mick, then we can afford to cache even more
            // TODO - allow the user to select this window size in some per-user setting
            if (isLocal || Globals.userID === 1) {
         //       cacheWindow = 300;
            }
        }

        this.requestFrame(frame); // request this frame
        this.lastGetImageFrame = frame;

        // we purge everything except the proximate groups and any groups that are being decoded
        const groupsToKeep = new Set(); // Use Set to avoid duplicates

        // iterate through the groups and keep the ones that overlap the range
        // frame to frame + cacheWindow (So we get the next group if we are going forward)
        for (let g in this.groups) {
            const group = this.groups[g];
            if (group.frame + group.length > frame && group.frame < frame + cacheWindow) {
                groupsToKeep.add(group);
            }
        }

        // then frame - cacheWindow to frame, and iterate g backwards so we get the closest first
        for (let g = this.groups.length - 1; g >= 0; g--) {
            const group = this.groups[g];
            if (group.frame + group.length > frame - cacheWindow && group.frame < frame) {
                groupsToKeep.add(group);
            }
        }

        // request them all, will ignore if already loaded or pending
        for (const group of groupsToKeep) {
            this.requestGroup(group);
        }

        // purge all the other groups
        this.purgeGroupsExcept(groupsToKeep);

        assert(this.imageCache, "imageCache is " + this.imageCache + " for frame " + frame + " but groups.length = " + this.groups.length);

        // return the closest frame that has been loaded
        let A = frame;
        let B = frame;
        let bestFrame = frame;
        let foundFrame = false;
        
        while (A >= 0 && B < this.chunks.length) {
            if (A >= 0 && A < this.imageCache.length) {
                const frameA = this.imageCache[A];
                if (frameA && frameA.width && frameA.width > 0) {
                    bestFrame = A;
                    foundFrame = true;
                    break;
                }
            }
            A--;
            
            if (B < this.chunks.length && B < this.imageCache.length) {
                const frameB = this.imageCache[B];
                if (frameB && frameB.width && frameB.width > 0) {
                    bestFrame = B;
                    foundFrame = true;
                    break;
                }
            }
            B++;
        }

        // Check if bestFrame is valid and accessible
        if (foundFrame && bestFrame >= 0 && bestFrame < this.imageCache.length) {
            const image = this.imageCache[bestFrame];
            if (image && image.width && image.width > 0) {
                return image;
            }
        }

        // If no valid frame found, return blank frame
        return this.createBlankFrame();
    }

    isFrameCached(frame) {
        frame = Math.floor(frame / this.videoSpeed);
        if (!this.imageCache || frame < 0 || frame >= this.imageCache.length) {
            return false;
        }
        const cachedFrame = this.imageCache[frame];
        return cachedFrame && cachedFrame.width && cachedFrame.width > 0;
    }

    getImageNoPurge(frame) {
        frame = Math.floor(frame / this.videoSpeed);
        if (!this.imageCache || frame < 0 || frame >= this.imageCache.length) {
            return null;
        }
        const cachedFrame = this.imageCache[frame];
        if (cachedFrame && cachedFrame.width && cachedFrame.width > 0) {
            return cachedFrame;
        }
        return null;
    }

    async requestFrameSequential(frame, timeout = 5000) {
        const actualFrame = Math.floor(frame / this.videoSpeed);
        const startTime = Date.now();
        
        if (!this.decoder || !this.chunks || !this.groups || this.groups.length === 0) {
            return false;
        }
        
        if (this.isFrameCached(frame)) {
            return true;
        }
        
        const group = this.getGroup(actualFrame);
        if (!group) {
            return false;
        }
        
        if (group.loaded) {
            return this.isFrameCached(frame);
        }
        
        if (group.pending === 0) {
            while (this.decoder && this.decoder.decodeQueueSize > 0) {
                if (Date.now() - startTime > timeout) {
                    console.warn(`[reqFrame] ${frame}: TIMEOUT waiting for decoder queue`);
                    return false;
                }
                await new Promise(r => setTimeout(r, 20));
            }
            this.requestGroup(group);
        }
        
        let loadWaitCount = 0;
        while (!group.loaded) {
            // Check for error state: pending=0 but not loaded means decode failed
            if (group.pending === 0 && !group.loaded) {
                console.warn(`[reqFrame] ${frame}: group decode failed`);
                return false;
            }
            
            if (Date.now() - startTime > timeout) {
                console.warn(`[reqFrame] ${frame}: TIMEOUT (pending=${group.pending}, queueSize=${this.decoder?.decodeQueueSize})`);
                return false;
            }
            loadWaitCount++;
            await new Promise(r => setTimeout(r, 20));
        }
        
        return this.isFrameCached(frame);
    }

    async waitForFrame(frame, timeout = 10000) {
        const actualFrame = Math.floor(frame / this.videoSpeed);
        const startTime = Date.now();
        
        // Wait for video initialization (decoder + chunks + groups must be ready)
        while (!this.decoder || !this.chunks || !this.groups || this.groups.length === 0) {
            if (Date.now() - startTime > timeout) {
                console.warn(`waitForFrame: timeout waiting for video initialization, frame ${frame}`);
                return false;
            }
            await new Promise(r => setTimeout(r, 50));
        }
        
        if (this.isFrameCached(frame)) {
            return true;
        }
        
        const group = this.getGroup(actualFrame);
        if (!group) {
            console.warn(`waitForFrame: no group for frame ${frame}`);
            return false;
        }
        
        // If group is already loaded, return immediately
        if (group.loaded) {
            return this.isFrameCached(frame);
        }
        
        // If group is already being decoded, just wait for it
        if (group.pending > 0) {
            while (!group.loaded) {
                if (Date.now() - startTime > timeout) {
                    console.warn(`waitForFrame timeout waiting for pending group, frame ${frame}`);
                    return false;
                }
                await new Promise(r => setTimeout(r, 10));
            }
            return this.isFrameCached(frame);
        }
        
        // Group not loaded and not pending - need to request it
        // Wait only for decoder to be idle (decodeQueueSize === 0), not for all groups
        while (this.decoder && this.decoder.decodeQueueSize > 0) {
            if (Date.now() - startTime > timeout) {
                console.warn(`waitForFrame timeout waiting for decoder queue, frame ${frame}`);
                return false;
            }
            await new Promise(r => setTimeout(r, 10));
        }
        
        // Request our group
        this.requestGroup(group);
        
        // Wait for our group to load
        while (!group.loaded) {
            if (Date.now() - startTime > timeout) {
                console.warn(`waitForFrame timeout waiting for group to load, frame ${frame}`);
                return false;
            }
            await new Promise(r => setTimeout(r, 10));
        }
        
        return this.isFrameCached(frame);
    }

    createBlankFrame() {
        if (!this.videoWidth || !this.videoHeight) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 1; 
            tempCanvas.height = 1;
            const ctx = tempCanvas.getContext('2d');
            ctx.fillStyle = 'black'; 
            ctx.fillRect(0, 0, 1, 1);
            return tempCanvas;
        }

        // if the desired dimensions of the blank frame haven't changed, just return it
        // but if they have, dispose of it, so it gets recreated
        if (this.blankFrame &&
             (this.blankFrame.width !== this.videoWidth ||
            this.blankFrame.height !== this.videoHeight)) {
            // Dispose of old blank frame
            if (typeof this.blankFrame.close === 'function') {
                try {
                    this.blankFrame.close();
                } catch (e) {
                    console.warn("Error closing old blank frame:", e);
                }
            }
            this.blankFrame = null;
            this.blankFramePending = false;
        }

        // If we already have a blank frame or it's pending creation, return it
        if (this.blankFrame) {
            return this.blankFrame;
        }
        
        // If blank frame creation is already pending, return a temporary canvas
        if (this.blankFramePending) {
            if (!this.blankFrameCanvas) {
                this.blankFrameCanvas = document.createElement('canvas');
                this.blankFrameCanvas.width = this.videoWidth;
                this.blankFrameCanvas.height = this.videoHeight;
                const ctx = this.blankFrameCanvas.getContext('2d');
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, this.videoWidth, this.videoHeight);
            }
            return this.blankFrameCanvas;
        }

        // Create a blank canvas with video dimensions
        const canvas = document.createElement('canvas');
        canvas.width = this.videoWidth;
        canvas.height = this.videoHeight;
        const ctx = canvas.getContext('2d');

        // Fill with black
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, this.videoWidth, this.videoHeight);

        // Store canvas for return while ImageBitmap is being created
        this.blankFrameCanvas = canvas;
        this.blankFramePending = true;

        // Convert to ImageBitmap for consistency with decoded frames
        createImageBitmap(canvas).then(bitmap => {
            this.blankFrame = bitmap;
            this.blankFramePending = false;
            // Clean up temporary canvas once we have the bitmap
            this.blankFrameCanvas = null;
        }).catch(error => {
            console.warn("Error creating blank frame ImageBitmap:", error);
            // Fallback to canvas - keep using the canvas
            this.blankFrame = canvas;
            this.blankFramePending = false;
        });

        // Return canvas immediately while ImageBitmap is being created
        return canvas;
    }

    update() {
        super.update();
        if (this.incompatible) return;

        // Ensure rendering continues while groups are pending
        for (let g in this.groups) {
            const group = this.groups[g];
            if (group.pending > 0)
                setRenderOne(true);
        }

        if (isLocal) {
        //     this.debugVideo()
        }
    }

    /**
     * Get GPU memory usage estimate for debugging
     * Note: This is an estimate based on cached frames
     */
    getGPUMemoryEstimate() {
        let cachedCount = 0;
        let cachedBytes = 0;
        
        if (this.imageCache) {
            for (let i = 0; i < this.imageCache.length; i++) {
                const frame = this.imageCache[i];
                if (frame && frame.width && frame.height) {
                    cachedCount++;
                    // Estimate: 4 bytes per pixel (RGBA)
                    cachedBytes += frame.width * frame.height * 4;
                }
            }
        }
        
        const estimatedMB = (cachedBytes / (1024 * 1024)).toFixed(2);
        return { count: cachedCount, estimatedMB: estimatedMB };
    }

    debugVideo() {
        let d = "";

        // Start with filename
        d += "<strong>File: " + this.filename + "</strong><br>";
        
        if (this.config !== undefined && this.decoder && this.groups) {
            // Get config info - allow subclasses to override
            const configInfo = this.getDebugConfigInfo();
            d += configInfo + "<br>";
            
            // Add GPU memory estimate
            const gpuMem = this.getGPUMemoryEstimate();
            d += "GPU Memory (est): " + gpuMem.count + " frames = " + gpuMem.estimatedMB + " MB<br>";
            
            d += "CVideoView: " + this.videoWidth + "x" + this.videoHeight + "<br>";
            d += "par.frame = " + par.frame + ", Sit.frames = " + Sit.frames + ", chunks = " + this.chunks.length + "<br>";
            d += this.lastDecodeInfo;
            d += "Decode Queue Size = " + this.decoder.decodeQueueSize + " State = " + this.decoder.state + "<br>";

            // Add any additional debug info from subclasses
            const additionalInfo = this.getAdditionalDebugInfo();
            if (additionalInfo) {
                d += additionalInfo + "<br>";
            }

            const currentGroup = this.getGroup(par.frame);

            for (let _g in this.groups) {
                const g = this.groups[_g];

                // count how many images and imageDatas we have
                let images = 0;
                let imageDatas = 0;
                let framesCaches = 0;
                if (this.imageCache) {
                    for (let i = g.frame; i < g.frame + g.length; i++) {
                        if (this.imageCache[i] !== undefined && this.imageCache[i].width !== 0)
                            images++;
                        if (this.imageDataCache[i] !== undefined && this.imageDataCache[i].width !== 0)
                            imageDatas++;
                        if (this.frameCache[i] !== undefined)
                            framesCaches++;
                    }
                }

                // Get group info - allow subclasses to customize format
                const groupInfo = this.getDebugGroupInfo(_g, g, images, imageDatas, framesCaches, currentGroup);
                d += groupInfo + "<br>";
            }
        }

        infoDiv.style.display = 'block';
        infoDiv.style.fontSize = "13px";
        infoDiv.style.zIndex = '1001';
        infoDiv.innerHTML = d;
    }

    /**
     * Get config information for debug display - can be overridden by subclasses
     */
    getDebugConfigInfo() {
        const fps = Sit.fps ? ` @ ${Sit.fps}fps` : '';
        return "Config: Codec: " + this.config.codec + "  format:" + this.format + " " + this.videoWidth + "x" + this.videoHeight + fps;
    }

    /**
     * Get additional debug information - can be overridden by subclasses
     */
    getAdditionalDebugInfo() {
        return "";
    }

    /**
     * Get group information for debug display - can be overridden by subclasses
     */
    getDebugGroupInfo(groupIndex, group, images, imageDatas, framesCaches, currentGroup) {
        return "Group " + groupIndex + ": frame " + group.frame + " length " + group.length + " images " + images + " imageDatas " + imageDatas + " framesCaches "
            + framesCaches
            + (group.loaded ? " Loaded " : "")
            + (currentGroup === group ? "*" : " ")
            + (group.pending ? "pending = " + group.pending : "");
    }

    flushEntireCache() {
        if (this.imageCache) {
            // Close all ImageBitmap objects to free memory
            for (let i = 0; i < this.imageCache.length; i++) {
                if (this.imageCache[i]) {
                    if (typeof this.imageCache[i].close === 'function') {
                        try {
                            this.imageCache[i].close();
                        } catch (e) {
                            console.warn("Error closing ImageBitmap during flush:", e);
                        }
                    }
                    this.imageCache[i] = null;
                }
            }
        }

        // Close blank frame if it's an ImageBitmap
        if (this.blankFrame) {
            if (typeof this.blankFrame.close === 'function') {
                try {
                    this.blankFrame.close();
                } catch (e) {
                    console.warn("Error closing blank frame:", e);
                }
            }
            this.blankFrame = null;
        }

        // Clean up blank frame canvas
        if (this.blankFrameCanvas) {
            // Remove from DOM if attached
            if (this.blankFrameCanvas.parentNode) {
                this.blankFrameCanvas.parentNode.removeChild(this.blankFrameCanvas);
            }
            this.blankFrameCanvas = null;
        }

        // Clean up temporary canvas and context
        if (this.c_tmp) {
            // Remove from DOM if attached
            if (this.c_tmp.parentNode) {
                this.c_tmp.parentNode.removeChild(this.c_tmp);
            }
            this.c_tmp = null;
        }
        if (this.ctx_tmp) {
            this.ctx_tmp = null;
        }

        // Reset cache arrays
        this.imageCache = [];
        this.imageDataCache = [];
        this.frameCache = [];

        // Reset groups
        if (this.groups) {
            for (let group of this.groups) {
                group.loaded = false;
                group.pending = 0;
                group.decodeOrder = [];
            }
        }

        this.groupsPending = 0;
        this.nextRequest = null;
        this.requestQueue = [];
        
        // Reset decode frame index
        this.decodeFrameIndex = 0;
    }

    stopStreaming() {
        this.flushEntireCache();
        // Note: We don't close the decoder here to allow continued scrubbing
        // The decoder will be closed only when the video object is destroyed
    }

    // Only call this when completely done with the video (switching videos, etc.)
    destroy() {
        this.closeDecoder();
        this.flushEntireCache();
    }

    closeDecoder() {
        if (this.decoder && this.decoder.state !== 'closed') {
            try {
                this.decoder.close();
                console.log("VideoDecoder closed");
            } catch (error) {
                console.warn("Error closing decoder:", error);
            }
        }
    }

    /**
     * Clean up all resources and cancel pending operations
     * Properly resets decoder, clears callbacks, and releases memory
     * Critical for preventing decoder operations after disposal
     */
    dispose() {
        // Clear callbacks to prevent them from firing after disposal
        this.loadedCallback = null;
        this.errorCallback = null;
        
        // Stop any pending operations
        this.groupsPending = 0;
        this.nextRequest = null;
        this.requestQueue = [];
        
        // Close decoder immediately
        if (this.decoder) {
            const decoder = this.decoder;
            this.decoder = null; // Clear reference immediately
            
            // Try to close immediately if possible
            if (decoder.state !== 'closed') {
                try {
                    // Reset the decoder to cancel all pending operations
                    decoder.reset();
                    // Then close it
                    decoder.close();
                    console.log("VideoDecoder closed successfully");
                } catch (e) {
                    console.warn("Error closing decoder:", e);
                }
            }
        }
        
        // Flush all caches before calling parent dispose
        this.flushEntireCache();
        
        super.dispose();

        delete Sit.videoFile;
        delete Sit.videoFrames;
    }
}