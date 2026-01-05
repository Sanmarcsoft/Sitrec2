import {Globals, guiMenus, NodeMan, setRenderOne, Sit, unregisterFrameBlocker} from "./Globals";
import {par} from "./par";
import {getCV, loadOpenCV} from "./openCVLoader";

let cv = null;

class ObjectTracker {
    constructor(videoView) {
        this.videoView = videoView;
        this.enabled = false;
        this.tracking = false;
        this.overlayCreated = false;
        this.overlay = null;
        this.overlayCtx = null;

        this.trackX = 0;
        this.trackY = 0;
        this.trackRadius = 30;

        this.trackedPositions = new Map();

        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        this.tracker = null;
        this.trackerType = 'CSRT';

        // Centroid tracking for bright spots (stars, etc)
        this.centerOnBright = false;
        this.brightnessThreshold = 128;  // 0-255, pixels above this are considered "bright"

        this.guiFolder = null;
        this.savedPaused = true;
        this.savedFrame = undefined;
    }
    
    createOverlay() {
        if (this.overlayCreated) return;
        this.overlayCreated = true;
        
        this.overlay = document.createElement('canvas');
        this.overlay.style.position = 'absolute';
        this.overlay.style.top = '0';
        this.overlay.style.left = '0';
        this.overlay.style.width = '100%';
        this.overlay.style.height = '100%';
        this.overlay.style.pointerEvents = 'none';
        this.overlay.style.zIndex = '100';
        this.videoView.div.appendChild(this.overlay);
        this.overlayCtx = this.overlay.getContext('2d');
        
        this.hookMouseHandler();
        
        const {width, height} = this.getImageDimensions();
        this.trackX = width / 2;
        this.trackY = height / 2;
    }
    
