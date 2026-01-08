import {CNodeActiveOverlay} from "./CNodeTrackingOverlay";
import {getFlowAlignRotation} from "../FlowAlignment";

const GRID_SIZE = 100;

function thermalColor(t) {
    t = Math.max(0, Math.min(1, t));
    let r, g, b;
    if (t < 0.25) {
        const s = t / 0.25;
        r = 0;
        g = s;
        b = 1;
    } else if (t < 0.5) {
        const s = (t - 0.25) / 0.25;
        r = 0;
        g = 1;
        b = 1 - s;
    } else if (t < 0.75) {
        const s = (t - 0.5) / 0.25;
        r = s;
        g = 1;
        b = 0;
    } else {
        const s = (t - 0.75) / 0.25;
        r = 1;
        g = 1 - s;
        b = 0;
    }
    return {r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255)};
}

export class CNodeSpeedOverlay extends CNodeActiveOverlay {
    constructor(v) {
        super(v);
        
        this.separateVisibility = true;
        this.visible = false;
        this.enabled = false;
        
        this.gridCanvas = document.createElement('canvas');
        this.gridCanvas.width = GRID_SIZE;
        this.gridCanvas.height = GRID_SIZE;
        this.gridCtx = this.gridCanvas.getContext('2d', {willReadFrequently: true});
        
        this.currentMinSpeed = 0;
        this.currentMaxSpeed = 1;
        
        this.motionAnalyzerRef = null;
    }
    
    setMotionAnalyzer(analyzer) {
        this.motionAnalyzerRef = analyzer;
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
        this.visible = enabled;
        if (!enabled && this.ctx) {
            this.ctx.clearRect(0, 0, this.widthPx, this.heightPx);
        }
    }
    
    updateSpeedRange(speeds) {
        if (!speeds || speeds.length === 0) return;
        
        const sorted = [...speeds].sort((a, b) => a - b);
        this.currentMinSpeed = sorted[0] || 0;
        this.currentMaxSpeed = Math.max(this.currentMinSpeed + 0.1, sorted[sorted.length - 1] || 1);
    }
    
    computeGridSpeeds(flowVectors, videoWidth, videoHeight) {
        const cellWidth = videoWidth / GRID_SIZE;
        const cellHeight = videoHeight / GRID_SIZE;
        
        const grid = new Array(GRID_SIZE * GRID_SIZE).fill(null).map(() => ({sum: 0, count: 0}));
        
        if (flowVectors && flowVectors.length > 0) {
            for (const v of flowVectors) {
                const gx = Math.floor(v.px / cellWidth);
                const gy = Math.floor(v.py / cellHeight);
                if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
                    const speed = Math.sqrt(v.dx * v.dx + v.dy * v.dy);
                    const idx = gy * GRID_SIZE + gx;
                    grid[idx].sum += speed;
                    grid[idx].count++;
                }
            }
        }
        
        const speeds = [];
        const result = new Array(GRID_SIZE * GRID_SIZE);
        for (let i = 0; i < grid.length; i++) {
            if (grid[i].count > 0) {
                const avgSpeed = grid[i].sum / grid[i].count;
                result[i] = avgSpeed;
                speeds.push(avgSpeed);
            } else {
                result[i] = null;
            }
        }
        
        return {grid: result, speeds};
    }
    
    interpolateInBounds(grid) {
        let minX = GRID_SIZE, maxX = -1, minY = GRID_SIZE, maxY = -1;
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                if (grid[y * GRID_SIZE + x] !== null) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        
        if (maxX < 0) return grid;
        
        const result = [...grid];
        
        for (let pass = 0; pass < 3; pass++) {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const idx = y * GRID_SIZE + x;
                    if (result[idx] !== null) continue;
                    
                    let sum = 0, count = 0;
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) {
                            const nx = x + dx, ny = y + dy;
                            if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
                                const nidx = ny * GRID_SIZE + nx;
                                if (result[nidx] !== null) {
                                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                                    sum += result[nidx] / dist;
                                    count += 1 / dist;
                                }
                            }
                        }
                    }
                    if (count > 0) {
                        result[idx] = sum / count;
                    }
                }
            }
        }
        
        return result;
    }
    
    renderGridToCanvas(grid) {
        const imgData = this.gridCtx.createImageData(GRID_SIZE, GRID_SIZE);
        const pixels = imgData.data;
        
        const range = this.currentMaxSpeed - this.currentMinSpeed;
        
        for (let i = 0; i < grid.length; i++) {
            const speed = grid[i];
            const pi = i * 4;
            if (speed === null) {
                pixels[pi + 3] = 0;
            } else {
                const t = range > 0 ? (speed - this.currentMinSpeed) / range : 0.5;
                const color = thermalColor(t);
                pixels[pi] = color.r;
                pixels[pi + 1] = color.g;
                pixels[pi + 2] = color.b;
                pixels[pi + 3] = 180;
            }
        }
        
        this.gridCtx.putImageData(imgData, 0, 0);
    }
    
    renderCanvas(frame) {
        if (!this.enabled) return;
        
        super.renderCanvas(frame);
        
        this.ctx.clearRect(0, 0, this.widthPx, this.heightPx);
        
        const analyzer = this.motionAnalyzerRef;
        if (!analyzer) return;
        
        const cached = analyzer.resultCache.get(Math.floor(frame));
        const flowVectors = cached?.flowData?.vectors || [];
        
        const videoWidth = this.overlayView.videoWidth || 1920;
        const videoHeight = this.overlayView.videoHeight || 1080;
        
        const {grid, speeds} = this.computeGridSpeeds(flowVectors, videoWidth, videoHeight);
        this.updateSpeedRange(speeds);
        const interpolated = this.interpolateInBounds(grid);
        this.renderGridToCanvas(interpolated);
        
        const ctx = this.ctx;
        const flowRotation = getFlowAlignRotation(frame);
        
        ctx.save();
        ctx.globalAlpha = 0.6;
        
        if (flowRotation !== 0) {
            ctx.translate(this.widthPx / 2, this.heightPx / 2);
            ctx.rotate(flowRotation);
            ctx.translate(-this.widthPx / 2, -this.heightPx / 2);
        }
        
        this.overlayView.getSourceAndDestCoords();
        const {dx, dy, dWidth, dHeight} = this.overlayView;
        
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.gridCanvas, dx, dy, dWidth, dHeight);
        ctx.restore();
    }
}
