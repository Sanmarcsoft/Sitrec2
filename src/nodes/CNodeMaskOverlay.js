import {CNodeActiveOverlay} from "./CNodeTrackingOverlay";
import {setRenderOne, Sit} from "../Globals";
import {mouseToCanvas} from "../ViewUtils";
import {undoManager} from "../UndoManager";

export class CNodeMaskOverlay extends CNodeActiveOverlay {
    constructor(v) {
        super(v);
        
        this.separateVisibility = true;
        
        if (v.visible !== undefined) {
            this.visible = !v.visible;
            this.setVisible(v.visible);
        }
        
        this.brushSize = v.brushSize ?? 20;
        this.onMaskChange = v.onMaskChange ?? null;
        this.maskCanvas = null;
        this.maskCtx = null;
        this.maskImageData = null;
        this.isDrawing = false;
        this.lastDrawX = null;
        this.lastDrawY = null;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.preDrawMaskData = null;
        
        this.loadMask();
    }
    
    notifyMaskChange() {
        if (typeof this.onMaskChange === 'function') {
            this.onMaskChange();
        }
    }
    
    loadMask() {
        if (Sit.motionMask) {
            const img = new Image();
            img.onload = () => {
                if (this.maskCanvas) {
                    this.maskCtx.drawImage(img, 0, 0);
                    this.updateMaskImageData();
                }
            };
            img.src = Sit.motionMask;
        }
    }
    
    saveMask() {
        if (this.maskCanvas) {
            Sit.motionMask = this.maskCanvas.toDataURL('image/png');
            this.updateMaskImageData();
            this.notifyMaskChange();
        }
    }
    
    initMask(width, height) {
        if (this.maskCanvas && this.maskCanvas.width === width && this.maskCanvas.height === height) {
            return;
        }
        
        const oldData = this.maskCanvas ? this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height) : null;
        
        this.maskCanvas = document.createElement('canvas');
        this.maskCanvas.width = width;
        this.maskCanvas.height = height;
        this.maskCtx = this.maskCanvas.getContext('2d', {willReadFrequently: true});
        
