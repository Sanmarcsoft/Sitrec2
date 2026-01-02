import {guiMenus, NodeMan, setRenderOne, Sit} from "./Globals";

import {CNodeMaskOverlay} from "./nodes/CNodeMaskOverlay";

let cv = null;
let cvLoadPromise = null;

function loadOpenCV() {
    if (cv) return Promise.resolve();
    if (cvLoadPromise) return cvLoadPromise;

    cvLoadPromise = new Promise((resolve, reject) => {
        let done = false;

        const fail = (err) => {
            if (done) return;
            done = true;
            cvLoadPromise = null;
            reject(err);
        };

        const succeed = () => {
            if (done) return;
            done = true;
            cv = window.cv;
            resolve();
        };

        const timeout = setTimeout(() => {
            fail(new Error("OpenCV.js load timeout (60s)"));
        }, 60000);

        if (window.cv && window.cv.onRuntimeInitialized == null && window.cv.Mat) {
            clearTimeout(timeout);
            succeed();
            return;
        }

        window.cv = window.cv || {};
        if (typeof window.cv.locateFile !== "function") {
            window.cv.locateFile = (file) => "./libs/" + file;
        }

        const existing = document.querySelector('script[data-opencvjs="1"]');
        if (existing) {
            clearTimeout(timeout);
            if (window.cv && typeof window.cv.onRuntimeInitialized === "function") {
                const prev = window.cv.onRuntimeInitialized;
                window.cv.onRuntimeInitialized = () => {
                    try { if (typeof prev === "function") prev(); } catch {}
                    succeed();
                };
            } else if (window.cv && window.cv.Mat) {
                succeed();
            } else {
                fail(new Error("OpenCV.js present but not initialized"));
            }
            return;
        }

        const script = document.createElement("script");
        script.src = "./libs/opencv.js";
        script.async = true;
        script.dataset.opencvjs = "1";

        script.onload = () => {
            if (window.cv && typeof window.cv.onRuntimeInitialized === "function") {
                const prev = window.cv.onRuntimeInitialized;
                window.cv.onRuntimeInitialized = () => {
                    try { if (typeof prev === "function") prev(); } catch {}
                    clearTimeout(timeout);
                    succeed();
                };
            } else {
                const start = performance.now();
                const poll = () => {
                    if (done) return;
                    if (window.cv && window.cv.Mat) {
                        clearTimeout(timeout);
                        succeed();
                        return;
                    }
                    if (performance.now() - start > 60000) {
                        clearTimeout(timeout);
                        fail(new Error("OpenCV.js init timeout (no onRuntimeInitialized)"));
                        return;
                    }
                    setTimeout(poll, 50);
                };
                poll();
            }
        };

        script.onerror = () => {
            clearTimeout(timeout);
            fail(new Error("Failed to load OpenCV.js script"));
        };

        document.head.appendChild(script);
    });

    return cvLoadPromise;
}

class MotionAnalyzer {
    constructor(videoView) {
        this.videoView = videoView;
        this.active = false;
        this.overlaysCreated = false;
        this.overlay = null;
        this.overlayCtx = null;
        this.graphCanvas = null;
        this.graphCtx = null;
        
        this.params = {
            maxFeatures: 300,
            qualityLevel: 0.01,
            minDistance: 10,
            blurSize: 5,
            frameSkip: 3,
            minMotion: 0.2,
            maxMotion: 100,
            minQuality: 0.3,
            maxTrackError: 15,
            staticThreshold: 0.3,
            staticFrames: 15,
            smoothingAlpha: 0.9,
            inlierThreshold: 0.6,
        };
        
        this.frameBuffer = [];
        this.maxBufferSize = 10;
        this.staticHistory = new Map();
        
        this.angleHistory = [];
        this.maxHistoryLength = 300;
        
        this.smoothedDirection = {x: 0, y: 0, angle: 0, magnitude: 0, confidence: 0};
        
        this.lastFlowData = null;
        this.guiFolder = null;
        
        this.maskOverlayNode = null;
        this.maskEnabled = true;
        this.brushSize = 20;
        
        this.resultCache = new Map();
        this.lastAFrame = null;
        this.lastBFrame = null;
        this.lastVideoDataId = null;
    }
    
