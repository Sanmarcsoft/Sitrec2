import {guiMenus, NodeMan, setRenderOne,} from "./Globals";
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
        
        this.guiFolder = null;
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
        this.overlay.style.pointerEvents = 'auto';
        this.overlay.style.zIndex = '100';
        this.overlay.style.cursor = 'crosshair';
        this.videoView.div.appendChild(this.overlay);
        this.overlayCtx = this.overlay.getContext('2d');
        
        this.overlay.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.overlay.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.overlay.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.overlay.addEventListener('mouseleave', (e) => this.onMouseUp(e));
        
        const {width, height} = this.getImageDimensions();
        this.trackX = width / 2;
        this.trackY = height / 2;
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
    }
    
    startTracking() {
        if (!this.enabled) return;
        this.tracking = true;
        this.initializeTracker();
    }
    
    stopTracking() {
        this.tracking = false;
        if (this.tracker) {
            this.tracker = null;
        }
    }
    
    initializeTracker() {
        const frame = Math.floor(par.frame);
        this.trackedPositions.set(frame, {x: this.trackX, y: this.trackY});
    }
    
    getMouseVideoCoords(e) {
        const rect = this.overlay.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        
        const scaleX = this.overlay.width / rect.width;
        const scaleY = this.overlay.height / rect.height;
        const cx = canvasX * scaleX;
        const cy = canvasY * scaleY;
        
        return this.videoView.canvasToVideoCoords(cx, cy);
    }
    
    isWithinTrackPoint(vX, vY) {
        const dx = vX - this.trackX;
        const dy = vY - this.trackY;
        return (dx * dx + dy * dy) <= (this.trackRadius * this.trackRadius);
    }
    
    onMouseDown(e) {
        if (!this.enabled) return;
        
        const [vX, vY] = this.getMouseVideoCoords(e);
        
        if (this.isWithinTrackPoint(vX, vY)) {
            this.isDragging = true;
            this.lastMouseX = vX;
            this.lastMouseY = vY;
            this.overlay.style.cursor = 'grabbing';
        }
    }
    
    onMouseMove(e) {
        if (!this.enabled) return;
        
        const [vX, vY] = this.getMouseVideoCoords(e);
        
        if (this.isDragging) {
            this.trackX = vX;
            this.trackY = vY;
            
            const frame = Math.floor(par.frame);
            this.trackedPositions.set(frame, {x: this.trackX, y: this.trackY});
            
            setRenderOne(true);
        } else {
            if (this.isWithinTrackPoint(vX, vY)) {
                this.overlay.style.cursor = 'grab';
            } else {
                this.overlay.style.cursor = 'crosshair';
            }
        }
    }
    
    onMouseUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            this.overlay.style.cursor = 'grab';
            
            if (this.tracking) {
                this.initializeTracker();
            }
        }
    }
    
    trackFrame(frame) {
        if (!this.tracking || !this.enabled || !cv) return;
        
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
        
        const prevImage = videoData.getImage(prevFrame);
        const currImage = videoData.getImage(frame);
        
        if (!prevImage || !currImage || !prevImage.width || !currImage.width) return;
        
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
        setRenderOne(true);
    }
}

let objectTracker = null;
let trackingFolder = null;
let enableMenuItem = null;
let startMenuItem = null;
let renderHooked = false;

export function resetObjectTracking() {
    if (objectTracker) {
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
        alert("Please enable tracking first");
        return;
    }
    
    if (objectTracker.tracking) {
        objectTracker.stopTracking();
        if (startMenuItem) startMenuItem.name("Start Tracking");
        setRenderOne(true);
        return;
    }
    
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

let radiusController = null;

export function addObjectTrackingMenu() {
    if (!guiMenus.view) return;
    
    trackingFolder = guiMenus.view.addFolder("Tracking").close().perm();
    
    const menuActions = {
        enableTracking: toggleEnableTracking,
        startTracking: toggleStartTracking,
        clearTrack: clearTrack,
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
}

export function getObjectTracker() {
    return objectTracker;
}