    hookMouseHandler() {
        const mouse = this.videoView.mouse;
        if (!mouse) return;
        
        const originalDrag = mouse.handlers.drag;
        
        mouse.handlers.down = (e) => {
            if (this.enabled) {
                const x = mouse.x;
                const y = mouse.y;
                const [vX, vY] = this.videoView.canvasToVideoCoords(x, y);
                
                if (this.isWithinTrackPoint(vX, vY)) {
                    this.isDragging = true;
                    this.lastMouseX = vX;
                    this.lastMouseY = vY;
                }
            }
        };
        
        mouse.handlers.drag = (e) => {
            if (this.enabled && this.isDragging) {
                const x = mouse.x;
                const y = mouse.y;
                const [vX, vY] = this.videoView.canvasToVideoCoords(x, y);
                
                this.trackX = vX;
                this.trackY = vY;
                
                const frame = Math.floor(par.frame);
                this.trackedPositions.set(frame, {x: this.trackX, y: this.trackY});
                
                setRenderOne(true);
                return;
            }
            if (originalDrag) originalDrag(e);
        };
        
        mouse.handlers.up = (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                if (this.tracking) {
                    this.initializeTracker();
                }
            }
        };
    }
    
    getImageDimensions() {
        const videoData = this.videoView?.videoData;
        if (!videoData) return {width: 1920, height: 1080};
        const image = videoData.getImage(0);
        return {
            width: image?.width || image?.videoWidth || 1920,
            height: image?.height || image?.videoHeight || 1080,
        };
    }
    
    showOverlay() {
        if (this.overlay) this.overlay.style.display = 'block';
    }
    
    hideOverlay() {
        if (this.overlay) {
            this.overlay.style.display = 'none';
            if (this.overlayCtx) {
                this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
            }
        }
    }
    
    enable() {
        this.enabled = true;
        this.createOverlay();
        this.showOverlay();
        setRenderOne(true);
    }
    
    disable() {
        this.enabled = false;
        this.tracking = false;
        this.hideOverlay();
        this.clearSliderStatus();
        unregisterFrameBlocker('objectTracking');
    }
    
    startTracking() {
        if (!this.enabled) return;
        this.tracking = true;
        this.initializeTracker();
        this.updateSliderStatus();

        this.savedPaused = par.paused;
        this.savedFrame = par.frame;
        Globals.justVideoAnalysis = true;
        par.paused = true;  // Pause the animation loop

        // Start fast tracking loop
        this.runFastTrackingLoop();
    }
    
    async runFastTrackingLoop() {
        const startFrame = Math.floor(par.frame);
        const bFrame = Sit.bFrame ?? (Sit.frames - 1);
        const videoData = this.videoView?.videoData;

        if (!videoData) {
            this.onTrackingComplete();
            return;
        }

        for (let frame = startFrame; frame <= bFrame; frame++) {
            if (!this.tracking) break;

            // Set current frame
            par.frame = frame;

            // Wait for video frame to be loaded (with timeout)
            videoData.getImage(frame);
            await videoData.waitForFrame(frame, 5000);

            // Track this frame
            this.trackFrame(frame);

            // Render only the video viewport
            if (this.videoView && this.videoView.renderCanvas) {
                this.videoView.renderCanvas(frame);
            }

            // Yield to browser every frame to keep UI responsive
            // Using setTimeout(0) allows maximum speed while still being interruptible
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Tracking complete
        this.onTrackingComplete();
    }

    stopTracking() {
        this.tracking = false;
        if (this.tracker) {
            this.tracker = null;
        }
        par.paused = this.savedPaused;
        if (this.savedFrame !== undefined) {
            par.frame = this.savedFrame;
        }
        Globals.justVideoAnalysis = false;
        setRenderOne(true);
    }
    
    onTrackingComplete() {
        this.stopTracking();
        if (startMenuItem) startMenuItem.name("Start Tracking");
        setRenderOne(true);
    }
    
    initializeTracker() {
        const frame = Math.floor(par.frame);
        this.trackedPositions.set(frame, {x: this.trackX, y: this.trackY});
    }
    
    isWithinTrackPoint(vX, vY) {
        const dx = vX - this.trackX;
        const dy = vY - this.trackY;
        return (dx * dx + dy * dy) <= (this.trackRadius * this.trackRadius);
    }

    // Calculate centroid (center of mass) of bright pixels within radius
    // Returns {x, y} or null if no bright pixels found
    calculateBrightCentroid(image, centerX, centerY, radius) {
        const width = image.width || image.videoWidth;
        const height = image.height || image.videoHeight;

        // Create canvas to extract image data
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        let totalBrightness = 0;
        let weightedX = 0;
        let weightedY = 0;
        let pixelCount = 0;

        // Define search region (square around center)
        const minX = Math.max(0, Math.floor(centerX - radius));
        const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
        const minY = Math.max(0, Math.floor(centerY - radius));
        const maxY = Math.min(height - 1, Math.ceil(centerY + radius));

        const radiusSquared = radius * radius;

        // Scan all pixels within the circular region
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                // Check if pixel is within circular radius
                const dx = x - centerX;
                const dy = y - centerY;
                if (dx * dx + dy * dy > radiusSquared) continue;

                const index = (y * width + x) * 4;
                const r = data[index];
                const g = data[index + 1];
                const b = data[index + 2];

                // Calculate brightness (luminance)
                const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

                if (brightness > this.brightnessThreshold) {
                    // Weight by brightness for better centering on bright core
                    const weight = brightness - this.brightnessThreshold;
                    totalBrightness += weight;
                    weightedX += x * weight;
                    weightedY += y * weight;
                    pixelCount++;
                }
            }
        }

        // Calculate centroid
        if (totalBrightness > 0 && pixelCount > 0) {
            return {
                x: weightedX / totalBrightness,
                y: weightedY / totalBrightness
            };
        }

        return null;
    }

    trackFrame(frame) {
        if (!this.tracking || !this.enabled) return;
        // Only require OpenCV for template matching mode
        if (!this.centerOnBright && !cv) return;

        frame = Math.floor(frame);

        if (this.trackedPositions.has(frame)) {
            const pos = this.trackedPositions.get(frame);
            this.trackX = pos.x;
            this.trackY = pos.y;
            return;
        }
        
        let prevFrame = frame - 1;
        while (prevFrame >= 0 && !this.trackedPositions.has(prevFrame)) {
            prevFrame--;
        }
        
        if (prevFrame < 0) return;
        
        const prevPos = this.trackedPositions.get(prevFrame);
        
        const videoData = this.videoView?.videoData;
        if (!videoData) return;
        
        const currImage = videoData.getImage(frame);

        if (!currImage || !currImage.width) return;

        // Use centroid tracking for bright spots (stars, etc)
        if (this.centerOnBright) {
            const centroid = this.calculateBrightCentroid(currImage, prevPos.x, prevPos.y, this.trackRadius);

            if (centroid) {
                this.trackX = centroid.x;
                this.trackY = centroid.y;
            } else {
                // Fallback: keep previous position if no bright pixels found
                this.trackX = prevPos.x;
                this.trackY = prevPos.y;
            }

            this.trackedPositions.set(frame, {x: this.trackX, y: this.trackY});
            this.updateSliderStatus();
            return;
        }

        // Standard template matching tracking
        const prevImage = videoData.getImage(prevFrame);
        if (!prevImage || !prevImage.width) return;

        const width = prevImage.width || prevImage.videoWidth;
        const height = prevImage.height || prevImage.videoHeight;

        const prevCanvas = document.createElement('canvas');
        prevCanvas.width = width;
        prevCanvas.height = height;
        const prevCtx = prevCanvas.getContext('2d');
        prevCtx.drawImage(prevImage, 0, 0, width, height);
        const prevImageData = prevCtx.getImageData(0, 0, width, height);

        const currCanvas = document.createElement('canvas');
        currCanvas.width = width;
        currCanvas.height = height;
        const currCtx = currCanvas.getContext('2d');
        currCtx.drawImage(currImage, 0, 0, width, height);
        const currImageData = currCtx.getImageData(0, 0, width, height);

        const prevMat = cv.matFromImageData(prevImageData);
        const currMat = cv.matFromImageData(currImageData);

        const prevGray = new cv.Mat();
        const currGray = new cv.Mat();
        cv.cvtColor(prevMat, prevGray, cv.COLOR_RGBA2GRAY);
        cv.cvtColor(currMat, currGray, cv.COLOR_RGBA2GRAY);

        const roiSize = this.trackRadius * 2;
        const roiX = Math.max(0, Math.floor(prevPos.x - roiSize));
        const roiY = Math.max(0, Math.floor(prevPos.y - roiSize));
        const roiW = Math.min(roiSize * 2, width - roiX);
        const roiH = Math.min(roiSize * 2, height - roiY);

        const prevROI = prevGray.roi(new cv.Rect(roiX, roiY, roiW, roiH));

        const result = new cv.Mat();
        cv.matchTemplate(currGray, prevROI, result, cv.TM_CCOEFF_NORMED);

        const minMax = cv.minMaxLoc(result);
        const bestX = minMax.maxLoc.x + roiW / 2;
        const bestY = minMax.maxLoc.y + roiH / 2;

        this.trackX = bestX;
        this.trackY = bestY;
        this.trackedPositions.set(frame, {x: this.trackX, y: this.trackY});
        this.updateSliderStatus();

        prevMat.delete();
        currMat.delete();
        prevGray.delete();
        currGray.delete();
        prevROI.delete();
        result.delete();
    }
    
    renderOverlay(frame) {
        if (!this.enabled || !this.overlay) return;
        
        const width = this.videoView.widthPx;
        const height = this.videoView.heightPx;
        
        if (this.overlay.width !== width || this.overlay.height !== height) {
            this.overlay.width = width;
            this.overlay.height = height;
        }
        
        const ctx = this.overlayCtx;
        ctx.clearRect(0, 0, width, height);
        
        if (this.tracking) {
            this.trackFrame(frame);
        }
        
        const [cx, cy] = this.videoView.videoToCanvasCoords(this.trackX, this.trackY);
        
        const {dWidth} = this.videoView;
        const videoWidth = this.videoView.videoWidth || 1;
        const canvasRadius = this.trackRadius * dWidth / videoWidth;
        
        ctx.strokeStyle = this.tracking ? '#00ff00' : '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, canvasRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.strokeStyle = this.tracking ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 255, 0, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - canvasRadius - 5, cy);
        ctx.lineTo(cx + canvasRadius + 5, cy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy - canvasRadius - 5);
        ctx.lineTo(cx, cy + canvasRadius + 5);
        ctx.stroke();
        
        ctx.font = '12px monospace';
        ctx.fillStyle = this.tracking ? '#00ff00' : '#ffff00';
        const status = this.tracking ? 'TRACKING' : 'ENABLED';
        ctx.fillText(`${status} (${Math.round(this.trackX)}, ${Math.round(this.trackY)})`, cx + canvasRadius + 10, cy);
        
        if (this.trackedPositions.size > 1) {
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            let started = false;
            
            const sortedFrames = Array.from(this.trackedPositions.keys()).sort((a, b) => a - b);
            for (const f of sortedFrames) {
                const pos = this.trackedPositions.get(f);
                const [px, py] = this.videoView.videoToCanvasCoords(pos.x, pos.y);
                if (!started) {
                    ctx.moveTo(px, py);
                    started = true;
                } else {
                    ctx.lineTo(px, py);
                }
            }
            ctx.stroke();
        }
    }
    
    clearTrack() {
        this.trackedPositions.clear();
        const frame = Math.floor(par.frame);
        this.trackedPositions.set(frame, {x: this.trackX, y: this.trackY});
        this.updateSliderStatus();
        setRenderOne(true);
    }
    
    getCacheStatusArray() {
        const status = new Array(Sit.frames).fill(0);
        for (const f of this.trackedPositions.keys()) {
            if (f >= 0 && f < Sit.frames) {
                status[f] = 1;
            }
        }
        return status;
    }
    
    updateSliderStatus() {
        const slider = NodeMan.get("FrameSlider", false);
        if (slider) {
            slider.setStatusOverlay(this.getCacheStatusArray(), 2);
        }
    }
    
    clearSliderStatus() {
        const slider = NodeMan.get("FrameSlider", false);
        if (slider) {
            slider.clearStatusOverlay();
        }
    }
}