    invalidateCache() {
        this.resultCache.clear();
        this.frameBuffer = [];
        this.staticHistory.clear();
        this.angleHistory = [];
        this.smoothedDirection = {x: 0, y: 0, angle: 0, magnitude: 0, confidence: 0};
        this.lastFlowData = null;
    }
    
    onParamChange() {
        this.invalidateCache();
        setRenderOne(true);
    }
    
    onMaskChange() {
        this.invalidateCache();
        setRenderOne(true);
    }
    
    setMaskEditing(enabled) {
        if (this.maskOverlayNode) {
            this.maskOverlayNode.setVisible(enabled);
            setRenderOne(true);
        }
    }
    
    clearMask() {
        if (this.maskOverlayNode) {
            this.maskOverlayNode.clearMask();
        }
    }

    createOverlays() {
        if (this.overlaysCreated) return;
        this.overlaysCreated = true;

        this.maskOverlayNode = new CNodeMaskOverlay({
            id: "motionMaskOverlay",
            overlayView: this.videoView,
            brushSize: this.brushSize,
            visible: false,
            onMaskChange: () => this.onMaskChange(),
        });

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
        
        this.graphCanvas = document.createElement('canvas');
        this.graphCanvas.style.position = 'absolute';
        this.graphCanvas.style.bottom = '10px';
        this.graphCanvas.style.right = '10px';
        this.graphCanvas.style.width = '200px';
        this.graphCanvas.style.height = '80px';
        this.graphCanvas.style.pointerEvents = 'none';
        this.graphCanvas.style.zIndex = '101';
        this.graphCanvas.style.background = 'rgba(0,0,0,0.5)';
        this.graphCanvas.style.borderRadius = '4px';
        this.graphCanvas.width = 200;
        this.graphCanvas.height = 80;
        this.videoView.div.appendChild(this.graphCanvas);
        this.graphCtx = this.graphCanvas.getContext('2d');
    }

    showOverlays() {
        if (this.overlay) this.overlay.style.display = 'block';
        if (this.graphCanvas) this.graphCanvas.style.display = 'block';
    }
    
    hideOverlays() {
        if (this.overlay) {
            this.overlay.style.display = 'none';
            this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        }
        if (this.graphCanvas) this.graphCanvas.style.display = 'none';
        if (this.maskOverlayNode) this.maskOverlayNode.setVisible(false);
    }

    start() {
        this.active = true;
        this.createOverlays();
        this.showOverlays();
    }

    stop() {
        this.active = false;
        this.hideOverlays();
    }

