import {
    GlobalDateTimeNode,
    Globals,
    guiMenus,
    NodeMan,
    registerFrameBlocker,
    setRenderOne,
    Sit,
    unregisterFrameBlocker
} from "./Globals";
import {isLocal} from "./configUtils";
import {par} from "./par";
import {ExportProgressWidget} from "./utils";

import {CNodeMaskOverlay} from "./nodes/CNodeMaskOverlay";
import {CNodeVelocityFromMotion} from "./nodes/CNodeVelocityFromMotion";
import {CNodeTrackFromVelocity} from "./nodes/CNodeTrackFromVelocity";
import {CNodeDisplayTrack} from "./nodes/CNodeDisplayTrack";
import {Color} from "three";
import {getCV, loadOpenCV} from "./openCVLoader";

let cv = null;

const MOTION_TECHNIQUES = {
    SPARSE_CONSENSUS: 'Sparse + Consensus',
    LINEAR_TRACKLET: 'Linear Tracklet',
    PHASE_CORRELATION: 'Phase Correlation',
    ECC_EUCLIDEAN: 'ECC Euclidean',
    AFFINE_RANSAC: 'Affine RANSAC',
};

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
            technique: MOTION_TECHNIQUES.LINEAR_TRACKLET,
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
            eccIterations: 50,
            eccEpsilon: 0.001,
            ransacThreshold: 3.0,
            minVectorCount: 5,
            minConsensusConfidence: 0.1,
            linearityThreshold: 0.9,
            spacingThreshold: 0.5,
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
        
        this.autoMaskWindow = 10;
        this.autoMaskThreshold = 0.9;
        this.autoMaskSpread = 5;
        this.autoMaskTargetColor = {r: 235, g: 235, b: 235};
        this.autoMaskCloseToTarget = 140;
        
        this.resultCache = new Map();
        this.lastAFrame = null;
        this.lastBFrame = null;
        this.lastVideoDataId = null;
    }
    
    invalidateCache() {
        console.log("invalidateCache called, technique=" + this.params.technique);
        this.resultCache.clear();
        this.frameBuffer = [];
        this.staticHistory.clear();
        this.angleHistory = [];
        this.smoothedDirection = {x: 0, y: 0, angle: 0, magnitude: 0, confidence: 0, rotation: 0};
        this.lastFlowData = null;
    }

    getCacheStatusArray() {
        const status = new Array(Sit.frames).fill(0);
        for (let f = 0; f < Sit.frames; f++) {
            if (this.resultCache.has(f)) {
                status[f] = 1;
            }
        }
        return status;
    }

    isCacheFull() {
        const aFrame = Sit.aFrame || 0;
        const bFrame = Sit.bFrame ?? (Sit.frames - 1);
        for (let f = aFrame; f <= bFrame; f++) {
            if (!this.resultCache.has(f)) {
                return false;
            }
        }
        return true;
    }

    getMotionDataForAllFrames() {
        const data = [];
        const goodFrameIndices = [];
        
        for (let f = 0; f < Sit.frames; f++) {
            const cached = this.resultCache.get(f);
            if (cached && cached.smoothedDirection && !cached.incomplete) {
                const isGoodFrame = cached.flowData?.isGoodFrame ?? true;
                if (isGoodFrame) {
                    data.push({
                        dx: cached.smoothedDirection.x,
                        dy: cached.smoothedDirection.y,
                        confidence: cached.smoothedDirection.confidence,
                        isGood: true,
                    });
                    goodFrameIndices.push(f);
                } else {
                    data.push({dx: 0, dy: 0, confidence: 0, isGood: false});
                }
            } else {
                data.push({dx: 0, dy: 0, confidence: 0, isGood: false});
            }
        }
        
        if (goodFrameIndices.length === 0) {
            return data;
        }
        
        for (let f = 0; f < Sit.frames; f++) {
            if (data[f].isGood) continue;
            
            let prevGoodIdx = -1;
            let nextGoodIdx = -1;
            
            for (let i = goodFrameIndices.length - 1; i >= 0; i--) {
                if (goodFrameIndices[i] < f) {
                    prevGoodIdx = goodFrameIndices[i];
                    break;
                }
            }
            for (let i = 0; i < goodFrameIndices.length; i++) {
                if (goodFrameIndices[i] > f) {
                    nextGoodIdx = goodFrameIndices[i];
                    break;
                }
            }
            
            if (prevGoodIdx < 0 && nextGoodIdx >= 0) {
                data[f] = {...data[nextGoodIdx], confidence: data[nextGoodIdx].confidence * 0.5};
            } else if (nextGoodIdx < 0 && prevGoodIdx >= 0) {
                data[f] = {...data[prevGoodIdx], confidence: data[prevGoodIdx].confidence * 0.5};
            } else if (prevGoodIdx >= 0 && nextGoodIdx >= 0) {
                const t = (f - prevGoodIdx) / (nextGoodIdx - prevGoodIdx);
                const prev = data[prevGoodIdx];
                const next = data[nextGoodIdx];
                data[f] = {
                    dx: prev.dx + t * (next.dx - prev.dx),
                    dy: prev.dy + t * (next.dy - prev.dy),
                    confidence: Math.min(prev.confidence, next.confidence) * 0.5,
                    isGood: false,
                };
            }
        }
        
        return data;
    }

    getGapFilledDirection(frame) {
        let prevGoodIdx = -1;
        let nextGoodIdx = -1;
        
        for (let f = frame - 1; f >= 0; f--) {
            const cached = this.resultCache.get(f);
            if (cached && cached.flowData?.isGoodFrame && cached.smoothedDirection) {
                prevGoodIdx = f;
                break;
            }
        }
        
        for (let f = frame + 1; f < Sit.frames; f++) {
            const cached = this.resultCache.get(f);
            if (cached && cached.flowData?.isGoodFrame && cached.smoothedDirection) {
                nextGoodIdx = f;
                break;
            }
        }
        
        if (prevGoodIdx < 0 && nextGoodIdx < 0) {
            return null;
        }
        
        if (prevGoodIdx < 0 && nextGoodIdx >= 0) {
            const next = this.resultCache.get(nextGoodIdx).smoothedDirection;
            return {...next, confidence: next.confidence * 0.5};
        }
        
        if (nextGoodIdx < 0 && prevGoodIdx >= 0) {
            const prev = this.resultCache.get(prevGoodIdx).smoothedDirection;
            return {...prev, confidence: prev.confidence * 0.5};
        }
        
        const t = (frame - prevGoodIdx) / (nextGoodIdx - prevGoodIdx);
        const prev = this.resultCache.get(prevGoodIdx).smoothedDirection;
        const next = this.resultCache.get(nextGoodIdx).smoothedDirection;
        
        const x = prev.x + t * (next.x - prev.x);
        const y = prev.y + t * (next.y - prev.y);
        return {
            x, y,
            angle: Math.atan2(y, x),
            magnitude: Math.sqrt(x * x + y * y),
            confidence: Math.min(prev.confidence, next.confidence) * 0.5,
            rotation: prev.rotation + t * (next.rotation - prev.rotation),
        };
    }

    findNextUncachedOrGoodFrame(fromFrame) {
        const skipFrames = Math.max(1, Math.round(this.params.frameSkip));
        const startSearch = fromFrame + skipFrames;
        for (let f = startSearch; f < Sit.frames; f++) {
            const cached = this.resultCache.get(f);
            if (!cached) return f;
            if (cached.flowData?.isGoodFrame) return null;
        }
        return null;
    }

    analyzeFrameForGapFill(targetFrame) {
        if (!this.active || !cv) return;
        const videoData = this.videoView?.videoData;
        if (!videoData) return;
        
        const cached = this.resultCache.get(targetFrame);
        if (cached && !cached.incomplete) return;
        
        const image = videoData.getImage(targetFrame);
        if (!image || !image.width) return;
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width || image.videoWidth;
        tempCanvas.height = image.height || image.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(image, 0, 0, tempCanvas.width, tempCanvas.height);
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
            grayRaw.copyTo(gray);
            grayRaw.delete();
        }

        this.frameBuffer.push({gray: gray.clone(), frame: targetFrame, width: tempCanvas.width, height: tempCanvas.height});
        while (this.frameBuffer.length > this.maxBufferSize) {
            const old = this.frameBuffer.shift();
            if (old.gray) old.gray.delete();
        }

        const skipFrames = Math.max(1, Math.round(this.params.frameSkip));
        
        if (this.params.technique === MOTION_TECHNIQUES.LINEAR_TRACKLET) {
            this.computeOpticalFlowLinearTracklet(targetFrame, tempCanvas.width, tempCanvas.height, skipFrames);
        }
        
        gray.delete();

        this.resultCache.set(targetFrame, {
            flowData: this.lastFlowData ? {...this.lastFlowData, vectors: [...this.lastFlowData.vectors]} : null,
            smoothedDirection: {...this.smoothedDirection},
            angleHistory: [...this.angleHistory],
            imgWidth: tempCanvas.width,
            imgHeight: tempCanvas.height,
        });

        setRenderOne(true);
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
            this.maskOverlayNode.setEditing(enabled);
            setRenderOne(true);
        }
    }
    
    updateMaskPreview() {
        if (this.maskOverlayNode) {
            this.maskOverlayNode.setShowMaskPreview(this.maskEnabled);
            setRenderOne(true);
        }
    }
    
    clearMask() {
        if (this.maskOverlayNode) {
            this.maskOverlayNode.clearMask();
        }
    }
    
    autoMask() {
        const videoData = this.videoView?.videoData;
        if (!videoData) {
            console.log("AutoMask: no videoData");
            return;
        }
        
        const currentFrame = Math.floor(par.frame);
        const endFrame = Math.min(currentFrame + this.autoMaskWindow, Sit.frames - 1);
        console.log(`AutoMask: currentFrame=${currentFrame}, endFrame=${endFrame}, window=${this.autoMaskWindow}`);
        
        if (endFrame <= currentFrame) {
            console.log("AutoMask: endFrame <= currentFrame");
            return;
        }
        
        const firstImage = videoData.getImage(currentFrame);
        console.log(`AutoMask: firstImage=`, firstImage, `width=${firstImage?.width}, videoWidth=${firstImage?.videoWidth}`);
        if (!firstImage || !firstImage.width) {
            console.log("AutoMask: no firstImage or no width");
            return;
        }
        
        const width = firstImage.width || firstImage.videoWidth;
        const height = firstImage.height || firstImage.videoHeight;
        console.log(`AutoMask: dimensions ${width}x${height}`);
        
        const frames = [];
        for (let f = currentFrame; f <= endFrame; f++) {
            const isLoaded = videoData.isFrameLoaded ? videoData.isFrameLoaded(f) : true;
            if (!isLoaded) {
                console.log(`AutoMask: frame ${f} not loaded yet`);
                continue;
            }
            const img = videoData.getImage(f);
            if (!img || !img.width) {
                console.log(`AutoMask: frame ${f} not available`);
                continue;
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const sample = [imageData.data[0], imageData.data[1], imageData.data[2]];
            console.log(`AutoMask: frame ${f} sample pixel RGB: ${sample}`);
            frames.push(imageData);
        }
        
        console.log(`AutoMask: loaded ${frames.length} frames`);
        if (frames.length < 2) {
            console.log("AutoMask: not enough frames");
            return;
        }
        
        this.maskOverlayNode.ensureMaskInitialized();
        if (!this.maskOverlayNode.maskCanvas) {
            console.log("AutoMask: maskCanvas not initialized");
            return;
        }
        
        this.maskOverlayNode.maskCtx.clearRect(0, 0, this.maskOverlayNode.maskCanvas.width, this.maskOverlayNode.maskCanvas.height);
        
        const threshold = (1 - this.autoMaskThreshold) * 255;
        const {r: targetR, g: targetG, b: targetB} = this.autoMaskTargetColor;
        const targetThreshold = this.autoMaskCloseToTarget;
        console.log(`AutoMask: threshold=${threshold}, targetColor=(${targetR},${targetG},${targetB}), targetThreshold=${targetThreshold}`);
        const invariantPixels = [];
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const baseR = frames[0].data[idx];
                const baseG = frames[0].data[idx + 1];
                const baseB = frames[0].data[idx + 2];
                
                const targetDiff = Math.abs(baseR - targetR) + Math.abs(baseG - targetG) + Math.abs(baseB - targetB);
                if (targetDiff > targetThreshold) {
                    continue;
                }
                
                let isInvariant = true;
                for (let f = 1; f < frames.length; f++) {
                    const r = frames[f].data[idx];
                    const g = frames[f].data[idx + 1];
                    const b = frames[f].data[idx + 2];
                    
                    const diff = Math.abs(r - baseR) + Math.abs(g - baseG) + Math.abs(b - baseB);
                    if (diff > threshold * 3) {
                        isInvariant = false;
                        break;
                    }
                }
                
                if (isInvariant) {
                    invariantPixels.push({x, y});
                }
            }
        }
        
        console.log(`AutoMask: found ${invariantPixels.length} invariant pixels`);
        
        const ctx = this.maskOverlayNode.maskCtx;
        ctx.fillStyle = 'rgba(255, 0, 0, 1)';
        
        for (const {x, y} of invariantPixels) {
            ctx.beginPath();
            ctx.arc(x, y, this.autoMaskSpread, 0, Math.PI * 2);
            ctx.fill();
        }
        
        this.maskOverlayNode.saveMask();
        this.onMaskChange();
        setRenderOne(true);
        console.log("AutoMask: complete");
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
        if (this.maskOverlayNode) {
            this.maskOverlayNode.setShowMaskPreview(false);
            this.maskOverlayNode.setEditing(false);
        }
    }

    start() {
        this.active = true;
        this.createOverlays();
        this.showOverlays();
        this.updateMaskPreview();
        
        registerFrameBlocker('motionAnalysis', {
            check: (currentFrame, nextFrame) => {
                if (!this.active) return false;
                const current = Math.floor(currentFrame);
                if (current < 0 || current >= Sit.frames) return false;
                return !this.resultCache.has(current);
            },
            requiresSingleFrame: () => {
                return this.active && !this.isCacheFull();
            }
        });
    }

    stop() {
        this.active = false;
        this.hideOverlays();
        this.clearSliderStatus();
        unregisterFrameBlocker('motionAnalysis');
    }

    analyze(frame) {
        frame = Math.floor(frame);
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

        const width = this.videoView.widthPx;
        const height = this.videoView.heightPx;

        if (this.overlay.width !== width || this.overlay.height !== height) {
            this.overlay.width = width;
            this.overlay.height = height;
        }

        const cached = this.resultCache.get(frame);
        if (cached && !cached.incomplete) {
            this.lastFlowData = cached.flowData;
            const isGoodFrame = cached.flowData?.isGoodFrame ?? true;
            if (isGoodFrame) {
                this.smoothedDirection = {...cached.smoothedDirection};
            } else {
                const gapFilled = this.getGapFilledDirection(frame);
                if (gapFilled) {
                    this.smoothedDirection = gapFilled;
                } else {
                    this.smoothedDirection = {...cached.smoothedDirection};
                }
            }
            this.angleHistory = [...cached.angleHistory];
            this.drawOverlay(width, height, cached.imgWidth, cached.imgHeight);
            this.drawGraph();
            return;
        }

        const image = videoData.getImage(frame);
        if (!image || !image.width || !image.height) {
            this.overlayCtx.clearRect(0, 0, width, height);
            this.resultCache.set(frame, {
                flowData: null,
                smoothedDirection: {...this.smoothedDirection},
                angleHistory: [...this.angleHistory],
                imgWidth: 0,
                imgHeight: 0,
                incomplete: true,
            });
            setTimeout(() => setRenderOne(true), 100);
            return;
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
            grayRaw.copyTo(gray);
            grayRaw.delete();
        }

        this.frameBuffer.push({gray: gray.clone(), frame, width: tempCanvas.width, height: tempCanvas.height});
        
        while (this.frameBuffer.length > this.maxBufferSize) {
            const old = this.frameBuffer.shift();
            if (old.gray) old.gray.delete();
        }

        const skipFrames = Math.max(1, Math.round(this.params.frameSkip));
        const targetFrame = frame - skipFrames;
        let compareIdx = this.frameBuffer.findIndex(entry => entry.frame === targetFrame);
        
        if (compareIdx < 0 && frame >= skipFrames) {
            const prevFrame = targetFrame;
            const isLoaded = videoData.isFrameLoaded ? videoData.isFrameLoaded(prevFrame) : true;
            if (!isLoaded) {
                gray.delete();
                this.resultCache.set(frame, {
                    flowData: null,
                    smoothedDirection: {...this.smoothedDirection},
                    angleHistory: [...this.angleHistory],
                    imgWidth: tempCanvas.width,
                    imgHeight: tempCanvas.height,
                    incomplete: true,
                });
                setTimeout(() => setRenderOne(true), 100);
                return;
            }
            const prevImage = videoData.getImage(prevFrame);
            if (prevImage && prevImage.width && prevImage.height) {
                const prevCanvas = document.createElement('canvas');
                prevCanvas.width = prevImage.width || prevImage.videoWidth || width;
                prevCanvas.height = prevImage.height || prevImage.videoHeight || height;
                const prevCtx = prevCanvas.getContext('2d');
                prevCtx.drawImage(prevImage, 0, 0, prevCanvas.width, prevCanvas.height);
                const prevImageData = prevCtx.getImageData(0, 0, prevCanvas.width, prevCanvas.height);
                
                const prevSrc = cv.matFromImageData(prevImageData);
                const prevGrayRaw = new cv.Mat();
                cv.cvtColor(prevSrc, prevGrayRaw, cv.COLOR_RGBA2GRAY);
                prevSrc.delete();
                
                const prevGray = new cv.Mat();
                const blurSize = Math.max(1, Math.floor(this.params.blurSize) | 1);
                if (blurSize > 1) {
                    cv.GaussianBlur(prevGrayRaw, prevGray, new cv.Size(blurSize, blurSize), 0);
                    prevGrayRaw.delete();
                } else {
                    prevGrayRaw.copyTo(prevGray);
                    prevGrayRaw.delete();
                }
                
                this.frameBuffer.unshift({gray: prevGray, frame: prevFrame, width: prevCanvas.width, height: prevCanvas.height});
                compareIdx = 0;
            }
        }
        
        if (this.params.technique === MOTION_TECHNIQUES.LINEAR_TRACKLET) {
            this.computeOpticalFlowLinearTracklet(frame, tempCanvas.width, tempCanvas.height, skipFrames);
            
            gray.delete();

            this.resultCache.set(frame, {
                flowData: this.lastFlowData ? {...this.lastFlowData, vectors: [...this.lastFlowData.vectors]} : null,
                smoothedDirection: {...this.smoothedDirection},
                angleHistory: [...this.angleHistory],
                imgWidth: tempCanvas.width,
                imgHeight: tempCanvas.height,
            });

            if (!(this.lastFlowData?.isGoodFrame)) {
                const gapFilled = this.getGapFilledDirection(frame);
                if (gapFilled) {
                    this.smoothedDirection = gapFilled;
                } else {
                    const nextGoodFrame = this.findNextUncachedOrGoodFrame(frame);
                    if (nextGoodFrame !== null && nextGoodFrame !== frame) {
                        setTimeout(() => {
                            this.analyzeFrameForGapFill(nextGoodFrame);
                        }, 10);
                    }
                }
            }

            this.drawOverlay(width, height, tempCanvas.width, tempCanvas.height);
            this.drawGraph();
            this.updateSliderStatus();
        } else if (compareIdx >= 0) {
            const prevEntry = this.frameBuffer[compareIdx];
            this.computeOpticalFlow(prevEntry.gray, gray, tempCanvas.width, tempCanvas.height, skipFrames);
            
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
            this.updateSliderStatus();
        } else {
            gray.delete();
            
            this.resultCache.set(frame, {
                flowData: null,
                smoothedDirection: {...this.smoothedDirection},
                angleHistory: [...this.angleHistory],
                imgWidth: tempCanvas.width,
                imgHeight: tempCanvas.height,
            });
            
            this.drawOverlay(width, height, tempCanvas.width, tempCanvas.height);
            this.drawGraph();
            this.updateSliderStatus();
        }
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

    isPointMasked(x, y) {
        if (!this.maskEnabled || !this.maskOverlayNode) return false;
        return this.maskOverlayNode.isPointMasked(x, y);
    }

    computeOpticalFlowLinearTracklet(frame, imgWidth, imgHeight, skipFrames) {
        const result = this.computeLinearTracklet(frame, imgWidth, imgHeight, skipFrames);
        
        if (!result) {
            console.log(`Motion: technique=Linear Tracklet, result is null`);
            this.lastFlowData = {vectors: [], consensus: null, isGoodFrame: false};
            return;
        }
        
        const {flowVectors, consensus} = result;
        if (!consensus) {
            console.log(`Motion: technique=Linear Tracklet, consensus is null, vectors=${flowVectors.length}`);
        }
        
        const isGoodFrame = this.isGoodQualityFrame(flowVectors, consensus);
        
        if (consensus && isGoodFrame) {
            if (this.smoothedDirection.confidence < 0.01) {
                this.smoothedDirection.x = consensus.dx;
                this.smoothedDirection.y = consensus.dy;
                this.smoothedDirection.magnitude = Math.sqrt(consensus.dx * consensus.dx + consensus.dy * consensus.dy);
                this.smoothedDirection.angle = Math.atan2(consensus.dy, consensus.dx);
                this.smoothedDirection.confidence = consensus.confidence;
                this.smoothedDirection.rotation = consensus.rotation || 0;
            } else {
                const alpha = this.params.smoothingAlpha;
                this.smoothedDirection.x = alpha * this.smoothedDirection.x + (1 - alpha) * consensus.dx;
                this.smoothedDirection.y = alpha * this.smoothedDirection.y + (1 - alpha) * consensus.dy;
                this.smoothedDirection.magnitude = Math.sqrt(
                    this.smoothedDirection.x * this.smoothedDirection.x + 
                    this.smoothedDirection.y * this.smoothedDirection.y
                );
                this.smoothedDirection.angle = Math.atan2(this.smoothedDirection.y, this.smoothedDirection.x);
                this.smoothedDirection.confidence = alpha * this.smoothedDirection.confidence + (1 - alpha) * consensus.confidence;
                this.smoothedDirection.rotation = consensus.rotation || 0;
            }
            if (Globals.regression) console.log(`Motion: technique=Linear Tracklet, consensus=(${consensus.dx.toFixed(2)}, ${consensus.dy.toFixed(2)}), smoothed=(${this.smoothedDirection.x.toFixed(2)}, ${this.smoothedDirection.y.toFixed(2)}), mag=${this.smoothedDirection.magnitude.toFixed(2)}, conf=${this.smoothedDirection.confidence.toFixed(2)}`);
            
            this.angleHistory.push({
                angle: this.smoothedDirection.angle,
                confidence: this.smoothedDirection.confidence
            });
            if (this.angleHistory.length > this.maxHistoryLength) {
                this.angleHistory.shift();
            }
        } else if (!isGoodFrame) {
            console.log(`Motion: BAD FRAME skipped - vectors=${flowVectors.length}, confidence=${consensus?.confidence?.toFixed(2) ?? 'null'}`);
        }

        this.lastFlowData = {vectors: flowVectors, consensus, isGoodFrame};
    }

    computeOpticalFlow(prevGray, gray, imgWidth, imgHeight, skipFrames = 1) {
        let result;
        
        switch (this.params.technique) {
            case MOTION_TECHNIQUES.PHASE_CORRELATION:
                result = this.computePhaseCorrelation(prevGray, gray, imgWidth, imgHeight, skipFrames);
                break;
            case MOTION_TECHNIQUES.ECC_EUCLIDEAN:
                result = this.computeECC(prevGray, gray, imgWidth, imgHeight, skipFrames);
                break;
            case MOTION_TECHNIQUES.AFFINE_RANSAC:
                result = this.computeAffineRANSAC(prevGray, gray, imgWidth, imgHeight, skipFrames);
                break;
            case MOTION_TECHNIQUES.SPARSE_CONSENSUS:
            default:
                result = this.computeSparseConsensus(prevGray, gray, imgWidth, imgHeight, skipFrames);
                break;
        }
        
        if (!result) {
            console.log(`Motion: technique=${this.params.technique}, result is null`);
            this.lastFlowData = {vectors: [], consensus: null, isGoodFrame: false};
            return;
        }
        
        const {flowVectors, consensus} = result;
        if (!consensus) {
            console.log(`Motion: technique=${this.params.technique}, consensus is null, vectors=${flowVectors.length}`);
        }
        
        const isGoodFrame = this.isGoodQualityFrame(flowVectors, consensus);
        
        if (consensus && isGoodFrame) {
            if (this.smoothedDirection.confidence < 0.01) {
                this.smoothedDirection.x = consensus.dx;
                this.smoothedDirection.y = consensus.dy;
                this.smoothedDirection.magnitude = Math.sqrt(consensus.dx * consensus.dx + consensus.dy * consensus.dy);
                this.smoothedDirection.angle = Math.atan2(consensus.dy, consensus.dx);
                this.smoothedDirection.confidence = consensus.confidence;
                this.smoothedDirection.rotation = consensus.rotation || 0;
            } else {
                const alpha = this.params.smoothingAlpha;
                this.smoothedDirection.x = alpha * this.smoothedDirection.x + (1 - alpha) * consensus.dx;
                this.smoothedDirection.y = alpha * this.smoothedDirection.y + (1 - alpha) * consensus.dy;
                this.smoothedDirection.magnitude = Math.sqrt(
                    this.smoothedDirection.x * this.smoothedDirection.x + 
                    this.smoothedDirection.y * this.smoothedDirection.y
                );
                this.smoothedDirection.angle = Math.atan2(this.smoothedDirection.y, this.smoothedDirection.x);
                this.smoothedDirection.confidence = alpha * this.smoothedDirection.confidence + (1 - alpha) * consensus.confidence;
                this.smoothedDirection.rotation = consensus.rotation || 0;
            }
            if (Globals.regression) console.log(`Motion: technique=${this.params.technique}, consensus=(${consensus.dx.toFixed(2)}, ${consensus.dy.toFixed(2)}), smoothed=(${this.smoothedDirection.x.toFixed(2)}, ${this.smoothedDirection.y.toFixed(2)}), mag=${this.smoothedDirection.magnitude.toFixed(2)}, conf=${this.smoothedDirection.confidence.toFixed(2)}`);
            
            this.angleHistory.push({
                angle: this.smoothedDirection.angle,
                confidence: this.smoothedDirection.confidence
            });
            if (this.angleHistory.length > this.maxHistoryLength) {
                this.angleHistory.shift();
            }
        } else if (!isGoodFrame) {
            console.log(`Motion: BAD FRAME skipped - vectors=${flowVectors.length}, confidence=${consensus?.confidence?.toFixed(2) ?? 'null'}`);
        }

        this.lastFlowData = {vectors: flowVectors, consensus, isGoodFrame};
    }

    computePhaseCorrelation(prevGray, gray, imgWidth, imgHeight, skipFrames) {
        if (typeof cv.phaseCorrelate !== 'function') {
            if (!this._phaseCorrelateWarned) {
                console.warn("cv.phaseCorrelate not in this opencv.js build, using DFT-based implementation");
                this._phaseCorrelateWarned = true;
            }
            return this.computePhaseCorrelationDFT(prevGray, gray, imgWidth, imgHeight, skipFrames);
        }
        
        const motionScale = 1 / skipFrames;
        const prevFloat = new cv.Mat();
        const grayFloat = new cv.Mat();
        prevGray.convertTo(prevFloat, cv.CV_32F);
        gray.convertTo(grayFloat, cv.CV_32F);
        
        let shift, response = 0.5;
        try {
            shift = cv.phaseCorrelate(prevFloat, grayFloat);
            if (shift.response !== undefined) {
                response = shift.response;
            }
        } catch (e) {
            console.error("Phase correlation error:", e);
            prevFloat.delete();
            grayFloat.delete();
            return null;
        }
        
        prevFloat.delete();
        grayFloat.delete();
        
        const dx = shift.x * motionScale;
        const dy = shift.y * motionScale;
        const mag = Math.sqrt(dx * dx + dy * dy);
        const confidence = Math.min(1, Math.max(0.5, response));
        
        const flowVectors = (mag >= this.params.minMotion && mag <= this.params.maxMotion)
            ? this.generateSyntheticVectors(dx, dy, 0, imgWidth, imgHeight)
            : [];
        
        return {
            flowVectors,
            consensus: {dx, dy, confidence, rotation: 0, inlierCount: flowVectors.length}
        };
    }

    computePhaseCorrelationDFT(prevGray, gray, imgWidth, imgHeight, skipFrames) {
        const motionScale = 1 / skipFrames;
        
        const optW = cv.getOptimalDFTSize(imgWidth);
        const optH = cv.getOptimalDFTSize(imgHeight);
        
        const padded1 = new cv.Mat();
        const padded2 = new cv.Mat();
        cv.copyMakeBorder(prevGray, padded1, 0, optH - imgHeight, 0, optW - imgWidth, cv.BORDER_CONSTANT, new cv.Scalar(0));
        cv.copyMakeBorder(gray, padded2, 0, optH - imgHeight, 0, optW - imgWidth, cv.BORDER_CONSTANT, new cv.Scalar(0));
        
        const float1 = new cv.Mat();
        const float2 = new cv.Mat();
        padded1.convertTo(float1, cv.CV_32F);
        padded2.convertTo(float2, cv.CV_32F);
        padded1.delete();
        padded2.delete();
        
        const planes1 = new cv.MatVector();
        const planes2 = new cv.MatVector();
        const zeros1 = cv.Mat.zeros(optH, optW, cv.CV_32F);
        const zeros2 = cv.Mat.zeros(optH, optW, cv.CV_32F);
        planes1.push_back(float1);
        planes1.push_back(zeros1);
        planes2.push_back(float2);
        planes2.push_back(zeros2);
        
        const complex1 = new cv.Mat();
        const complex2 = new cv.Mat();
        cv.merge(planes1, complex1);
        cv.merge(planes2, complex2);
        float1.delete();
        float2.delete();
        zeros1.delete();
        zeros2.delete();
        planes1.delete();
        planes2.delete();
        
        cv.dft(complex1, complex1);
        cv.dft(complex2, complex2);
        
        const split1 = new cv.MatVector();
        const split2 = new cv.MatVector();
        cv.split(complex1, split1);
        cv.split(complex2, split2);
        const re1 = split1.get(0);
        const im1 = split1.get(1);
        const re2 = split2.get(0);
        const im2 = split2.get(1);
        
        const crossRe = new cv.Mat();
        const crossIm = new cv.Mat();
        const temp1 = new cv.Mat();
        const temp2 = new cv.Mat();
        cv.multiply(re1, re2, temp1);
        cv.multiply(im1, im2, temp2);
        cv.add(temp1, temp2, crossRe);
        cv.multiply(im1, re2, temp1);
        cv.multiply(re1, im2, temp2);
        cv.subtract(temp1, temp2, crossIm);
        temp1.delete();
        temp2.delete();
        split1.delete();
        split2.delete();
        complex1.delete();
        complex2.delete();
        
        const mag = new cv.Mat();
        cv.magnitude(crossRe, crossIm, mag);
        const epsilon = cv.Mat.ones(optH, optW, cv.CV_32F);
        for (let i = 0; i < epsilon.rows * epsilon.cols; i++) {
            epsilon.data32F[i] = 1e-10;
        }
        cv.add(mag, epsilon, mag);
        epsilon.delete();
        
        cv.divide(crossRe, mag, crossRe);
        cv.divide(crossIm, mag, crossIm);
        mag.delete();
        
        const normPlanes = new cv.MatVector();
        normPlanes.push_back(crossRe);
        normPlanes.push_back(crossIm);
        const normCross = new cv.Mat();
        cv.merge(normPlanes, normCross);
        crossRe.delete();
        crossIm.delete();
        normPlanes.delete();
        
        const invResult = new cv.Mat();
        cv.dft(normCross, invResult, cv.DFT_INVERSE | cv.DFT_SCALE);
        normCross.delete();
        
        const resultPlanes = new cv.MatVector();
        cv.split(invResult, resultPlanes);
        const result = resultPlanes.get(0);
        invResult.delete();
        resultPlanes.delete();
        
        const minMax = cv.minMaxLoc(result);
        const peakLoc = minMax.maxLoc;
        const response = minMax.maxVal;
        result.delete();
        
        let shiftX = peakLoc.x;
        let shiftY = peakLoc.y;
        if (shiftX > optW / 2) shiftX -= optW;
        if (shiftY > optH / 2) shiftY -= optH;
        
        let dx = -shiftX * motionScale;
        let dy = -shiftY * motionScale;
        const motionMag = Math.sqrt(dx * dx + dy * dy);
        
        if (motionMag < this.params.minMotion && response < 0.5) {
            if (!this._phaseCorrelationFallbackWarned) {
                console.warn("Phase Correlation detected no significant translation (response=" + response.toFixed(2) + "), falling back to Sparse + Consensus");
                this._phaseCorrelationFallbackWarned = true;
            }
            return this.computeSparseConsensus(prevGray, gray, imgWidth, imgHeight, skipFrames);
        }
        
        const confidence = Math.min(1, Math.max(0.3, response * 10));
        
        const flowVectors = (motionMag >= this.params.minMotion && motionMag <= this.params.maxMotion)
            ? this.generateSyntheticVectors(dx, dy, 0, imgWidth, imgHeight)
            : [];
        
        return {
            flowVectors,
            consensus: {dx, dy, confidence, rotation: 0, inlierCount: flowVectors.length}
        };
    }

    computeECC(prevGray, gray, imgWidth, imgHeight, skipFrames) {
        if (typeof cv.findTransformECC !== 'function') {
            if (!this._eccWarned) {
                console.warn("cv.findTransformECC not available, falling back to Affine RANSAC");
                this._eccWarned = true;
            }
            return this.computeAffineRANSAC(prevGray, gray, imgWidth, imgHeight, skipFrames);
        }
        
        const motionScale = 1 / skipFrames;
        const warpMatrix = cv.Mat.eye(2, 3, cv.CV_32F);
        
        const criteria = new cv.TermCriteria(
            cv.TermCriteria_COUNT + cv.TermCriteria_EPS,
            this.params.eccIterations,
            this.params.eccEpsilon
        );
        
        const inputMask = new cv.Mat();
        const gaussFiltSize = 5;
        
        let cc;
        try {
            cc = cv.findTransformECC(prevGray, gray, warpMatrix, cv.MOTION_EUCLIDEAN, criteria, inputMask, gaussFiltSize);
        } catch (e) {
            console.error("ECC error:", e.message || e);
            warpMatrix.delete();
            inputMask.delete();
            return null;
        }
        
        inputMask.delete();
        
        const cosTheta = warpMatrix.floatAt(0, 0);
        const sinTheta = warpMatrix.floatAt(1, 0);
        const txRaw = warpMatrix.floatAt(0, 2);
        const tyRaw = warpMatrix.floatAt(1, 2);
        warpMatrix.delete();
        
        const rotationRaw = Math.atan2(sinTheta, cosTheta);
        const rotation = rotationRaw * motionScale;
        const dx = txRaw * motionScale;
        const dy = tyRaw * motionScale;
        const mag = Math.sqrt(dx * dx + dy * dy);
        const confidence = Math.min(1, cc);
        
        const showVectors = mag >= this.params.minMotion || Math.abs(rotation) >= 0.0003;
        const flowVectors = showVectors
            ? this.generateSyntheticVectors(dx, dy, rotation, imgWidth, imgHeight)
            : [];
        
        return {
            flowVectors,
            consensus: {dx, dy, confidence, rotation, inlierCount: flowVectors.length}
        };
    }

    computeAffineRANSAC(prevGray, gray, imgWidth, imgHeight, skipFrames) {
        if (typeof cv.estimateAffinePartial2D !== 'function') {
            if (!this._affineWarned) {
                console.warn("cv.estimateAffinePartial2D not available, falling back to Sparse + Consensus");
                this._affineWarned = true;
            }
            return this.computeSparseConsensus(prevGray, gray, imgWidth, imgHeight, skipFrames);
        }
        
        const {prevPoints, nextPoints, qualities} = this.trackFeatures(prevGray, gray, skipFrames);
        
        if (prevPoints.length < 4) {
            return {flowVectors: [], consensus: null};
        }
        
        const prevPtsMat = cv.matFromArray(prevPoints.length, 1, cv.CV_32FC2, prevPoints.flat());
        const nextPtsMat = cv.matFromArray(nextPoints.length, 1, cv.CV_32FC2, nextPoints.flat());
        const inliersMask = new cv.Mat();
        
        let transform;
        try {
            transform = cv.estimateAffinePartial2D(prevPtsMat, nextPtsMat, inliersMask, cv.RANSAC, this.params.ransacThreshold);
        } catch (e) {
            prevPtsMat.delete();
            nextPtsMat.delete();
            inliersMask.delete();
            return null;
        }
        
        if (!transform || transform.empty()) {
            prevPtsMat.delete();
            nextPtsMat.delete();
            inliersMask.delete();
            if (transform) transform.delete();
            return null;
        }
        
        const motionScale = 1 / skipFrames;
        const cosTheta = transform.doubleAt(0, 0);
        const sinTheta = transform.doubleAt(1, 0);
        const txRaw = transform.doubleAt(0, 2);
        const tyRaw = transform.doubleAt(1, 2);
        transform.delete();
        
        const rotation = Math.atan2(sinTheta, cosTheta);
        const dx = txRaw * motionScale;
        const dy = tyRaw * motionScale;
        
        const flowVectors = [];
        let inlierCount = 0;
        
        for (let i = 0; i < prevPoints.length; i++) {
            const isInlier = inliersMask.data[i] === 1;
            if (isInlier) inlierCount++;
            
            const [px, py] = prevPoints[i];
            const [nx, ny] = nextPoints[i];
            const vdx = (nx - px) * motionScale;
            const vdy = (ny - py) * motionScale;
            const mag = Math.sqrt(vdx * vdx + vdy * vdy);
            
            flowVectors.push({
                px, py, dx: vdx, dy: vdy, mag,
                quality: qualities[i],
                angle: Math.atan2(vdy, vdx),
                isInlier
            });
        }
        
        prevPtsMat.delete();
        nextPtsMat.delete();
        inliersMask.delete();
        
        const confidence = inlierCount / prevPoints.length;
        
        return {
            flowVectors,
            consensus: {dx, dy, confidence, rotation, inlierCount}
        };
    }

    computeLinearTracklet(frame, imgWidth, imgHeight, skipFrames) {
        const videoData = this.videoView.videoData;
        if (!videoData) return {flowVectors: [], consensus: null};
        
        const startFrame = frame - skipFrames;
        if (startFrame < 0) return {flowVectors: [], consensus: null};
        
        const grayFrames = [];
        for (let f = startFrame; f <= frame; f++) {
            const entry = this.frameBuffer.find(e => e.frame === f);
            if (entry) {
                grayFrames.push(entry.gray);
            } else {
                const image = videoData.getImage(f);
                if (!image || !image.width || !image.height) {
                    for (const g of grayFrames) {
                        if (!this.frameBuffer.some(e => e.gray === g)) g.delete();
                    }
                    return {flowVectors: [], consensus: null};
                }
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = image.width || image.videoWidth;
                tempCanvas.height = image.height || image.videoHeight;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(image, 0, 0, tempCanvas.width, tempCanvas.height);
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
                    grayRaw.copyTo(gray);
                    grayRaw.delete();
                }
                grayFrames.push(gray);
            }
        }
        
        if (grayFrames.length < 2) {
            return {flowVectors: [], consensus: null};
        }
        
        const firstGray = grayFrames[0];
        const corners = new cv.Mat();
        try {
            cv.goodFeaturesToTrack(firstGray, corners, this.params.maxFeatures, this.params.qualityLevel, this.params.minDistance);
        } catch (e) {
            corners.delete();
            return {flowVectors: [], consensus: null};
        }
        
        if (corners.rows === 0) {
            corners.delete();
            return {flowVectors: [], consensus: null};
        }
        
        const trajectories = [];
        for (let i = 0; i < corners.rows; i++) {
            const px = corners.floatAt(i, 0);
            const py = corners.floatAt(i, 1);
            if (this.isPointMasked(px, py)) continue;
            trajectories.push({points: [[px, py]], valid: true, errors: []});
        }
        corners.delete();
        
        let currentPoints = new cv.Mat(trajectories.length, 1, cv.CV_32FC2);
        for (let i = 0; i < trajectories.length; i++) {
            currentPoints.floatPtr(i, 0)[0] = trajectories[i].points[0][0];
            currentPoints.floatPtr(i, 0)[1] = trajectories[i].points[0][1];
        }
        
        for (let step = 0; step < grayFrames.length - 1; step++) {
            const prevGray = grayFrames[step];
            const nextGray = grayFrames[step + 1];
            
            const nextPtsMat = new cv.Mat();
            const status = new cv.Mat();
            const err = new cv.Mat();
            
            try {
                cv.calcOpticalFlowPyrLK(prevGray, nextGray, currentPoints, nextPtsMat, status, err);
            } catch (e) {
                nextPtsMat.delete();
                status.delete();
                err.delete();
                break;
            }
            
            let validIdx = 0;
            for (let i = 0; i < trajectories.length; i++) {
                if (!trajectories[i].valid) continue;
                if (status.data[validIdx] !== 1) {
                    trajectories[i].valid = false;
                } else {
                    const nx = nextPtsMat.floatAt(validIdx, 0);
                    const ny = nextPtsMat.floatAt(validIdx, 1);
                    const trackError = err.floatAt(validIdx, 0);
                    trajectories[i].points.push([nx, ny]);
                    trajectories[i].errors.push(trackError);
                    if (trackError > this.params.maxTrackError) {
                        trajectories[i].valid = false;
                    }
                }
                validIdx++;
            }
            
            const validTrajectories = trajectories.filter(t => t.valid);
            if (validTrajectories.length === 0) {
                nextPtsMat.delete();
                status.delete();
                err.delete();
                break;
            }
            
            currentPoints.delete();
            currentPoints = new cv.Mat(validTrajectories.length, 1, cv.CV_32FC2);
            let idx = 0;
            for (const t of trajectories) {
                if (t.valid) {
                    const lastPt = t.points[t.points.length - 1];
                    currentPoints.floatPtr(idx, 0)[0] = lastPt[0];
                    currentPoints.floatPtr(idx, 0)[1] = lastPt[1];
                    idx++;
                }
            }
            
            nextPtsMat.delete();
            status.delete();
            err.delete();
        }
        
        currentPoints.delete();
        
        for (let i = 0; i < grayFrames.length; i++) {
            if (!this.frameBuffer.some(e => e.gray === grayFrames[i])) {
                grayFrames[i].delete();
            }
        }
        
        const flowVectors = [];
        const motionScale = 1 / skipFrames;
        
        for (const traj of trajectories) {
            if (!traj.valid || traj.points.length < skipFrames + 1) continue;
            
            const start = traj.points[0];
            const end = traj.points[traj.points.length - 1];
            const totalDx = end[0] - start[0];
            const totalDy = end[1] - start[1];
            const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
            
            if (totalDist < 0.001) continue;
            
            const expectedStepDx = totalDx / skipFrames;
            const expectedStepDy = totalDy / skipFrames;
            const expectedStepMag = totalDist / skipFrames;
            
            let maxDeviation = 0;
            let maxSpacingError = 0;
            
            for (let i = 1; i < traj.points.length; i++) {
                const actualDx = traj.points[i][0] - traj.points[i-1][0];
                const actualDy = traj.points[i][1] - traj.points[i-1][1];
                const actualMag = Math.sqrt(actualDx * actualDx + actualDy * actualDy);
                
                const expectedX = start[0] + expectedStepDx * i;
                const expectedY = start[1] + expectedStepDy * i;
                const deviationX = traj.points[i][0] - expectedX;
                const deviationY = traj.points[i][1] - expectedY;
                const deviation = Math.sqrt(deviationX * deviationX + deviationY * deviationY);
                maxDeviation = Math.max(maxDeviation, deviation);
                
                if (expectedStepMag > 0.1) {
                    const spacingError = Math.abs(actualMag - expectedStepMag) / expectedStepMag;
                    maxSpacingError = Math.max(maxSpacingError, spacingError);
                }
            }
            
            const linearityScore = totalDist > 0 ? Math.max(0, 1 - maxDeviation / totalDist) : 0;
            const spacingScore = Math.max(0, 1 - maxSpacingError);
            
            if (linearityScore < this.params.linearityThreshold) continue;
            if (spacingScore < this.params.spacingThreshold) continue;
            
            const dx = totalDx * motionScale;
            const dy = totalDy * motionScale;
            const mag = Math.sqrt(dx * dx + dy * dy);
            
            const key = `${Math.round(start[0] / 20)}_${Math.round(start[1] / 20)}`;
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
            
            const avgError = traj.errors.length > 0 ? traj.errors.reduce((a, b) => a + b, 0) / traj.errors.length : 0;
            const quality = Math.max(0, 1 - avgError / this.params.maxTrackError) * linearityScore * spacingScore;
            
            if (quality < this.params.minQuality) continue;
            
            flowVectors.push({
                px: start[0], py: start[1], dx, dy, mag,
                quality,
                angle: Math.atan2(dy, dx),
                trackError: avgError,
                linearityScore,
                spacingScore
            });
        }
        
        if (flowVectors.length < 3) {
            return {flowVectors: [], consensus: null};
        }
        
        const consensus = this.findConsensusDirection(flowVectors);
        return {flowVectors, consensus};
    }

    computeSparseConsensus(prevGray, gray, imgWidth, imgHeight, skipFrames) {
        const {prevPoints, nextPoints, qualities, trackErrors} = this.trackFeatures(prevGray, gray, skipFrames);
        
        const flowVectors = [];
        const motionScale = 1 / skipFrames;
        
        for (let i = 0; i < prevPoints.length; i++) {
            const [px, py] = prevPoints[i];
            const [nx, ny] = nextPoints[i];
            const dx = (nx - px) * motionScale;
            const dy = (ny - py) * motionScale;
            const mag = Math.sqrt(dx * dx + dy * dy);
            
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
            if (qualities[i] < this.params.minQuality) continue;
            
            flowVectors.push({
                px, py, dx, dy, mag,
                quality: qualities[i],
                angle: Math.atan2(dy, dx),
                trackError: trackErrors[i]
            });
        }
        
        if (flowVectors.length < 3) {
            return {flowVectors: [], consensus: null};
        }
        
        const consensus = this.findConsensusDirection(flowVectors);
        return {flowVectors, consensus};
    }

    trackFeatures(prevGray, gray, skipFrames) {
        const prevPoints = [];
        const nextPoints = [];
        const qualities = [];
        const trackErrors = [];
        
        const corners = new cv.Mat();
        try {
            cv.goodFeaturesToTrack(prevGray, corners, this.params.maxFeatures, this.params.qualityLevel, this.params.minDistance);
        } catch (e) {
            corners.delete();
            return {prevPoints, nextPoints, qualities, trackErrors};
        }
        
        if (corners.rows === 0) {
            corners.delete();
            return {prevPoints, nextPoints, qualities, trackErrors};
        }
        
        const nextPtsMat = new cv.Mat();
        const status = new cv.Mat();
        const err = new cv.Mat();
        
        try {
            cv.calcOpticalFlowPyrLK(prevGray, gray, corners, nextPtsMat, status, err);
        } catch (e) {
            corners.delete();
            nextPtsMat.delete();
            status.delete();
            err.delete();
            return {prevPoints, nextPoints, qualities, trackErrors};
        }
        
        const motionScale = 1 / skipFrames;
        
        for (let i = 0; i < status.rows; i++) {
            if (status.data[i] !== 1) continue;
            
            const px = corners.floatAt(i, 0);
            const py = corners.floatAt(i, 1);
            
            if (this.isPointMasked(px, py)) continue;
            
            const nx = nextPtsMat.floatAt(i, 0);
            const ny = nextPtsMat.floatAt(i, 1);
            const trackError = err.floatAt(i, 0);
            
            if (trackError > this.params.maxTrackError) continue;
            
            const dx = (nx - px) * motionScale;
            const dy = (ny - py) * motionScale;
            const mag = Math.sqrt(dx * dx + dy * dy);
            
            const errorQuality = Math.max(0, 1 - trackError / this.params.maxTrackError);
            const magQuality = Math.min(1, mag / 1.0);
            const quality = errorQuality * magQuality;
            
            prevPoints.push([px, py]);
            nextPoints.push([nx, ny]);
            qualities.push(quality);
            trackErrors.push(trackError);
        }
        
        corners.delete();
        nextPtsMat.delete();
        status.delete();
        err.delete();
        
        return {prevPoints, nextPoints, qualities, trackErrors};
    }

    generateSyntheticVectors(dx, dy, rotation, imgWidth, imgHeight) {
        const vectors = [];
        const cx = imgWidth / 2;
        const cy = imgHeight / 2;
        const gridSize = 8;
        const mag = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        
        for (let gx = 0; gx < gridSize; gx++) {
            for (let gy = 0; gy < gridSize; gy++) {
                const px = (gx + 0.5) * imgWidth / gridSize;
                const py = (gy + 0.5) * imgHeight / gridSize;
                
                if (this.isPointMasked(px, py)) continue;
                
                const rx = px - cx;
                const ry = py - cy;
                const vdx = dx - rotation * ry;
                const vdy = dy + rotation * rx;
                const vmag = Math.sqrt(vdx * vdx + vdy * vdy);
                
                vectors.push({
                    px, py, dx: vdx, dy: vdy,
                    mag: vmag,
                    quality: 1.0,
                    angle: Math.atan2(vdy, vdx),
                    isInlier: true
                });
            }
        }
        return vectors;
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

    isGoodQualityFrame(flowVectors, consensus) {
        if (!consensus) return false;
        if (flowVectors.length < this.params.minVectorCount) return false;
        if (consensus.confidence < this.params.minConsensusConfidence) return false;
        return true;
    }

    drawOverlay(width, height, imgWidth, imgHeight) {
        const ctx = this.overlayCtx;
        ctx.clearRect(0, 0, width, height);

        if (!this.lastFlowData) return;

        const arrowScale = 3;

        for (const v of this.lastFlowData.vectors) {
            const [cx, cy] = this.videoView.videoToCanvasCoords(v.px, v.py);
            const [endX, endY] = this.videoView.videoToCanvasCoords(v.px + v.dx * arrowScale, v.py + v.dy * arrowScale);
            const dx = endX - cx;
            const dy = endY - cy;
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

        const showArrow = this.smoothedDirection.magnitude > 0.1 && this.smoothedDirection.confidence > 0.01;
        const [centerX, centerY] = this.videoView.videoToCanvasCoords(imgWidth / 2, imgHeight / 2);
        
        const isGoodFrame = this.lastFlowData?.isGoodFrame ?? true;
        const vectorCount = this.lastFlowData?.vectors?.length ?? 0;
        const consensusConf = this.lastFlowData?.consensus?.confidence ?? 0;
        
        ctx.font = '10px monospace';
        if (isGoodFrame) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.fillText(`mag=${this.smoothedDirection.magnitude.toFixed(2)} conf=${this.smoothedDirection.confidence.toFixed(2)} vec=${vectorCount}`, centerX - 60, centerY + 50);
        } else {
            ctx.fillStyle = 'rgba(255, 100, 100, 0.9)';
            ctx.fillText(`BAD FRAME - vec=${vectorCount} conf=${consensusConf.toFixed(2)} (using last good)`, centerX - 100, centerY + 50);
        }
        
        if (showArrow) {
            const arrowLen = Math.min(width, height) * 0.15 * Math.min(1, this.smoothedDirection.magnitude / 5);
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
            const rawAngle = ((this.smoothedDirection.angle * 180 / Math.PI) + 360) % 360;
            const angleDeg = (rawAngle + 90) % 360;
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

export function resetMotionAnalysis() {
    if (motionAnalyzer) {
        motionAnalyzer.stop();
        motionAnalyzer = null;
    }
    removeParamSliders();
    renderHooked = false;
    if (analyzeMenuItem) {
        analyzeMenuItem.name("Analyze Motion");
    }
}

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
    
    loadOpenCV().then((cvModule) => {
        cv = cvModule;
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
let motionTrackCounter = 0;
let createTrackMenuItem = null;

async function analyzeAllFrames(progressCallback) {
    if (!motionAnalyzer) return false;
    
    const aFrame = Sit.aFrame || 0;
    const bFrame = Sit.bFrame ?? (Sit.frames - 1);
    const totalFrames = bFrame - aFrame + 1;
    
    const savedPaused = par.paused;
    Globals.justVideoAnalysis = true;
    par.paused = false;
    
    while (!motionAnalyzer.isCacheFull()) {
        const analyzed = motionAnalyzer.resultCache.size;
        if (progressCallback) {
            progressCallback(analyzed, totalFrames);
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    par.paused = savedPaused;
    Globals.justVideoAnalysis = false;
    return true;
}

async function createTrackFromMotion() {
    const videoView = NodeMan.get("video", false);
    if (!videoView) {
        alert("No video view found.");
        return;
    }

    if (!cv) {
        if (createTrackMenuItem) createTrackMenuItem.name("Loading OpenCV...");
        try {
            cv = await loadOpenCV();
        } catch (e) {
            alert("Failed to load OpenCV: " + e.message);
            if (createTrackMenuItem) createTrackMenuItem.name("Create Track from Motion");
            return;
        }
    }

    if (!motionAnalyzer) {
        motionAnalyzer = new MotionAnalyzer(videoView);
    }
    motionAnalyzer.active = true;
    motionAnalyzer.createOverlays();

    if (createTrackMenuItem) createTrackMenuItem.name("Analyzing... 0%");
    
    await analyzeAllFrames((current, total) => {
        const pct = Math.round(100 * current / total);
        if (createTrackMenuItem) createTrackMenuItem.name(`Analyzing... ${pct}%`);
    });

    if (createTrackMenuItem) createTrackMenuItem.name("Creating track...");

    const originNode = NodeMan.get("LOSTraverseSelect", false) 
        ?? NodeMan.get("targetTrack", false)
        ?? NodeMan.get("cameraTrack", false);
    
    if (!originNode) {
        alert("No origin track found. Need a target or camera track to determine start position.");
        if (createTrackMenuItem) createTrackMenuItem.name("Create Track from Motion");
        return;
    }

    const fovNode = NodeMan.get("fov", false) ?? NodeMan.get("cameraFOV", false);
    const fovDegrees = fovNode ? fovNode.v(0) : 30;
    const dims = motionAnalyzer.getImageDimensions();

    const distanceNode = NodeMan.get("targetDistance", false);
    const distance = distanceNode ? distanceNode.v(0) : 1000;

    const fovRadians = fovDegrees * Math.PI / 180;
    const imageWidthMeters = 2 * distance * Math.tan(fovRadians / 2);
    const metersPerPixel = imageWidthMeters / dims.width;

    const motionData = motionAnalyzer.getMotionDataForAllFrames();

    motionTrackCounter++;
    const suffix = motionTrackCounter > 1 ? `_${motionTrackCounter}` : "";
    const velocityId = `motionVelocity${suffix}`;
    const trackId = `motionTrack${suffix}`;
    const displayId = `motionTrackDisplay${suffix}`;

    if (NodeMan.exists(velocityId)) NodeMan.disposeRemove(velocityId);
    if (NodeMan.exists(trackId)) NodeMan.disposeRemove(trackId);
    if (NodeMan.exists(displayId)) NodeMan.disposeRemove(displayId);

    new CNodeVelocityFromMotion({
        id: velocityId,
        motionData: motionData,
        metersPerPixel: metersPerPixel,
        frames: Sit.frames,
    });

    new CNodeTrackFromVelocity({
        id: trackId,
        origin: originNode.id,
        velocity: velocityId,
        agl: 1,
        frames: Sit.frames,
    });

    new CNodeDisplayTrack({
        id: displayId,
        track: trackId,
        color: new Color(0.2, 0.8, 0.2),
        width: 2,
    });

    if (createTrackMenuItem) createTrackMenuItem.name("Create Track from Motion");
    setRenderOne(true);
    console.log(`Created motion track '${trackId}' from ${motionAnalyzer.resultCache.size} analyzed frames, ${metersPerPixel.toFixed(3)} m/px`);
}

const MAX_PANORAMA_WIDTH = 20000;
const PANO_VIDEO_4K_WIDTH = 3840;
const PANO_VIDEO_4K_HEIGHT = 2160;
let exportPanoMenuItem = null;
let exportPanoVideoMenuItem = null;
let panoCrop = 10;
let useMaskInPano = true;
let panoFrameStep = 1;

async function exportMotionPanorama() {
    const videoView = NodeMan.get("video", false);
    if (!videoView) {
        alert("No video view found.");
        return;
    }

    const videoData = videoView.videoData;
    if (!videoData) {
        alert("No video data found.");
        return;
    }

    if (!cv) {
        if (exportPanoMenuItem) exportPanoMenuItem.name("Loading OpenCV...");
        try {
            cv = await loadOpenCV();
        } catch (e) {
            alert("Failed to load OpenCV: " + e.message);
            if (exportPanoMenuItem) exportPanoMenuItem.name("Export Motion Panorama");
            return;
        }
    }

    if (!motionAnalyzer) {
        motionAnalyzer = new MotionAnalyzer(videoView);
    }
    motionAnalyzer.active = true;
    motionAnalyzer.createOverlays();

    if (!motionAnalyzer.isCacheFull()) {
        if (exportPanoMenuItem) exportPanoMenuItem.name("Analyzing... 0%");
        await analyzeAllFrames((current, total) => {
            const pct = Math.round(100 * current / total);
            if (exportPanoMenuItem) exportPanoMenuItem.name(`Analyzing... ${pct}%`);
        });
    }

    if (exportPanoMenuItem) exportPanoMenuItem.name("Building panorama...");

    const startFrame = Sit.aFrame;
    const endFrame = Sit.bFrame;
    const frameStep = panoFrameStep;
    const totalFrames = Math.ceil((endFrame - startFrame + 1) / frameStep);

    const motionData = motionAnalyzer.getMotionDataForAllFrames();

    const frameData = [];
    let cumX = 0, cumY = 0;
    
    for (let i = 0; i < totalFrames; i++) {
        const frame = startFrame + i * frameStep;
        if (i > 0) {
            for (let f = frame - frameStep + 1; f <= frame; f++) {
                const md = motionData[f];
                cumX -= md.dx;
                cumY -= md.dy;
            }
        }
        frameData.push({frame, px: cumX, py: cumY});
    }

    let minPx = Infinity, maxPx = -Infinity;
    let minPy = Infinity, maxPy = -Infinity;

    for (const fd of frameData) {
        minPx = Math.min(minPx, fd.px);
        maxPx = Math.max(maxPx, fd.px);
        minPy = Math.min(minPy, fd.py);
        maxPy = Math.max(maxPy, fd.py);
    }

    const firstImage = videoData.getImage(startFrame);
    const frameWidth = firstImage.width || firstImage.videoWidth || 1920;
    const frameHeight = firstImage.height || firstImage.videoHeight || 1080;

    const crop = panoCrop;
    const croppedWidth = frameWidth - 2 * crop;
    const croppedHeight = frameHeight - 2 * crop;

    console.log(`Motion Panorama: X range ${minPx.toFixed(1)} to ${maxPx.toFixed(1)} px (${(maxPx-minPx).toFixed(1)}px)`);
    console.log(`Motion Panorama: Y range ${minPy.toFixed(1)} to ${maxPy.toFixed(1)} px (${(maxPy-minPy).toFixed(1)}px)`);

    const pxRange = maxPx - minPx;
    const pyRange = maxPy - minPy;

    let panoWidthPx = Math.ceil(pxRange + croppedWidth);
    let panoHeightPx = Math.ceil(pyRange + croppedHeight);

    let scale = 1;
    if (panoWidthPx > MAX_PANORAMA_WIDTH) {
        scale = MAX_PANORAMA_WIDTH / panoWidthPx;
        panoWidthPx = MAX_PANORAMA_WIDTH;
        panoHeightPx = Math.ceil(panoHeightPx * scale);
    }

    const scaledFrameWidth = Math.ceil(croppedWidth * scale);
    const scaledFrameHeight = Math.ceil(croppedHeight * scale);

    console.log(`Motion Panorama: ${panoWidthPx}x${panoHeightPx}px, scale=${scale.toFixed(3)}`);

    const panoCanvas = document.createElement('canvas');
    panoCanvas.width = panoWidthPx;
    panoCanvas.height = panoHeightPx;
    const panoCtx = panoCanvas.getContext('2d');

    panoCtx.fillStyle = 'black';
    panoCtx.fillRect(0, 0, panoWidthPx, panoHeightPx);

    const useMask = useMaskInPano && motionAnalyzer.maskEnabled && motionAnalyzer.maskOverlayNode && motionAnalyzer.maskOverlayNode.maskCanvas;
    let tempCanvas = null;
    let tempCtx = null;
    let maskImageData = null;
    
    if (useMask) {
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = frameWidth;
        tempCanvas.height = frameHeight;
        tempCtx = tempCanvas.getContext('2d', {willReadFrequently: true});
        motionAnalyzer.maskOverlayNode.updateMaskImageData();
        maskImageData = motionAnalyzer.maskOverlayNode.maskImageData;
    }

    const previewOverlay = document.createElement('div');
    previewOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;';
    
    const previewCanvas = document.createElement('canvas');
    const previewAspect = panoWidthPx / panoHeightPx;
    const maxPreviewWidth = window.innerWidth * 0.95;
    const maxPreviewHeight = window.innerHeight * 0.85;
    if (maxPreviewWidth / maxPreviewHeight > previewAspect) {
        previewCanvas.height = maxPreviewHeight;
        previewCanvas.width = maxPreviewHeight * previewAspect;
    } else {
        previewCanvas.width = maxPreviewWidth;
        previewCanvas.height = maxPreviewWidth / previewAspect;
    }
    previewCanvas.style.border = '2px solid #444';
    const previewCtx = previewCanvas.getContext('2d');
    
    const statusText = document.createElement('div');
    statusText.style.cssText = 'color:#fff;font-size:18px;margin-top:15px;font-family:sans-serif;';
    statusText.textContent = 'Building panorama... 0%';
    
    previewOverlay.appendChild(previewCanvas);
    previewOverlay.appendChild(statusText);
    document.body.appendChild(previewOverlay);

    Globals.justVideoAnalysis = true;
    const savedPaused = par.paused;
    par.paused = true;
    const previewEveryNFrames = 20;
    
    const updatePreview = () => {
        previewCtx.drawImage(panoCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
    };
    
    let skippedFrames = 0;
    for (let i = 0; i < totalFrames; i++) {
        const fd = frameData[i];
        
        statusText.textContent = `Loading frame ${fd.frame}... (${i+1}/${totalFrames})`;
        
        const loaded = await videoData.requestFrameSequential(fd.frame);
        if (!loaded) {
            console.warn(`Failed to load frame ${fd.frame}, skipping`);
            skippedFrames++;
            continue;
        }
        
        const image = videoData.getImageNoPurge(fd.frame);
        if (!image || !image.width) {
            skippedFrames++;
            continue;
        }

        const x = (fd.px - minPx) * scale;
        const y = (fd.py - minPy) * scale;

        if (useMask && maskImageData) {
            tempCtx.clearRect(0, 0, frameWidth, frameHeight);
            tempCtx.drawImage(image, 0, 0);
            const frameImgData = tempCtx.getImageData(crop, crop, croppedWidth, croppedHeight);
            const framePixels = frameImgData.data;
            const maskPixels = maskImageData.data;
            const maskWidth = maskImageData.width;
            
            for (let py = 0; py < croppedHeight; py++) {
                for (let px = 0; px < croppedWidth; px++) {
                    const maskX = px + crop;
                    const maskY = py + crop;
                    if (maskX < maskWidth && maskY < maskImageData.height) {
                        const maskIdx = (maskY * maskWidth + maskX) * 4;
                        if (maskPixels[maskIdx + 3] > 128) {
                            const frameIdx = (py * croppedWidth + px) * 4;
                            framePixels[frameIdx + 3] = 0;
                        }
                    }
                }
            }
            
            tempCtx.putImageData(frameImgData, crop, crop);
            panoCtx.drawImage(
                tempCanvas,
                crop, crop, croppedWidth, croppedHeight,
                x, y, scaledFrameWidth, scaledFrameHeight
            );
        } else {
            panoCtx.drawImage(
                image,
                crop, crop, croppedWidth, croppedHeight,
                x, y, scaledFrameWidth, scaledFrameHeight
            );
        }

        if (i % previewEveryNFrames === 0) {
            const pct = Math.round(100 * i / totalFrames);
            updatePreview();
            const skipInfo = skippedFrames > 0 ? ` (${skippedFrames} skipped)` : '';
            statusText.textContent = `Building panorama... ${pct}% (frame ${i+1}/${totalFrames})${skipInfo}`;
            if (exportPanoMenuItem) exportPanoMenuItem.name(`Rendering... ${pct}%`);
            await new Promise(r => setTimeout(r, 0));
        }
    }

    updatePreview();
    statusText.textContent = 'Saving...';
    Globals.justVideoAnalysis = false;
    par.paused = savedPaused;
    
    if (exportPanoMenuItem) exportPanoMenuItem.name("Saving...");

    panoCanvas.toBlob((blob) => {
        const filename = `motion_panorama_${Sit.name || 'export'}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        console.log(`Motion panorama exported: ${filename}`);
        if (exportPanoMenuItem) exportPanoMenuItem.name("Export Motion Panorama");
        
        document.body.removeChild(previewOverlay);
    }, 'image/png');
}

async function exportPanoVideo() {
    const videoView = NodeMan.get("video", false);
    if (!videoView) {
        alert("No video view found.");
        return;
    }

    const videoData = videoView.videoData;
    if (!videoData) {
        alert("No video data found.");
        return;
    }

    if (!cv) {
        if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name("Loading OpenCV...");
        try {
            cv = await loadOpenCV();
        } catch (e) {
            alert("Failed to load OpenCV: " + e.message);
            if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name("Export Animated Pano");
            return;
        }
    }

    if (!motionAnalyzer) {
        motionAnalyzer = new MotionAnalyzer(videoView);
    }
    motionAnalyzer.active = true;
    motionAnalyzer.createOverlays();

    if (!motionAnalyzer.isCacheFull()) {
        if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name("Analyzing... 0%");
        await analyzeAllFrames((current, total) => {
            const pct = Math.round(100 * current / total);
            if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name(`Analyzing... ${pct}%`);
        });
    }

    if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name("Building panorama...");

    const startFrame = Sit.aFrame;
    const endFrame = Sit.bFrame;
    const totalFrames = endFrame - startFrame + 1;

    const motionData = motionAnalyzer.getMotionDataForAllFrames();

    const frameData = [];
    let cumX = 0, cumY = 0;
    
    for (let i = 0; i < totalFrames; i++) {
        const frame = startFrame + i;
        if (i > 0) {
            const md = motionData[frame];
            cumX -= md.dx;
            cumY -= md.dy;
        }
        frameData.push({frame, px: cumX, py: cumY});
    }

    let minPx = Infinity, maxPx = -Infinity;
    let minPy = Infinity, maxPy = -Infinity;

    for (const fd of frameData) {
        minPx = Math.min(minPx, fd.px);
        maxPx = Math.max(maxPx, fd.px);
        minPy = Math.min(minPy, fd.py);
        maxPy = Math.max(maxPy, fd.py);
    }

    const firstImage = videoData.getImage(startFrame);
    const frameWidth = firstImage.width || firstImage.videoWidth || 1920;
    const frameHeight = firstImage.height || firstImage.videoHeight || 1080;

    const crop = panoCrop;
    const croppedWidth = frameWidth - 2 * crop;
    const croppedHeight = frameHeight - 2 * crop;

    const pxRange = maxPx - minPx;
    const pyRange = maxPy - minPy;

    let panoWidthPx = Math.ceil(pxRange + croppedWidth);
    let panoHeightPx = Math.ceil(pyRange + croppedHeight);

    let panoScale = 1;
    if (panoWidthPx > MAX_PANORAMA_WIDTH) {
        panoScale = MAX_PANORAMA_WIDTH / panoWidthPx;
        panoWidthPx = MAX_PANORAMA_WIDTH;
        panoHeightPx = Math.ceil(panoHeightPx * panoScale);
    }

    const scaledFrameWidth = Math.ceil(croppedWidth * panoScale);
    const scaledFrameHeight = Math.ceil(croppedHeight * panoScale);

    const panoCanvas = document.createElement('canvas');
    panoCanvas.width = panoWidthPx;
    panoCanvas.height = panoHeightPx;
    const panoCtx = panoCanvas.getContext('2d');

    panoCtx.fillStyle = 'black';
    panoCtx.fillRect(0, 0, panoWidthPx, panoHeightPx);

    const useMask = useMaskInPano && motionAnalyzer.maskEnabled && motionAnalyzer.maskOverlayNode && motionAnalyzer.maskOverlayNode.maskCanvas;
    let tempCanvas = null;
    let tempCtx = null;
    let maskImageData = null;
    
    if (useMask) {
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = frameWidth;
        tempCanvas.height = frameHeight;
        tempCtx = tempCanvas.getContext('2d', {willReadFrequently: true});
        motionAnalyzer.maskOverlayNode.updateMaskImageData();
        maskImageData = motionAnalyzer.maskOverlayNode.maskImageData;
    }

    Globals.justVideoAnalysis = true;
    const savedPaused = par.paused;
    par.paused = true;
    
    for (let i = 0; i < totalFrames; i++) {
        const fd = frameData[i];
        
        const loaded = await videoData.requestFrameSequential(fd.frame);
        if (!loaded) continue;
        
        const image = videoData.getImageNoPurge(fd.frame);
        if (!image || !image.width) continue;

        const x = (fd.px - minPx) * panoScale;
        const y = (fd.py - minPy) * panoScale;

        if (useMask && maskImageData) {
            tempCtx.clearRect(0, 0, frameWidth, frameHeight);
            tempCtx.drawImage(image, 0, 0);
            const frameImgData = tempCtx.getImageData(crop, crop, croppedWidth, croppedHeight);
            const framePixels = frameImgData.data;
            const maskPixels = maskImageData.data;
            const maskWidth = maskImageData.width;
            
            for (let py = 0; py < croppedHeight; py++) {
                for (let px = 0; px < croppedWidth; px++) {
                    const maskX = px + crop;
                    const maskY = py + crop;
                    if (maskX < maskWidth && maskY < maskImageData.height) {
                        const maskIdx = (maskY * maskWidth + maskX) * 4;
                        if (maskPixels[maskIdx + 3] > 128) {
                            const frameIdx = (py * croppedWidth + px) * 4;
                            framePixels[frameIdx + 3] = 0;
                        }
                    }
                }
            }
            
            tempCtx.putImageData(frameImgData, crop, crop);
            panoCtx.drawImage(
                tempCanvas,
                crop, crop, croppedWidth, croppedHeight,
                x, y, scaledFrameWidth, scaledFrameHeight
            );
        } else {
            panoCtx.drawImage(
                image,
                crop, crop, croppedWidth, croppedHeight,
                x, y, scaledFrameWidth, scaledFrameHeight
            );
        }

        if (i % 20 === 0) {
            const pct = Math.round(100 * i / totalFrames);
            if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name(`Pano... ${pct}%`);
            await new Promise(r => setTimeout(r, 0));
        }
    }

    if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name("Rendering video...");

    const outputWidth = PANO_VIDEO_4K_WIDTH;
    const outputHeight = PANO_VIDEO_4K_HEIGHT;

    const panoAspect = panoWidthPx / panoHeightPx;
    const outputAspect = outputWidth / outputHeight;

    let fitWidth, fitHeight, offsetX, offsetY;
    if (panoAspect > outputAspect) {
        fitWidth = outputWidth;
        fitHeight = Math.round(outputWidth / panoAspect);
        offsetX = 0;
        offsetY = Math.round((outputHeight - fitHeight) / 2);
    } else {
        fitHeight = outputHeight;
        fitWidth = Math.round(outputHeight * panoAspect);
        offsetX = Math.round((outputWidth - fitWidth) / 2);
        offsetY = 0;
    }

    const videoFrameScaleInPano = fitWidth / panoWidthPx;
    const videoFrameWidth = Math.round(scaledFrameWidth * videoFrameScaleInPano);
    const videoFrameHeight = Math.round(scaledFrameHeight * videoFrameScaleInPano);

    const {createVideoExporter, getVideoExtension, getBestFormatForResolution, checkVideoEncodingSupport} = await import("./VideoExporter");

    const encodingSupport = await checkVideoEncodingSupport();
    if (!encodingSupport.supported) {
        alert("Video encoding not supported in this browser");
        Globals.justVideoAnalysis = false;
        par.paused = savedPaused;
        if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name("Export Pano Video");
        return;
    }

    const formatId = encodingSupport.h264 ? 'mp4-h264' : 'webm-vp8';
    const bestFormat = await getBestFormatForResolution(formatId, outputWidth, outputHeight);
    if (!bestFormat.formatId) {
        alert(`Video export failed: ${bestFormat.reason}`);
        Globals.justVideoAnalysis = false;
        par.paused = savedPaused;
        if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name("Export Pano Video");
        return;
    }

    const extension = getVideoExtension(bestFormat.formatId);
    const fps = Sit.fps;

    const progress = new ExportProgressWidget('Exporting pano video...', totalFrames);

    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = outputWidth;
    compositeCanvas.height = outputHeight;
    const compositeCtx = compositeCanvas.getContext('2d');

    const savedFrame = par.frame;

    try {
        const exporter = await createVideoExporter(bestFormat.formatId, {
            width: outputWidth,
            height: outputHeight,
            fps,
            bitrate: 20_000_000,
            keyFrameInterval: 30,
            hardwareAcceleration: bestFormat.hardwareAcceleration,
        });

        await exporter.initialize();

        for (let i = 0; i < totalFrames; i++) {
            if (progress.shouldStop()) break;

            const fd = frameData[i];
            par.frame = fd.frame;
            GlobalDateTimeNode.update(fd.frame);

            const loaded = await videoData.requestFrameSequential(fd.frame);
            if (!loaded) continue;

            const image = videoData.getImageNoPurge(fd.frame);
            if (!image || !image.width) continue;

            compositeCtx.fillStyle = 'black';
            compositeCtx.fillRect(0, 0, outputWidth, outputHeight);

            compositeCtx.drawImage(panoCanvas, offsetX, offsetY, fitWidth, fitHeight);

            const frameX = offsetX + (fd.px - minPx) * panoScale * videoFrameScaleInPano;
            const frameY = offsetY + (fd.py - minPy) * panoScale * videoFrameScaleInPano;

            compositeCtx.drawImage(
                image,
                crop, crop, croppedWidth, croppedHeight,
                frameX, frameY, videoFrameWidth, videoFrameHeight
            );

            await exporter.addFrame(compositeCanvas, fd.frame);

            if (i % 10 === 0) {
                progress.update(i + 1);
                const pct = Math.round(100 * i / totalFrames);
                if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name(`Video... ${pct}%`);
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (progress.shouldSave()) {
            const blob = await exporter.finalize(
                (current, total) => progress.setFinalizeProgress(current, total),
                (status) => progress.setStatus(status)
            );

            const filename = `pano_video_${Sit.name || 'export'}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.${extension}`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            console.log(`Pano video exported: ${filename}`);
        }

    } catch (e) {
        console.error('Pano video export failed:', e);
        alert('Pano video export failed: ' + e.message);
    } finally {
        progress.remove();
        par.frame = savedFrame;
        Globals.justVideoAnalysis = false;
        par.paused = savedPaused;
        if (exportPanoVideoMenuItem) exportPanoVideoMenuItem.name("Export Pano Video");
        setRenderOne(true);
    }
}

export function addMotionAnalysisMenu() {
    if (!guiMenus.view) return;
    
    motionFolder = guiMenus.view.addFolder("Motion Analysis").close().perm();
    
    const menuActions = {
        analyzeMotion: toggleMotionAnalysis,
        createTrack: createTrackFromMotion,
        exportPanorama: exportMotionPanorama,
        exportPanoVideo: exportPanoVideo,
    };

    analyzeMenuItem = motionFolder.add(menuActions, 'analyzeMotion')
        .name("Analyze Motion")
        .tooltip("Toggle real-time motion analysis overlay on video")
        .perm();

    createTrackMenuItem = motionFolder.add(menuActions, 'createTrack')
        .name("Create Track from Motion")
        .tooltip("Analyze all frames and create a ground track from motion vectors")
        .perm();

    exportPanoMenuItem = motionFolder.add(menuActions, 'exportPanorama')
        .name("Export Motion Panorama")
        .tooltip("Create a panorama image from video frames using motion tracking offsets")
        .perm();

    exportPanoVideoMenuItem = motionFolder.add(menuActions, 'exportPanoVideo')
        .name("Export Pano Video")
        .tooltip("Create a 4K video showing the panorama with video frame overlay")
        .perm();

    const panoParams = {
        get panoCrop() { return panoCrop; }, set panoCrop(v) { panoCrop = v; },
        get useMaskInPano() { return useMaskInPano; }, set useMaskInPano(v) { useMaskInPano = v; },
        get panoFrameStep() { return panoFrameStep; }, set panoFrameStep(v) { panoFrameStep = v; }
    };
    motionFolder.add(panoParams, 'panoFrameStep', 1, 60, 1)
        .name("Pano Frame Step")
        .tooltip("How many frames to step between each panorama frame (1 = every frame)")
        .perm();
    motionFolder.add(panoParams, 'panoCrop', 0, 100, 1)
        .name("Panorama Crop")
        .tooltip("Pixels to crop from each edge of video frames")
        .perm();
    motionFolder.add(panoParams, 'useMaskInPano')
        .name("Use Mask in Pano")
        .tooltip("Apply motion tracking mask as transparency when rendering panorama")
        .perm();
}

function createParamSliders() {
    if (!motionFolder || !motionAnalyzer) return;
    
    removeParamSliders();
    
    if (motionAnalyzer.autoMaskWindow === undefined) {
        motionAnalyzer.autoMaskWindow = 10;
    }
    if (motionAnalyzer.autoMaskThreshold === undefined) {
        motionAnalyzer.autoMaskThreshold = 0.9;
    }
    if (motionAnalyzer.autoMaskSpread === undefined) {
        motionAnalyzer.autoMaskSpread = 5;
    }
    if (!motionAnalyzer.autoMaskTargetColor || typeof motionAnalyzer.autoMaskTargetColor !== 'object') {
        motionAnalyzer.autoMaskTargetColor = {r: 235, g: 235, b: 235};
    }
    if (motionAnalyzer.autoMaskCloseToTarget === undefined) {
        motionAnalyzer.autoMaskCloseToTarget = 140;
    }
    
    const p = motionAnalyzer.params;
    const invalidate = () => motionAnalyzer.onParamChange();
    const update = () => setRenderOne(true);
    
    if (isLocal || Globals.userID === 1) {
        const techniqueOptions = Object.values(MOTION_TECHNIQUES);
        paramControllers.push(motionFolder.add(p, 'technique', techniqueOptions).name("Technique").onChange((newTechnique) => {
            console.log("Technique changed to:", newTechnique);
            invalidate();
            removeParamSliders();
            createParamSliders();
        }).tooltip("Motion estimation algorithm"));
    }
    
    const isTracklet = p.technique === MOTION_TECHNIQUES.LINEAR_TRACKLET;
    paramControllers.push(motionFolder.add(p, 'frameSkip', 1, 10, 1)
        .name(isTracklet ? "Tracklet Length" : "Frame Skip")
        .onChange(invalidate)
        .tooltip(isTracklet ? "Number of frames in tracklet (longer = stricter coherence)" : "Frames between comparisons (higher = detect slower motion)"));
    paramControllers.push(motionFolder.add(p, 'blurSize', 1, 15, 2).name("Blur Size").onChange(invalidate)
        .tooltip("Gaussian blur for macro features (odd numbers)"));
    paramControllers.push(motionFolder.add(p, 'minMotion', 0, 2, 0.1).name("Min Motion").onChange(invalidate)
        .tooltip("Minimum motion magnitude (pixels/frame)"));
    paramControllers.push(motionFolder.add(p, 'maxMotion', 10, 200, 5).name("Max Motion").onChange(invalidate)
        .tooltip("Maximum motion magnitude"));
    paramControllers.push(motionFolder.add(p, 'smoothingAlpha', 0.5, 0.99, 0.01).name("Smoothing").onChange(invalidate)
        .tooltip("Direction smoothing (higher = more smoothing)"));
    paramControllers.push(motionFolder.add(p, 'minVectorCount', 1, 50, 1).name("Min Vector Count").onChange(invalidate)
        .tooltip("Minimum number of motion vectors for a valid frame"));
    paramControllers.push(motionFolder.add(p, 'minConsensusConfidence', 0, 0.5, 0.01).name("Min Confidence").onChange(invalidate)
        .tooltip("Minimum consensus confidence for a valid frame"));
    
    const usesFeatures = p.technique === MOTION_TECHNIQUES.SPARSE_CONSENSUS || p.technique === MOTION_TECHNIQUES.AFFINE_RANSAC || p.technique === MOTION_TECHNIQUES.LINEAR_TRACKLET;
    if (usesFeatures) {
        paramControllers.push(motionFolder.add(p, 'maxFeatures', 50, 500, 10).name("Max Features").onChange(invalidate)
            .tooltip("Maximum tracked features"));
        paramControllers.push(motionFolder.add(p, 'minDistance', 5, 50, 1).name("Min Distance").onChange(invalidate)
            .tooltip("Minimum distance between features"));
        paramControllers.push(motionFolder.add(p, 'qualityLevel', 0.001, 0.1, 0.001).name("Quality Level").onChange(invalidate)
            .tooltip("Feature detection quality threshold"));
        paramControllers.push(motionFolder.add(p, 'maxTrackError', 5, 50, 1).name("Max Track Error").onChange(invalidate)
            .tooltip("Maximum tracking error threshold"));
    }
    
    if (p.technique === MOTION_TECHNIQUES.SPARSE_CONSENSUS) {
        paramControllers.push(motionFolder.add(p, 'minQuality', 0, 1, 0.05).name("Min Quality").onChange(invalidate)
            .tooltip("Minimum quality to display arrow"));
        paramControllers.push(motionFolder.add(p, 'staticThreshold', 0.1, 2, 0.1).name("Static Threshold").onChange(invalidate)
            .tooltip("Motion below this is considered static (HUD)"));
        paramControllers.push(motionFolder.add(p, 'staticFrames', 5, 30, 1).name("Static Frames").onChange(invalidate)
            .tooltip("Frames to confirm static detection"));
        paramControllers.push(motionFolder.add(p, 'inlierThreshold', 0.3, 0.9, 0.05).name("Inlier Threshold").onChange(invalidate)
            .tooltip("Threshold for consensus direction agreement"));
    }
    
    if (p.technique === MOTION_TECHNIQUES.ECC_EUCLIDEAN) {
        paramControllers.push(motionFolder.add(p, 'eccIterations', 10, 200, 10).name("ECC Iterations").onChange(invalidate)
            .tooltip("Maximum iterations for ECC convergence"));
        paramControllers.push(motionFolder.add(p, 'eccEpsilon', 0.0001, 0.01, 0.0001).name("ECC Epsilon").onChange(invalidate)
            .tooltip("Convergence threshold for ECC"));
    }
    
    if (p.technique === MOTION_TECHNIQUES.AFFINE_RANSAC) {
        paramControllers.push(motionFolder.add(p, 'ransacThreshold', 1, 10, 0.5).name("RANSAC Threshold").onChange(invalidate)
            .tooltip("Maximum reprojection error for inliers (pixels)"));
    }
    
    if (p.technique === MOTION_TECHNIQUES.LINEAR_TRACKLET) {
        paramControllers.push(motionFolder.add(p, 'minQuality', 0, 1, 0.05).name("Min Quality").onChange(invalidate)
            .tooltip("Minimum quality to display arrow"));
        paramControllers.push(motionFolder.add(p, 'staticThreshold', 0.1, 2, 0.1).name("Static Threshold").onChange(invalidate)
            .tooltip("Motion below this is considered static (HUD)"));
        paramControllers.push(motionFolder.add(p, 'staticFrames', 5, 30, 1).name("Static Frames").onChange(invalidate)
            .tooltip("Frames to confirm static detection"));
        paramControllers.push(motionFolder.add(p, 'inlierThreshold', 0.3, 0.9, 0.05).name("Inlier Threshold").onChange(invalidate)
            .tooltip("Threshold for consensus direction agreement"));
        paramControllers.push(motionFolder.add(p, 'linearityThreshold', 0.5, 1, 0.05).name("Linearity Threshold").onChange(invalidate)
            .tooltip("Min trajectory straightness (1=perfect line)"));
        paramControllers.push(motionFolder.add(p, 'spacingThreshold', 0, 1, 0.05).name("Spacing Threshold").onChange(invalidate)
            .tooltip("Min step spacing consistency (1=perfectly even)"));
    }
    
    const maskFolder = motionFolder.addFolder("Masking").close();
    
    const maskControls = {
        editMask: false,
        clearMask: () => {
            if (motionAnalyzer) {
                motionAnalyzer.clearMask();
                motionAnalyzer.onMaskChange();
            }
        },
        autoMask: () => {
            if (motionAnalyzer) {
                motionAnalyzer.autoMask();
            }
        }
    };
    
    paramControllers.push(maskFolder.add(motionAnalyzer, 'maskEnabled').name("Enable Mask").onChange(() => {
        motionAnalyzer.updateMaskPreview();
        motionAnalyzer.onMaskChange();
    }).tooltip("Enable/disable mask filtering"));
    
    paramControllers.push(maskFolder.add(maskControls, 'editMask').name("Edit Mask").onChange((v) => {
        motionAnalyzer.setMaskEditing(v);
    }).tooltip("Click and drag to paint mask (Alt/Option to erase)"));
    
    if (motionAnalyzer.maskOverlayNode) {
        paramControllers.push(maskFolder.add(motionAnalyzer.maskOverlayNode, 'brushSize', 5, 50, 1).name("Brush Size").onChange(update)
            .tooltip("Mask brush size in pixels"));
    }
    
    paramControllers.push(maskFolder.add(maskControls, 'clearMask').name("Clear Mask")
        .tooltip("Clear all mask data"));
    
    paramControllers.push(maskFolder.add(maskControls, 'autoMask').name("Auto Mask")
        .tooltip("Auto-generate mask from static pixels over frame window"));
    
    const runAutoMask = () => motionAnalyzer.autoMask();
    
    paramControllers.push(maskFolder.add(motionAnalyzer, 'autoMaskWindow', 10, 30, 1).name("Auto Window")
        .onChange(runAutoMask).tooltip("Number of frames to analyze for auto mask"));
    
    paramControllers.push(maskFolder.add(motionAnalyzer, 'autoMaskThreshold', 0.9, 1, 0.001).name("Auto Threshold")
        .onChange(runAutoMask).tooltip("Color similarity threshold (higher = stricter)"));
    
    paramControllers.push(maskFolder.add(motionAnalyzer, 'autoMaskSpread', 1, 10, 0.1).name("Auto Spread")
        .onChange(runAutoMask).tooltip("Radius of mask circle at each invariant pixel"));
    
    paramControllers.push(maskFolder.addColor(motionAnalyzer, 'autoMaskTargetColor', 255).name("Target Color")
        .onChange(runAutoMask).tooltip("Target color for auto mask"));
    
    paramControllers.push(maskFolder.add(motionAnalyzer, 'autoMaskCloseToTarget', 0, 255, 1).name("Color Tolerance")
        .onChange(runAutoMask).tooltip("How close pixel must be to target color (lower = stricter)"));
    
    motionFolder.open();
}

function removeParamSliders() {
    for (const ctrl of paramControllers) {
        try { ctrl.destroy(); } catch (e) {}
    }
    paramControllers = [];
}

export function getMotionAnalysisOverlays() {
    if (!motionAnalyzer || !motionAnalyzer.active) return null;
    return {
        overlay: motionAnalyzer.overlay,
        graphCanvas: motionAnalyzer.graphCanvas,
        videoView: motionAnalyzer.videoView,
    };
}

export function getMotionAnalyzerForTesting() {
    return motionAnalyzer;
}

export function serializeMotionAnalysis() {
    if (!motionAnalyzer) return null;
    
    return {
        active: motionAnalyzer.active,
        params: {...motionAnalyzer.params},
        maskEnabled: motionAnalyzer.maskEnabled,
        brushSize: motionAnalyzer.brushSize,
        autoMaskWindow: motionAnalyzer.autoMaskWindow,
        autoMaskThreshold: motionAnalyzer.autoMaskThreshold,
        autoMaskSpread: motionAnalyzer.autoMaskSpread,
        autoMaskTargetColor: {...motionAnalyzer.autoMaskTargetColor},
        autoMaskCloseToTarget: motionAnalyzer.autoMaskCloseToTarget,
        maskData: motionAnalyzer.maskOverlayNode?.maskData ?? null,
    };
}

export async function deserializeMotionAnalysis(data) {
    if (!data) return;
    
    const videoView = NodeMan.get("video", false);
    if (!videoView) return;
    
    if (data.active) {
        const doRestore = () => {
            if (!motionAnalyzer) {
                motionAnalyzer = new MotionAnalyzer(videoView);
            }
            
            if (data.params) {
                Object.assign(motionAnalyzer.params, data.params);
            }
            if (data.maskEnabled !== undefined) {
                motionAnalyzer.maskEnabled = data.maskEnabled;
            }
            if (data.brushSize !== undefined) {
                motionAnalyzer.brushSize = data.brushSize;
            }
            if (data.autoMaskWindow !== undefined) {
                motionAnalyzer.autoMaskWindow = data.autoMaskWindow;
            }
            if (data.autoMaskThreshold !== undefined) {
                motionAnalyzer.autoMaskThreshold = data.autoMaskThreshold;
            }
            if (data.autoMaskSpread !== undefined) {
                motionAnalyzer.autoMaskSpread = data.autoMaskSpread;
            }
            if (data.autoMaskTargetColor !== undefined) {
                motionAnalyzer.autoMaskTargetColor = {...data.autoMaskTargetColor};
            }
            if (data.autoMaskCloseToTarget !== undefined) {
                motionAnalyzer.autoMaskCloseToTarget = data.autoMaskCloseToTarget;
            }
            
            motionAnalyzer.start();
            
            if (data.maskData && motionAnalyzer.maskOverlayNode) {
                motionAnalyzer.maskOverlayNode.maskData = data.maskData;
                motionAnalyzer.maskOverlayNode.loadMask();
            }
            
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
        };
        
        if (!cv) {
            await loadOpenCV();
            cv = getCV();
        }
        doRestore();
    }
}