        if (oldData) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = oldData.width;
            tempCanvas.height = oldData.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(oldData, 0, 0);
            this.maskCtx.drawImage(tempCanvas, 0, 0, width, height);
            this.updateMaskImageData();
        } else if (Sit.motionMask) {
            const img = new Image();
            img.onload = () => {
                this.maskCtx.drawImage(img, 0, 0, width, height);
                this.updateMaskImageData();
            };
            img.src = Sit.motionMask;
        }
    }
    
    updateMaskImageData() {
        if (this.maskCanvas) {
            this.maskImageData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        }
    }
    
    isPointMasked(x, y) {
        if (!this.maskImageData) return false;
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        if (ix < 0 || ix >= this.maskCanvas.width || iy < 0 || iy >= this.maskCanvas.height) return false;
        const idx = (iy * this.maskCanvas.width + ix) * 4;
        return this.maskImageData.data[idx + 3] > 128;
    }
    
    clearMask() {
        if (this.maskCanvas) {
            const preData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            const overlay = this;
            
            this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            this.updateMaskImageData();
            this.saveMask();
            
            undoManager.add({
                description: "Clear mask",
                undo: () => {
                    if (overlay.maskCanvas) {
                        overlay.maskCtx.putImageData(preData, 0, 0);
                        overlay.saveMask();
                        setRenderOne(true);
                    }
                },
                redo: () => {
                    if (overlay.maskCanvas) {
                        overlay.maskCtx.clearRect(0, 0, overlay.maskCanvas.width, overlay.maskCanvas.height);
                        overlay.saveMask();
                        setRenderOne(true);
                    }
                }
            });
            
            setRenderOne(true);
        }
    }
    
    ensureMaskInitialized() {
        const videoWidth = this.overlayView.videoWidth;
        const videoHeight = this.overlayView.videoHeight;
        if (videoWidth > 0 && videoHeight > 0) {
            this.initMask(videoWidth, videoHeight);
        }
    }
    
    drawBrushAt(vX, vY, erase) {
        this.ensureMaskInitialized();
        if (!this.maskCanvas) return;
        
        this.maskCtx.beginPath();
        this.maskCtx.arc(vX, vY, this.brushSize, 0, Math.PI * 2);
        
        if (erase) {
            this.maskCtx.globalCompositeOperation = 'destination-out';
        } else {
            this.maskCtx.globalCompositeOperation = 'source-over';
        }
        this.maskCtx.fillStyle = 'rgba(255, 0, 0, 1)';
        this.maskCtx.fill();
        this.maskCtx.globalCompositeOperation = 'source-over';
    }
    
    drawLineTo(vX, vY, erase) {
        if (this.lastDrawX === null || this.lastDrawY === null) {
            this.drawBrushAt(vX, vY, erase);
        } else {
            const dx = vX - this.lastDrawX;
            const dy = vY - this.lastDrawY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const step = this.brushSize / 4;
            const steps = Math.max(1, Math.ceil(dist / step));
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const x = this.lastDrawX + dx * t;
                const y = this.lastDrawY + dy * t;
                this.drawBrushAt(x, y, erase);
            }
        }
        this.lastDrawX = vX;
        this.lastDrawY = vY;
    }
    
    onMouseDown(e, mouseX, mouseY) {
        const [cx, cy] = mouseToCanvas(this, mouseX, mouseY);
        const [vX, vY] = this.overlayView.canvasToVideoCoords(cx, cy);
        
        this.ensureMaskInitialized();
        if (this.maskCanvas) {
            this.preDrawMaskData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        }
        
        this.isDrawing = true;
        this.lastDrawX = null;
        this.lastDrawY = null;
        this.drawLineTo(vX, vY, e.altKey);
        setRenderOne(true);
        return true;
    }
    
    onMouseDrag(e, mouseX, mouseY) {
        this.lastMouseX = mouseX;
        this.lastMouseY = mouseY;
        
        if (!this.isDrawing) return;
        
        const [cx, cy] = mouseToCanvas(this, mouseX, mouseY);
        const [vX, vY] = this.overlayView.canvasToVideoCoords(cx, cy);
        
        this.drawLineTo(vX, vY, e.altKey);
        setRenderOne(true);
    }
    
    onMouseUp(e, mouseX, mouseY) {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.lastDrawX = null;
            this.lastDrawY = null;
            
            if (this.maskCanvas && this.preDrawMaskData) {
                const postDrawMaskData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
                const preData = this.preDrawMaskData;
                const overlay = this;
                
                undoManager.add({
                    description: "Mask paint",
                    undo: () => {
                        if (overlay.maskCanvas) {
                            overlay.maskCtx.putImageData(preData, 0, 0);
                            overlay.saveMask();
                            setRenderOne(true);
                        }
                    },
                    redo: () => {
                        if (overlay.maskCanvas) {
                            overlay.maskCtx.putImageData(postDrawMaskData, 0, 0);
                            overlay.saveMask();
                            setRenderOne(true);
                        }
                    }
                });
                
                this.preDrawMaskData = null;
            }
            
            this.saveMask();
        }
    }
    
    onMouseMove(e, mouseX, mouseY) {
        this.lastMouseX = mouseX;
        this.lastMouseY = mouseY;
        setRenderOne(true);
    }
    
    renderCanvas(frame) {
        super.renderCanvas(frame);
        
        this.ensureMaskInitialized();
        if (!this.maskCanvas) return;
        
        const ctx = this.ctx;
        
        ctx.save();
        ctx.globalAlpha = 0.4;
        
        this.overlayView.getSourceAndDestCoords();
        const {dx, dy, dWidth, dHeight} = this.overlayView;
        
        ctx.drawImage(this.maskCanvas, dx, dy, dWidth, dHeight);
        ctx.restore();
        
        this.drawBrushCursor();
    }
    
    drawBrushCursor() {
        const ctx = this.ctx;
        const [cx, cy] = mouseToCanvas(this, this.lastMouseX, this.lastMouseY);
        
        this.overlayView.getSourceAndDestCoords();
        const {dWidth} = this.overlayView;
        const videoWidth = this.overlayView.videoWidth || 1;
        const brushRadius = this.brushSize * dWidth / videoWidth;
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, brushRadius, 0, Math.PI * 2);
        ctx.stroke();
    }
}