    analyze(frame) {
        if (!this.active || !cv) return;

        const videoData = this.videoView.videoData;
        if (!videoData) return;

        const videoId = videoData.id || videoData.filename || 'unknown';
        if (this.lastVideoDataId !== videoId) {
            this.lastVideoDataId = videoId;
            this.invalidateCache();
        }
        
        if (this.lastAFrame !== Sit.aFrame || this.lastBFrame !== Sit.bFrame) {
            this.lastAFrame = Sit.aFrame;
            this.lastBFrame = Sit.bFrame;
            this.invalidateCache();
        }

        const cached = this.resultCache.get(frame);
        if (cached) {
            this.lastFlowData = cached.flowData;
            this.smoothedDirection = cached.smoothedDirection;
            this.angleHistory = cached.angleHistory;
            this.drawOverlay(this.videoView.widthPx, this.videoView.heightPx, cached.imgWidth, cached.imgHeight);
            this.drawGraph();
            return;
        }

        const image = videoData.getImage(frame);
        if (!image) return;

        const width = this.videoView.widthPx;
        const height = this.videoView.heightPx;

        if (this.overlay.width !== width || this.overlay.height !== height) {
            this.overlay.width = width;
            this.overlay.height = height;
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width || image.videoWidth || width;
        tempCanvas.height = image.height || image.videoHeight || height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(image, 0, 0, tempCanvas.width, tempCanvas.height);
        
        if (this.maskOverlayNode) {
            this.maskOverlayNode.initMask(tempCanvas.width, tempCanvas.height);
        }
        
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

        const src = cv.matFromImageData(imageData);
        const grayRaw = new cv.Mat();
        cv.cvtColor(src, grayRaw, cv.COLOR_RGBA2GRAY);
        src.delete();

        const gray = new cv.Mat();
        const blurSize = Math.max(1, Math.floor(this.params.blurSize) | 1);
        if (blurSize > 1) {
            cv.GaussianBlur(grayRaw, gray, new cv.Size(blurSize, blurSize), 0);
            grayRaw.delete();
        } else {
            gray.delete();
            grayRaw.copyTo(gray);
            grayRaw.delete();
        }

        this.frameBuffer.push({gray: gray.clone(), frame, width: tempCanvas.width, height: tempCanvas.height});
        
        while (this.frameBuffer.length > this.maxBufferSize) {
            const old = this.frameBuffer.shift();
            if (old.gray) old.gray.delete();
        }

        const skipFrames = Math.max(1, Math.round(this.params.frameSkip));
        const compareIdx = this.frameBuffer.length - 1 - skipFrames;
        
        if (compareIdx >= 0) {
            const prevEntry = this.frameBuffer[compareIdx];
            this.computeOpticalFlow(prevEntry.gray, gray, tempCanvas.width, tempCanvas.height, skipFrames);
        }

        gray.delete();

        this.resultCache.set(frame, {
            flowData: this.lastFlowData ? {...this.lastFlowData, vectors: [...this.lastFlowData.vectors]} : null,
            smoothedDirection: {...this.smoothedDirection},
            angleHistory: [...this.angleHistory],
            imgWidth: tempCanvas.width,
            imgHeight: tempCanvas.height,
        });

        this.drawOverlay(width, height, tempCanvas.width, tempCanvas.height);
        this.drawGraph();
    }

    isPointMasked(x, y) {
        if (!this.maskEnabled || !this.maskOverlayNode) return false;
        return this.maskOverlayNode.isPointMasked(x, y);
    }

    computeOpticalFlow(prevGray, gray, imgWidth, imgHeight, skipFrames = 1) {
        const corners = new cv.Mat();
        
        try {
            cv.goodFeaturesToTrack(prevGray, corners, this.params.maxFeatures, this.params.qualityLevel, this.params.minDistance);
        } catch (e) {
            corners.delete();
            return;
        }

        if (corners.rows === 0) {
            corners.delete();
            return;
        }

        const prevPtsMat = corners;
        const nextPtsMat = new cv.Mat();
        const status = new cv.Mat();
        const err = new cv.Mat();

        try {
            cv.calcOpticalFlowPyrLK(prevGray, gray, prevPtsMat, nextPtsMat, status, err);
        } catch (e) {
            prevPtsMat.delete();
            nextPtsMat.delete();
            status.delete();
            err.delete();
            return;
        }

        const flowVectors = [];
        const motionScale = 1 / skipFrames;
        
        for (let i = 0; i < status.rows; i++) {
            if (status.data[i] !== 1) continue;
            
            const px = prevPtsMat.floatAt(i, 0);
            const py = prevPtsMat.floatAt(i, 1);
            
            if (this.isPointMasked(px, py)) continue;
            
            const nx = nextPtsMat.floatAt(i, 0);
            const ny = nextPtsMat.floatAt(i, 1);
            const dxRaw = nx - px;
            const dyRaw = ny - py;
            const dx = dxRaw * motionScale;
            const dy = dyRaw * motionScale;
            const mag = Math.sqrt(dx * dx + dy * dy);
            const trackError = err.floatAt(i, 0);
            
            if (trackError > this.params.maxTrackError) continue;
            
            const key = `${Math.round(px / 20)}_${Math.round(py / 20)}`;
            let staticScore = this.staticHistory.get(key) || 0;
            
            if (mag < this.params.staticThreshold) {
                staticScore = Math.min(staticScore + 1, this.params.staticFrames);
            } else {
                staticScore = Math.max(staticScore - 2, 0);
            }
            this.staticHistory.set(key, staticScore);
            
            const isStatic = staticScore >= this.params.staticFrames * 0.7;
            
            if (isStatic) continue;
            if (mag < this.params.minMotion || mag > this.params.maxMotion) continue;
            
            const errorQuality = Math.max(0, 1 - trackError / this.params.maxTrackError);
            const magQuality = Math.min(1, mag / 1.0);
            const quality = errorQuality * magQuality;
            
            if (quality < this.params.minQuality) continue;
            
            flowVectors.push({
                px, py, dx, dy, mag, quality,
                angle: Math.atan2(dy, dx),
                trackError
            });
        }

        prevPtsMat.delete();
        nextPtsMat.delete();
        status.delete();
        err.delete();

        if (flowVectors.length < 3) {
            this.lastFlowData = {vectors: [], consensus: null};
            return;
        }

        const consensus = this.findConsensusDirection(flowVectors);
        
        if (consensus) {
            const alpha = this.params.smoothingAlpha;
            this.smoothedDirection.x = alpha * this.smoothedDirection.x + (1 - alpha) * consensus.dx;
            this.smoothedDirection.y = alpha * this.smoothedDirection.y + (1 - alpha) * consensus.dy;
            this.smoothedDirection.magnitude = Math.sqrt(
                this.smoothedDirection.x * this.smoothedDirection.x + 
                this.smoothedDirection.y * this.smoothedDirection.y
            );
            this.smoothedDirection.angle = Math.atan2(this.smoothedDirection.y, this.smoothedDirection.x);
            this.smoothedDirection.confidence = alpha * this.smoothedDirection.confidence + (1 - alpha) * consensus.confidence;
            
            this.angleHistory.push({
                angle: this.smoothedDirection.angle,
                confidence: this.smoothedDirection.confidence
            });
            if (this.angleHistory.length > this.maxHistoryLength) {
                this.angleHistory.shift();
            }
        }

        this.lastFlowData = {vectors: flowVectors, consensus};
    }

    findConsensusDirection(vectors) {
        if (vectors.length < 3) return null;

        const numBins = 36;
        const binSize = (2 * Math.PI) / numBins;
        const bins = new Array(numBins).fill(null).map(() => []);
        
        for (const v of vectors) {
            let angle = v.angle;
            if (angle < 0) angle += 2 * Math.PI;
            const bin = Math.floor(angle / binSize) % numBins;
            bins[bin].push(v);
        }

        let bestBin = -1;
        let bestScore = 0;
        
        for (let i = 0; i < numBins; i++) {
            const neighbors = [
                bins[(i - 1 + numBins) % numBins],
                bins[i],
                bins[(i + 1) % numBins]
            ].flat();
            
            const score = neighbors.reduce((sum, v) => sum + v.quality * v.mag, 0);
            if (score > bestScore) {
                bestScore = score;
                bestBin = i;
            }
        }

        if (bestBin < 0) return null;

        const inliers = [
            bins[(bestBin - 1 + numBins) % numBins],
            bins[bestBin],
            bins[(bestBin + 1) % numBins]
        ].flat();

        if (inliers.length < 2) return null;

        let sumDx = 0, sumDy = 0, sumWeight = 0;
        for (const v of inliers) {
            const weight = v.quality * v.mag;
            sumDx += v.dx * weight;
            sumDy += v.dy * weight;
            sumWeight += weight;
        }

        if (sumWeight < 0.01) return null;

        const dx = sumDx / sumWeight;
        const dy = sumDy / sumWeight;
        const confidence = Math.min(1, inliers.length / vectors.length + 0.2) * 
                          Math.min(1, sumWeight / (vectors.length * 2));

        for (const v of vectors) {
            const dotProduct = (v.dx * dx + v.dy * dy) / (v.mag * Math.sqrt(dx*dx + dy*dy) + 0.001);
            v.isInlier = dotProduct > this.params.inlierThreshold;
        }

        return {dx, dy, confidence, inlierCount: inliers.length};
    }

    getVideoBounds(canvasWidth, canvasHeight, videoWidth, videoHeight) {
        const aspectSource = videoWidth / videoHeight;
        const aspectView = canvasWidth / canvasHeight;
        
        let dx, dy, dWidth, dHeight;
        
        if (aspectSource > aspectView) {
            dx = 0;
            dy = (canvasHeight - canvasWidth / aspectSource) / 2;
            dWidth = canvasWidth;
            dHeight = canvasWidth / aspectSource;
        } else {
            dx = (canvasWidth - canvasHeight * aspectSource) / 2;
            dy = 0;
            dWidth = canvasHeight * aspectSource;
            dHeight = canvasHeight;
        }
        
        return {dx, dy, dWidth, dHeight};
    }

    drawOverlay(width, height, imgWidth, imgHeight) {
        const ctx = this.overlayCtx;
        ctx.clearRect(0, 0, width, height);

        if (!this.lastFlowData) return;

        const bounds = this.getVideoBounds(width, height, imgWidth, imgHeight);
        const scaleX = bounds.dWidth / imgWidth;
        const scaleY = bounds.dHeight / imgHeight;
        const arrowScale = 3;

        for (const v of this.lastFlowData.vectors) {
            const cx = bounds.dx + v.px * scaleX;
            const cy = bounds.dy + v.py * scaleY;
            const dx = v.dx * scaleX * arrowScale;
            const dy = v.dy * scaleY * arrowScale;
            const mag = Math.sqrt(dx * dx + dy * dy);

            if (mag < 1) continue;

            const hue = v.isInlier ? 120 : 0;
            const sat = 80;
            const light = 40 + v.quality * 30;
            ctx.strokeStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
            ctx.lineWidth = 1 + v.quality;

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + dx, cy + dy);
            ctx.stroke();

            const angle = Math.atan2(dy, dx);
            const headLen = Math.min(mag * 0.3, 6);
            ctx.beginPath();
            ctx.moveTo(cx + dx, cy + dy);
            ctx.lineTo(cx + dx - headLen * Math.cos(angle - Math.PI / 6), cy + dy - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(cx + dx, cy + dy);
            ctx.lineTo(cx + dx - headLen * Math.cos(angle + Math.PI / 6), cy + dy - headLen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
        }

        if (this.smoothedDirection.magnitude > 0.5 && this.smoothedDirection.confidence > 0.1) {
            const centerX = bounds.dx + bounds.dWidth / 2;
            const centerY = bounds.dy + bounds.dHeight / 2;
            const arrowLen = Math.min(bounds.dWidth, bounds.dHeight) * 0.15 * Math.min(1, this.smoothedDirection.magnitude / 5);
            const dx = Math.cos(this.smoothedDirection.angle) * arrowLen;
            const dy = Math.sin(this.smoothedDirection.angle) * arrowLen;

            const alpha = Math.min(1, this.smoothedDirection.confidence * 1.5);
            ctx.strokeStyle = `rgba(255, 255, 0, ${alpha})`;
            ctx.fillStyle = `rgba(255, 255, 0, ${alpha})`;
            ctx.lineWidth = 4;

            ctx.beginPath();
            ctx.moveTo(centerX - dx * 0.5, centerY - dy * 0.5);
            ctx.lineTo(centerX + dx, centerY + dy);
            ctx.stroke();

            const angle = this.smoothedDirection.angle;
            const headLen = arrowLen * 0.3;
            ctx.beginPath();
            ctx.moveTo(centerX + dx, centerY + dy);
            ctx.lineTo(centerX + dx - headLen * Math.cos(angle - Math.PI / 5), centerY + dy - headLen * Math.sin(angle - Math.PI / 5));
            ctx.lineTo(centerX + dx - headLen * Math.cos(angle + Math.PI / 5), centerY + dy - headLen * Math.sin(angle + Math.PI / 5));
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.font = '12px monospace';
            const angleDeg = ((this.smoothedDirection.angle * 180 / Math.PI) + 360) % 360;
            ctx.fillText(`${angleDeg.toFixed(1)}° (${(this.smoothedDirection.confidence * 100).toFixed(0)}%)`, 
                        centerX + dx + 10, centerY + dy);
        }
    }

    drawGraph() {
        const ctx = this.graphCtx;
        const w = this.graphCanvas.width;
        const h = this.graphCanvas.height;
        
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        if (this.angleHistory.length < 2) return;

        ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        for (let i = 0; i < this.angleHistory.length; i++) {
            const x = (i / this.maxHistoryLength) * w;
            const normalizedAngle = this.angleHistory[i].angle / Math.PI;
            const y = h / 2 - normalizedAngle * (h / 2 - 5);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '9px monospace';
        ctx.fillText('Motion Angle', 5, 12);
        ctx.fillText('+180°', w - 30, 12);
        ctx.fillText('-180°', w - 30, h - 3);
    }
}

let motionAnalyzer = null;
let analyzeMenuItem = null;
let renderHooked = false;

export function toggleMotionAnalysis() {
    const videoView = NodeMan.get("video", false);
    if (!videoView) {
        alert("No video view found");
        return;
    }

    if (motionAnalyzer && motionAnalyzer.active) {
        motionAnalyzer.stop();
        removeParamSliders();
        if (analyzeMenuItem) {
            analyzeMenuItem.name("Analyze Motion");
        }
        if (motionFolder) {
            motionFolder.close();
        }
        setRenderOne(true);
        return;
    }

    if (cv) {
        startAnalysis(videoView);
        return;
    }
    
    if (analyzeMenuItem) {
        analyzeMenuItem.name("Loading OpenCV...");
    }
    
    loadOpenCV().then(() => {
        startAnalysis(videoView);
    }).catch(e => {
        console.error("Failed to load OpenCV:", e);
        alert("Failed to load OpenCV.js: " + e.message);
        if (analyzeMenuItem) {
            analyzeMenuItem.name("Analyze Motion");
        }
    });
}

let paramControllers = [];

function startAnalysis(videoView) {
    if (!motionAnalyzer) {
        motionAnalyzer = new MotionAnalyzer(videoView);
    }
    motionAnalyzer.start();
    
    if (analyzeMenuItem) {
        analyzeMenuItem.name("Stop Analysis");
    }

    createParamSliders();

    if (!renderHooked) {
        renderHooked = true;
        const originalRender = videoView.renderCanvas.bind(videoView);
        videoView.renderCanvas = function(frame) {
            originalRender(frame);
            if (motionAnalyzer && motionAnalyzer.active) {
                motionAnalyzer.analyze(frame);
            }
        };
    }

    setRenderOne(true);
}

let motionFolder = null;

export function addMotionAnalysisMenu() {
    if (!guiMenus.view) return;
    
    motionFolder = guiMenus.view.addFolder("Motion Analysis").close();
    
    const menuActions = {
        analyzeMotion: toggleMotionAnalysis
    };

    analyzeMenuItem = motionFolder.add(menuActions, 'analyzeMotion')
        .name("Analyze Motion")
        .tooltip("Toggle real-time motion analysis overlay on video");
}

function createParamSliders() {
    if (!motionFolder || !motionAnalyzer) return;
    
    removeParamSliders();
    
    const p = motionAnalyzer.params;
    const invalidate = () => motionAnalyzer.onParamChange();
    const update = () => setRenderOne(true);
    
    paramControllers.push(motionFolder.add(p, 'frameSkip', 1, 10, 1).name("Frame Skip").onChange(invalidate)
        .tooltip("Frames between comparisons (higher = detect slower motion)"));
    paramControllers.push(motionFolder.add(p, 'blurSize', 1, 15, 2).name("Blur Size").onChange(invalidate)
        .tooltip("Gaussian blur for macro features (odd numbers)"));
    paramControllers.push(motionFolder.add(p, 'maxFeatures', 50, 500, 10).name("Max Features").onChange(invalidate)
        .tooltip("Maximum tracked features"));
    paramControllers.push(motionFolder.add(p, 'minDistance', 5, 50, 1).name("Min Distance").onChange(invalidate)
        .tooltip("Minimum distance between features"));
    paramControllers.push(motionFolder.add(p, 'qualityLevel', 0.001, 0.1, 0.001).name("Quality Level").onChange(invalidate)
        .tooltip("Feature detection quality threshold"));
    paramControllers.push(motionFolder.add(p, 'minQuality', 0, 1, 0.05).name("Min Quality").onChange(invalidate)
        .tooltip("Minimum quality to display arrow"));
    paramControllers.push(motionFolder.add(p, 'maxTrackError', 5, 50, 1).name("Max Track Error").onChange(invalidate)
        .tooltip("Maximum tracking error threshold"));
    paramControllers.push(motionFolder.add(p, 'minMotion', 0, 2, 0.1).name("Min Motion").onChange(invalidate)
        .tooltip("Minimum motion magnitude (pixels/frame)"));
    paramControllers.push(motionFolder.add(p, 'maxMotion', 10, 200, 5).name("Max Motion").onChange(invalidate)
        .tooltip("Maximum motion magnitude"));
    paramControllers.push(motionFolder.add(p, 'staticThreshold', 0.1, 2, 0.1).name("Static Threshold").onChange(invalidate)
        .tooltip("Motion below this is considered static (HUD)"));
    paramControllers.push(motionFolder.add(p, 'staticFrames', 5, 30, 1).name("Static Frames").onChange(invalidate)
        .tooltip("Frames to confirm static detection"));
    paramControllers.push(motionFolder.add(p, 'smoothingAlpha', 0.5, 0.99, 0.01).name("Smoothing").onChange(invalidate)
        .tooltip("Direction smoothing (higher = more smoothing)"));
    paramControllers.push(motionFolder.add(p, 'inlierThreshold', 0.3, 0.9, 0.05).name("Inlier Threshold").onChange(invalidate)
        .tooltip("Threshold for consensus direction agreement"));
    
    const maskControls = {
        editMask: false,
        clearMask: () => {
            if (motionAnalyzer) {
                motionAnalyzer.clearMask();
                motionAnalyzer.onMaskChange();
            }
        }
    };
    
    paramControllers.push(motionFolder.add(motionAnalyzer, 'maskEnabled').name("Enable Mask").onChange(() => {
        motionAnalyzer.onMaskChange();
    }).tooltip("Enable/disable mask filtering"));
    
    paramControllers.push(motionFolder.add(maskControls, 'editMask').name("Edit Mask").onChange((v) => {
        motionAnalyzer.setMaskEditing(v);
    }).tooltip("Click and drag to paint mask (Alt/Option to erase)"));
    
    if (motionAnalyzer.maskOverlayNode) {
        paramControllers.push(motionFolder.add(motionAnalyzer.maskOverlayNode, 'brushSize', 5, 50, 1).name("Brush Size").onChange(update)
            .tooltip("Mask brush size in pixels"));
    }
    
    paramControllers.push(motionFolder.add(maskControls, 'clearMask').name("Clear Mask")
        .tooltip("Clear all mask data"));
    
    motionFolder.open();
}

function removeParamSliders() {
    for (const ctrl of paramControllers) {
        try { ctrl.destroy(); } catch (e) {}
    }
    paramControllers = [];
}