let objectTracker = null;
let trackingFolder = null;
let enableMenuItem = null;
let startMenuItem = null;
let renderHooked = false;

export function resetObjectTracking() {
    if (objectTracker) {
        // Clear video stabilization
        const videoView = objectTracker.videoView;
        const videoData = videoView?.videoData;
        if (videoData) {
            videoData.setStabilizationEnabled(false);
            videoData.stabilizationData = null;
            videoData.stabilizationReferencePoint = null;
        }

        objectTracker.disable();
        objectTracker = null;
    }
    renderHooked = false;
    if (enableMenuItem) {
        enableMenuItem.name("Enable Tracking");
    }
    if (startMenuItem) {
        startMenuItem.name("Start Tracking");
    }
    if (stabilizeToggleMenuItem) {
        stabilizeToggleMenuItem.name("Enable Stabilization");
    }
}

function toggleEnableTracking() {
    const videoView = NodeMan.get("video", false);
    if (!videoView) {
        alert("No video view found");
        return;
    }
    
    if (objectTracker && objectTracker.enabled) {
        objectTracker.disable();
        if (enableMenuItem) enableMenuItem.name("Enable Tracking");
        if (startMenuItem) startMenuItem.name("Start Tracking");
        if (trackingFolder) trackingFolder.close();
        setRenderOne(true);
        return;
    }
    
    if (!objectTracker) {
        objectTracker = new ObjectTracker(videoView);
    }
    
    objectTracker.enable();
    if (enableMenuItem) enableMenuItem.name("Disable Tracking");
    
    if (!renderHooked) {
        renderHooked = true;
        const originalRender = videoView.renderCanvas.bind(videoView);
        videoView.renderCanvas = function(frame) {
            originalRender(frame);
            if (objectTracker && objectTracker.enabled) {
                objectTracker.renderOverlay(frame);
            }
        };
    }
    
    setRenderOne(true);
}

