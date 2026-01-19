import {setRenderOne} from "./Globals";

class CVideoLoadingManagerClass {
    constructor() {
        this.loadingVideos = new Map();
        this.loadingDiv = null;
        this.loadingCanvas = null;
    }

    registerLoading(videoId, fileName, progressCallback) {
        console.log(`[VideoLoadingManager] registerLoading: ${videoId}, file: ${fileName}`);
        const entry = {
            fileName: this.getShortFileName(fileName),
            fullPath: fileName,
            progress: 0,
            startTime: Date.now(),
            progressCallback: progressCallback
        };
        this.loadingVideos.set(videoId, entry);
        this.updateUI();
        return entry;
    }

    updateProgress(videoId, progress) {
        const entry = this.loadingVideos.get(videoId);
        if (entry) {
            entry.progress = Math.min(100, Math.max(0, progress));
            this.updateUI();
            setRenderOne(true);
        }
    }

    completeLoading(videoId) {
        console.log(`[VideoLoadingManager] completeLoading called for: ${videoId}, was registered: ${this.loadingVideos.has(videoId)}`);
        this.loadingVideos.delete(videoId);
        this.updateUI();
        setRenderOne(true);
    }

    isLoading(videoId) {
        return this.loadingVideos.has(videoId);
    }

    getLoadingCount() {
        return this.loadingVideos.size;
    }

    getShortFileName(fileName) {
        if (!fileName) return "Unknown";
        let name = fileName;
        if (name.includes('/')) {
            name = name.split('/').pop();
        }
        if (name.length > 40) {
            name = name.substring(0, 37) + "...";
        }
        return name;
    }

    createLoadingImage(width = 640, height = 480, text = "Loading...") {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        const centerX = width / 2;
        const centerY = height / 2;

        ctx.strokeStyle = '#4a4a6a';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(centerX, centerY - 30, 20 + i * 15, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = '#f0f000';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, centerX, centerY + 40);

        ctx.fillStyle = '#888888';
        ctx.font = '16px sans-serif';
        ctx.fillText("Please wait...", centerX, centerY + 80);

        return canvas;
    }

    createLoadingImageForVideo(fileName, width = 640, height = 480) {
        const shortName = this.getShortFileName(fileName);
        return this.createLoadingImage(width, height, `Loading: ${shortName}`);
    }

    ensureUIExists() {
        if (this.loadingDiv) return;

        this.loadingDiv = document.createElement('div');
        this.loadingDiv.id = 'videoLoadingIndicator';
        this.loadingDiv.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: rgba(26, 26, 46, 0.95);
            border: 1px solid #4a4a6a;
            border-radius: 8px;
            padding: 12px 16px;
            color: #f0f000;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 13px;
            z-index: 10000;
            min-width: 200px;
            max-width: 400px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            display: none;
        `;
        document.body.appendChild(this.loadingDiv);
    }

    updateUI() {
        this.ensureUIExists();

        if (this.loadingVideos.size === 0) {
            this.loadingDiv.style.display = 'none';
            return;
        }

        this.loadingDiv.style.display = 'block';

        let html = `<div style="font-weight: bold; margin-bottom: 8px; color: #fff;">
            Loading Videos (${this.loadingVideos.size})
        </div>`;

        for (const [videoId, entry] of this.loadingVideos) {
            const elapsed = Math.round((Date.now() - entry.startTime) / 1000);
            const progressPercent = Math.round(entry.progress);

            html += `<div style="margin: 6px 0; padding: 6px; background: rgba(74, 74, 106, 0.3); border-radius: 4px;">
                <div style="color: #aaa; font-size: 11px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${entry.fileName}
                </div>
                <div style="background: #2a2a4a; border-radius: 3px; height: 6px; overflow: hidden;">
                    <div style="background: linear-gradient(90deg, #4a9eff, #00d4aa); width: ${progressPercent}%; height: 100%; transition: width 0.3s;"></div>
                </div>
                <div style="color: #666; font-size: 10px; margin-top: 2px;">
                    ${progressPercent > 0 ? progressPercent + '%' : 'Starting...'} ${elapsed > 0 ? '(' + elapsed + 's)' : ''}
                </div>
            </div>`;
        }

        this.loadingDiv.innerHTML = html;
    }

    dispose() {
        if (this.loadingDiv && this.loadingDiv.parentNode) {
            this.loadingDiv.parentNode.removeChild(this.loadingDiv);
            this.loadingDiv = null;
        }
        this.loadingVideos.clear();
    }
}

export const VideoLoadingManager = new CVideoLoadingManagerClass();
