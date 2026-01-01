import {guiMenus, NodeMan, setRenderOne} from "./Globals";

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
        this.gridSize = 10;
        this.active = false;
        this.prevGray = null;
        this.prevFrame = -1;
        this.motionVectors = null;
        this.overlay = null;
        this.overlayCtx = null;
    }

    createOverlay() {
        if (this.overlay) return;

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
    }

    removeOverlay() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.overlayCtx = null;
    }

    start() {
        this.active = true;
        this.createOverlay();
        this.prevGray = null;
        this.prevFrame = -1;
        this.motionVectors = new Array(this.gridSize * this.gridSize).fill(null).map(() => ({x: 0, y: 0}));
    }

    stop() {
        this.active = false;
        this.removeOverlay();
        if (this.prevGray) {
            this.prevGray.delete();
            this.prevGray = null;
        }
    }

    analyze(frame) {
        if (!this.active || !cv) return;

        const videoData = this.videoView.videoData;
        if (!videoData) return;

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
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        src.delete();

        if (this.prevGray && frame === this.prevFrame + 1) {
            this.computeOpticalFlow(this.prevGray, gray, tempCanvas.width, tempCanvas.height);
        }

        if (this.prevGray) {
            this.prevGray.delete();
        }
        this.prevGray = gray;
        this.prevFrame = frame;

        this.drawOverlay(width, height);
    }

    computeOpticalFlow(prevGray, gray, imgWidth, imgHeight) {
        const cellW = imgWidth / this.gridSize;
        const cellH = imgHeight / this.gridSize;

        const prevPts = [];
        for (let gy = 0; gy < this.gridSize; gy++) {
            for (let gx = 0; gx < this.gridSize; gx++) {
                const cx = (gx + 0.5) * cellW;
                const cy = (gy + 0.5) * cellH;
                prevPts.push(cx, cy);
            }
        }

        const prevPtsMat = cv.matFromArray(this.gridSize * this.gridSize, 1, cv.CV_32FC2, prevPts);
        const nextPtsMat = new cv.Mat();
        const status = new cv.Mat();
        const err = new cv.Mat();

        try {
            cv.calcOpticalFlowPyrLK(prevGray, gray, prevPtsMat, nextPtsMat, status, err);

            for (let i = 0; i < this.gridSize * this.gridSize; i++) {
                if (status.data[i] === 1) {
                    const px = prevPtsMat.floatAt(i, 0);
                    const py = prevPtsMat.floatAt(i, 1);
                    const nx = nextPtsMat.floatAt(i, 0);
                    const ny = nextPtsMat.floatAt(i, 1);
                    const alpha = 0.7;
                    this.motionVectors[i].x = alpha * this.motionVectors[i].x + (1 - alpha) * (nx - px);
                    this.motionVectors[i].y = alpha * this.motionVectors[i].y + (1 - alpha) * (ny - py);
                } else {
                    this.motionVectors[i].x *= 0.9;
                    this.motionVectors[i].y *= 0.9;
                }
            }
        } catch (e) {
            console.warn('Optical flow computation failed:', e);
        }

        prevPtsMat.delete();
        nextPtsMat.delete();
        status.delete();
        err.delete();
    }

    drawOverlay(width, height) {
        const ctx = this.overlayCtx;
        ctx.clearRect(0, 0, width, height);

        const cellW = width / this.gridSize;
        const cellH = height / this.gridSize;
        const scale = 3;

        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 2;

        for (let gy = 0; gy < this.gridSize; gy++) {
            for (let gx = 0; gx < this.gridSize; gx++) {
                const i = gy * this.gridSize + gx;
                const cx = (gx + 0.5) * cellW;
                const cy = (gy + 0.5) * cellH;
                const dx = this.motionVectors[i].x * scale;
                const dy = this.motionVectors[i].y * scale;

                const mag = Math.sqrt(dx * dx + dy * dy);
                if (mag < 0.5) continue;

                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + dx, cy + dy);
                ctx.stroke();

                const angle = Math.atan2(dy, dx);
                const headLen = Math.min(mag * 0.3, 8);
                ctx.beginPath();
                ctx.moveTo(cx + dx, cy + dy);
                ctx.lineTo(
                    cx + dx - headLen * Math.cos(angle - Math.PI / 6),
                    cy + dy - headLen * Math.sin(angle - Math.PI / 6)
                );
                ctx.moveTo(cx + dx, cy + dy);
                ctx.lineTo(
                    cx + dx - headLen * Math.cos(angle + Math.PI / 6),
                    cy + dy - headLen * Math.sin(angle + Math.PI / 6)
                );
                ctx.stroke();
            }
        }
    }
}

let motionAnalyzer = null;
let analyzeMenuItem = null;

export function toggleMotionAnalysis() {
    const videoView = NodeMan.get("video", false);
    if (!videoView) {
        alert("No video view found");
        return;
    }

    if (motionAnalyzer && motionAnalyzer.active) {
        motionAnalyzer.stop();
        motionAnalyzer = null;
        if (analyzeMenuItem) {
            analyzeMenuItem.name("Analyze Motion");
        }
        setRenderOne(true);
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

function startAnalysis(videoView) {
    motionAnalyzer = new MotionAnalyzer(videoView);
    motionAnalyzer.start();
    
    if (analyzeMenuItem) {
        analyzeMenuItem.name("Stop Analysis");
    }

    const originalRender = videoView.renderCanvas.bind(videoView);
    videoView.renderCanvas = function(frame) {
        originalRender(frame);
        if (motionAnalyzer && motionAnalyzer.active) {
            motionAnalyzer.analyze(frame);
        }
    };

    setRenderOne(true);
}

export function addMotionAnalysisMenu() {
    if (!guiMenus.view) return;
    
    const menuActions = {
        analyzeMotion: toggleMotionAnalysis
    };

    analyzeMenuItem = guiMenus.view.add(menuActions, 'analyzeMotion')
        .name("Analyze Motion")
        .tooltip("Toggle real-time motion analysis overlay on video\nShows optical flow vectors in a 10x10 grid");
}