function toggleStartTracking() {
    if (!objectTracker || !objectTracker.enabled) {
        toggleEnableTracking();
        if (!objectTracker || !objectTracker.enabled) {
            return;
        }
    }
    
    if (objectTracker.tracking) {
        objectTracker.stopTracking();
        if (startMenuItem) startMenuItem.name("Start Tracking");
        setRenderOne(true);
        return;
    }

    // Centroid mode doesn't need OpenCV
    if (objectTracker.centerOnBright) {
        objectTracker.startTracking();
        if (startMenuItem) startMenuItem.name("Stop Tracking");
        setRenderOne(true);
        return;
    }

    // Template matching mode requires OpenCV
    if (cv) {
        objectTracker.startTracking();
        if (startMenuItem) startMenuItem.name("Stop Tracking");
        setRenderOne(true);
        return;
    }

    if (startMenuItem) startMenuItem.name("Loading OpenCV...");

    loadOpenCV().then(() => {
        cv = getCV();
        objectTracker.startTracking();
        if (startMenuItem) startMenuItem.name("Stop Tracking");
        setRenderOne(true);
    }).catch(e => {
        console.error("Failed to load OpenCV:", e);
        alert("Failed to load OpenCV.js: " + e.message);
        if (startMenuItem) startMenuItem.name("Start Tracking");
    });
}

function clearTrack() {
    if (objectTracker) {
        objectTracker.clearTrack();
    }
}

function stabilizeVideo() {
    if (!objectTracker || !objectTracker.enabled) {
        alert("Please enable tracking first and track an object before stabilizing.");
        return;
    }

    if (objectTracker.trackedPositions.size === 0) {
        alert("No tracking data available. Please track an object first.");
        return;
    }

    const videoView = objectTracker.videoView;
    const videoData = videoView?.videoData;

    if (!videoData) {
        alert("No video data available.");
        return;
    }

    // Use the first tracked frame as the reference point
    const firstFrame = Math.min(...objectTracker.trackedPositions.keys());
    const referencePoint = objectTracker.trackedPositions.get(firstFrame);

    if (!referencePoint) {
        alert("Could not determine reference point.");
        return;
    }

    // Pass tracking data to video system
    videoData.setStabilizationData(objectTracker.trackedPositions, referencePoint);
    videoData.setStabilizationEnabled(true);

    if (stabilizeToggleMenuItem) {
        stabilizeToggleMenuItem.name("Disable Stabilization");
    }

    setRenderOne(true);
}

function toggleStabilization() {
    if (!objectTracker || !objectTracker.enabled) {
        return;
    }

    const videoView = objectTracker.videoView;
    const videoData = videoView?.videoData;

    if (!videoData || !videoData.stabilizationData) {
        alert("No stabilization data available. Use 'Stabilize' first.");
        return;
    }

    const newState = !videoData.stabilizationEnabled;
    videoData.setStabilizationEnabled(newState);

    if (stabilizeToggleMenuItem) {
        stabilizeToggleMenuItem.name(newState ? "Disable Stabilization" : "Enable Stabilization");
    }

    setRenderOne(true);
}

let radiusController = null;
let stabilizeToggleMenuItem = null;

export function addObjectTrackingMenu() {
    if (!guiMenus.view) return;
    
    trackingFolder = guiMenus.view.addFolder("Tracking").close().perm();
    
    const menuActions = {
        enableTracking: toggleEnableTracking,
        startTracking: toggleStartTracking,
        clearTrack: clearTrack,
        stabilizeVideo: stabilizeVideo,
        toggleStabilization: toggleStabilization,
    };
    
    enableMenuItem = trackingFolder.add(menuActions, 'enableTracking')
        .name("Enable Tracking")
        .tooltip("Toggle display of the tracking cursor on video")
        .perm();
    
    startMenuItem = trackingFolder.add(menuActions, 'startTracking')
        .name("Start Tracking")
        .tooltip("Start/stop tracking the object inside the cursor as video plays")
        .perm();
    
    trackingFolder.add(menuActions, 'clearTrack')
        .name("Clear Track")
        .tooltip("Clear all tracked positions and start fresh")
        .perm();

    trackingFolder.add(menuActions, 'stabilizeVideo')
        .name("Stabilize")
        .tooltip("Apply tracked positions to stabilize the video")
        .perm();

    stabilizeToggleMenuItem = trackingFolder.add(menuActions, 'toggleStabilization')
        .name("Enable Stabilization")
        .tooltip("Toggle video stabilization on/off")
        .perm();

    const radiusParams = {
        get trackRadius() { return objectTracker?.trackRadius ?? 30; },
        set trackRadius(v) { 
            if (objectTracker) {
                objectTracker.trackRadius = v;
                setRenderOne(true);
            }
        }
    };
    
    radiusController = trackingFolder.add(radiusParams, 'trackRadius', 10, 100, 1)
        .name("Track Radius")
        .tooltip("Size of the tracking region")
        .perm();

    const centerOnBrightParams = {
        get centerOnBright() { return objectTracker?.centerOnBright ?? false; },
        set centerOnBright(v) {
            if (objectTracker) {
                objectTracker.centerOnBright = v;
                // Clear track when switching modes to avoid confusion
                if (objectTracker.tracking) {
                    objectTracker.clearTrack();
                }
                setRenderOne(true);
            }
        }
    };

    trackingFolder.add(centerOnBrightParams, 'centerOnBright')
        .name("Center on Bright")
        .tooltip("Track centroid of bright pixels (better for stars/point lights)")
        .perm();

    const brightnessParams = {
        get brightnessThreshold() { return objectTracker?.brightnessThreshold ?? 128; },
        set brightnessThreshold(v) {
            if (objectTracker) {
                objectTracker.brightnessThreshold = v;
                setRenderOne(true);
            }
        }
    };

    trackingFolder.add(brightnessParams, 'brightnessThreshold', 0, 255, 1)
        .name("Brightness Threshold")
        .tooltip("Minimum brightness to consider (0-255). Only used in Center on Bright mode")
        .perm();
}

export function getObjectTracker() {
    return objectTracker;
}
