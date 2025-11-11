import {CNodeTrack} from "./CNodeTrack";
import {setRenderOne, Sit, UndoManager} from "../Globals";
import {par} from "../par";
import {CNodeTabbedCanvasView} from "./CNodeTabbedCanvasView";

export class CNodeCurveEditorView2 extends CNodeTabbedCanvasView {
    constructor(v) {
        v.menuName = v.menuName ?? v.editorConfig.yLabel;
        super(v);
        
        const config = v.editorConfig;
        this.minX = config.minX ?? 0;
        this.maxX = config.maxX ?? 100;
        this.minY = config.minY ?? 0;
        this.maxY = config.maxY ?? 100;
        this.xLabel = config.xLabel ?? "X";
        this.yLabel = config.yLabel ?? "Y";
        this.xStep = config.xStep ?? 10;
        this.yStep = config.yStep ?? 10;
        
        this.points = [];
        if (config.points) {
            for (let i = 0; i < config.points.length; i += 2) {
                this.points.push({x: config.points[i], y: config.points[i + 1]});
            }
        }
        
        this.draggedPointIndex = null;
        this.draggedLineIndex = null;
        this.isDragging = false;
        this.isDraggingLine = false;
        this.isDraggingFrame = false;
        this.isDraggingAFrame = false;
        this.isDraggingBFrame = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.stateBeforeDrag = null;
        
        this.setupMouseHandlers();
    }
    
    captureState() {
        return this.points.map(p => ({x: p.x, y: p.y}));
    }
    
    restoreState(state) {
        this.points = state.map(p => ({x: p.x, y: p.y}));
        if (this.onChange) {
            this.onChange();
        }
        setRenderOne(true);
    }
    
    setupMouseHandlers() {
        this.canvas.addEventListener('pointerdown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.onMouseUp(e));
        
        this.documentMoveHandler = (e) => this.onMouseMove(e);
        this.documentUpHandler = (e) => this.onMouseUp(e);
    }
    
    screenToGraph(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = screenX - rect.left;
        const y = screenY - rect.top;
        
        const margin = 60;
        const graphWidth = this.canvas.width - margin * 2;
        const graphHeight = this.canvas.height - margin * 2;
        
        const graphX = this.minX + (x - margin) / graphWidth * (this.maxX - this.minX);
        const graphY = this.maxY - (y - margin) / graphHeight * (this.maxY - this.minY);
        
        return {x: graphX, y: graphY};
    }
    
    graphToScreen(graphX, graphY) {
        const margin = 60;
        const graphWidth = this.canvas.width - margin * 2;
        const graphHeight = this.canvas.height - margin * 2;
        
        const x = margin + (graphX - this.minX) / (this.maxX - this.minX) * graphWidth;
        const y = margin + (this.maxY - graphY) / (this.maxY - this.minY) * graphHeight;
        
        return {x, y};
    }
    
    findPointAt(screenX, screenY) {
        const threshold = 8;
        for (let i = 0; i < this.points.length; i++) {
            const screen = this.graphToScreen(this.points[i].x, this.points[i].y);
            const dx = screenX - screen.x;
            const dy = screenY - screen.y;
            if (Math.sqrt(dx * dx + dy * dy) < threshold) {
                return i;
            }
        }
        return null;
    }
    
    findLineAt(screenX, screenY) {
        const threshold = 8;
        for (let i = 0; i < this.points.length - 1; i++) {
            const p1 = this.graphToScreen(this.points[i].x, this.points[i].y);
            const p2 = this.graphToScreen(this.points[i + 1].x, this.points[i + 1].y);
            
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            
            if (length === 0) continue;
            
            const dot = ((screenX - p1.x) * dx + (screenY - p1.y) * dy) / (length * length);
            
            if (dot < 0 || dot > 1) continue;
            
            const projX = p1.x + dot * dx;
            const projY = p1.y + dot * dy;
            
            const distX = screenX - projX;
            const distY = screenY - projY;
            const distance = Math.sqrt(distX * distX + distY * distY);
            
            if (distance < threshold) {
                return i;
            }
        }
        return null;
    }
    
    isNearFrame(screenX, screenY, frameX) {
        const threshold = 8;
        const margin = 60;
        
        if (frameX === undefined || frameX < this.minX || frameX > this.maxX) return false;
        
        const screen = this.graphToScreen(frameX, this.minY);
        const distance = Math.abs(screenX - screen.x);
        
        return distance < threshold && screenY >= margin && screenY <= this.canvas.height - margin;
    }
    
    isNearFrameLine(screenX, screenY) {
        return this.isNearFrame(screenX, screenY, par.frame);
    }
    
    isNearAFrameLine(screenX, screenY) {
        return this.isNearFrame(screenX, screenY, Sit.aFrame);
    }
    
    isNearBFrameLine(screenX, screenY) {
        return this.isNearFrame(screenX, screenY, Sit.bFrame);
    }
    
    isInsideGraphArea(x, y) {
        const margin = 60;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        return x >= margin && x <= width - margin && 
               y >= margin && y <= height - margin;
    }
    
    updateCursor(x, y) {
        const pointIndex = this.findPointAt(x, y);
        const lineIndex = this.findLineAt(x, y);
        
        if (pointIndex !== null || lineIndex !== null) {
            this.canvas.style.cursor = 'grab';
        } else if (this.isNearAFrameLine(x, y) || this.isNearBFrameLine(x, y) || this.isNearFrameLine(x, y)) {
            this.canvas.style.cursor = 'ew-resize';
        } else if (this.isInsideGraphArea(x, y)) {
            this.canvas.style.cursor = 'default';
        } else {
            this.canvas.style.cursor = 'move';
        }
    }
    
    startFrameDrag(e, frameType) {
        e.preventDefault();
        e.stopPropagation();
        this.isDragging = true;
        this[frameType] = true;
        document.addEventListener('pointermove', this.documentMoveHandler);
        document.addEventListener('pointerup', this.documentUpHandler);
    }
    
    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.draggedPointIndex = this.findPointAt(x, y);
        if (this.draggedPointIndex !== null) {
            e.preventDefault();
            e.stopPropagation();
            this.stateBeforeDrag = this.captureState();
            this.isDragging = true;
            document.addEventListener('pointermove', this.documentMoveHandler);
            document.addEventListener('pointerup', this.documentUpHandler);
            return;
        }
        
        this.draggedLineIndex = this.findLineAt(x, y);
        if (this.draggedLineIndex !== null) {
            e.preventDefault();
            e.stopPropagation();
            this.stateBeforeDrag = this.captureState();
            this.isDragging = true;
            this.isDraggingLine = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            document.addEventListener('pointermove', this.documentMoveHandler);
            document.addEventListener('pointerup', this.documentUpHandler);
            return;
        }
        
        const abDistance = (Sit.aFrame !== undefined && Sit.bFrame !== undefined) 
            ? (Sit.bFrame - Sit.aFrame) 
            : Infinity;
        
        if (abDistance < 10) {
            if (this.isNearAFrameLine(x, y)) {
                this.startFrameDrag(e, 'isDraggingAFrame');
                return;
            }
            
            if (this.isNearBFrameLine(x, y)) {
                this.startFrameDrag(e, 'isDraggingBFrame');
                return;
            }
            
            if (this.isNearFrameLine(x, y)) {
                this.startFrameDrag(e, 'isDraggingFrame');
                return;
            }
        } else {
            if (this.isNearFrameLine(x, y)) {
                this.startFrameDrag(e, 'isDraggingFrame');
                return;
            }
            
            if (this.isNearAFrameLine(x, y)) {
                this.startFrameDrag(e, 'isDraggingAFrame');
                return;
            }
            
            if (this.isNearBFrameLine(x, y)) {
                this.startFrameDrag(e, 'isDraggingBFrame');
                return;
            }
        }
    }
    
    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (this.isDragging && this.isDraggingAFrame) {
            e.preventDefault();
            e.stopPropagation();
            
            this.canvas.style.cursor = 'ew-resize';
            
            const graph = this.screenToGraph(e.clientX, e.clientY);
            let newFrame = Math.round(Math.max(this.minX, Math.min(this.maxX, graph.x)));
            
            if (Sit.bFrame !== undefined) {
                newFrame = Math.min(newFrame, Sit.bFrame - 1);
            }
            
            Sit.aFrame = newFrame;
            setRenderOne(true);
        } else if (this.isDragging && this.isDraggingBFrame) {
            e.preventDefault();
            e.stopPropagation();
            
            this.canvas.style.cursor = 'ew-resize';
            
            const graph = this.screenToGraph(e.clientX, e.clientY);
            let newFrame = Math.round(Math.max(this.minX, Math.min(this.maxX, graph.x)));
            
            if (Sit.aFrame !== undefined) {
                newFrame = Math.max(newFrame, Sit.aFrame + 1);
            }
            
            Sit.bFrame = newFrame;
            setRenderOne(true);
        } else if (this.isDragging && this.isDraggingFrame) {
            e.preventDefault();
            e.stopPropagation();
            
            this.canvas.style.cursor = 'ew-resize';
            
            const graph = this.screenToGraph(e.clientX, e.clientY);
            const newFrame = Math.round(Math.max(this.minX, Math.min(this.maxX, graph.x)));
            par.frame = newFrame;
        } else if (this.isDragging && this.isDraggingLine && this.draggedLineIndex !== null) {
            e.preventDefault();
            e.stopPropagation();
            
            this.canvas.style.cursor = 'grabbing';
            
            const deltaGraph = this.screenToGraph(e.clientX, e.clientY);
            const lastGraph = this.screenToGraph(this.lastMouseX, this.lastMouseY);
            const dx = deltaGraph.x - lastGraph.x;
            const dy = deltaGraph.y - lastGraph.y;
            
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            
            const p1 = this.draggedLineIndex;
            const p2 = this.draggedLineIndex + 1;
            
            this.points[p1].x = Math.max(this.minX, Math.min(this.maxX, this.points[p1].x + dx));
            this.points[p1].y = Math.max(this.minY, Math.min(this.maxY, this.points[p1].y + dy));
            this.points[p2].x = Math.max(this.minX, Math.min(this.maxX, this.points[p2].x + dx));
            this.points[p2].y = Math.max(this.minY, Math.min(this.maxY, this.points[p2].y + dy));
            
            for (let i = p1 - 1; i >= 0; i--) {
                if (this.points[i].x >= this.points[i + 1].x - 1) {
                    this.points[i].x = this.points[i + 1].x - 1;
                }
            }
            
            for (let i = p2 + 1; i < this.points.length; i++) {
                if (this.points[i].x <= this.points[i - 1].x + 1) {
                    this.points[i].x = this.points[i - 1].x + 1;
                }
            }
            
            if (this.onChange) {
                this.onChange();
            }
        } else if (this.isDragging && this.draggedPointIndex !== null) {
            e.preventDefault();
            e.stopPropagation();
            
            this.canvas.style.cursor = 'grabbing';
            
            const graph = this.screenToGraph(e.clientX, e.clientY);
            const newX = Math.max(this.minX, Math.min(this.maxX, graph.x));
            const newY = Math.max(this.minY, Math.min(this.maxY, graph.y));
            
            this.points[this.draggedPointIndex].x = newX;
            this.points[this.draggedPointIndex].y = newY;
            
            for (let i = this.draggedPointIndex - 1; i >= 0; i--) {
                if (this.points[i].x >= this.points[i + 1].x - 1) {
                    this.points[i].x = this.points[i + 1].x - 1;
                }
            }
            
            for (let i = this.draggedPointIndex + 1; i < this.points.length; i++) {
                if (this.points[i].x <= this.points[i - 1].x + 1) {
                    this.points[i].x = this.points[i - 1].x + 1;
                }
            }
            
            if (this.onChange) {
                this.onChange();
            }
        } else {
            this.updateCursor(x, y);
        }
    }
    
    onMouseUp(e) {
        if (this.isDragging) {
            e.preventDefault();
            e.stopPropagation();
            
            if (!this.isDraggingFrame && !this.isDraggingAFrame && !this.isDraggingBFrame && this.stateBeforeDrag && UndoManager) {
                const stateAfter = this.captureState();
                
                const hasChanged = JSON.stringify(this.stateBeforeDrag) !== JSON.stringify(stateAfter);
                
                if (hasChanged) {
                    const stateBefore = this.stateBeforeDrag;
                    UndoManager.add({
                        undo: () => {
                            this.restoreState(stateBefore);
                        },
                        redo: () => {
                            this.restoreState(stateAfter);
                        },
                        description: "Edit curve points"
                    });
                }
            }
            
            this.stateBeforeDrag = null;
            
            document.removeEventListener('pointermove', this.documentMoveHandler);
            document.removeEventListener('pointerup', this.documentUpHandler);
        }
        
        this.isDragging = false;
        this.draggedPointIndex = null;
        this.draggedLineIndex = null;
        this.isDraggingLine = false;
        this.isDraggingFrame = false;
        this.isDraggingAFrame = false;
        this.isDraggingBFrame = false;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.updateCursor(x, y);
    }
    
    interpolateValue(frame, points) {
        if (points.length === 0) return 0;
        if (points.length === 1) return points[0].y;
        
        if (frame < points[0].x) {
            const dx = points[1].x - points[0].x;
            const dy = points[1].y - points[0].y;
            const slope = dy / dx;
            return points[0].y + slope * (frame - points[0].x);
        }
        
        if (frame > points[points.length - 1].x) {
            const lastIdx = points.length - 1;
            const dx = points[lastIdx].x - points[lastIdx - 1].x;
            const dy = points[lastIdx].y - points[lastIdx - 1].y;
            const slope = dy / dx;
            return points[lastIdx].y + slope * (frame - points[lastIdx].x);
        }
        
        for (let i = 0; i < points.length - 1; i++) {
            if (frame >= points[i].x && frame <= points[i + 1].x) {
                const t = (frame - points[i].x) / (points[i + 1].x - points[i].x);
                return points[i].y + t * (points[i + 1].y - points[i].y);
            }
        }
        
        return points[points.length - 1].y;
    }
    
    calculateStep(range, availablePixels) {
        const targetTicks = 8;
        const roughStep = range / targetTicks;
        
        if (roughStep <= 0) return 1;
        
        const power = Math.floor(Math.log10(roughStep));
        const normalized = roughStep / Math.pow(10, power);
        
        let niceStep;
        if (normalized < 1.5) {
            niceStep = 1;
        } else if (normalized < 3.5) {
            niceStep = 2;
        } else if (normalized < 7.5) {
            niceStep = 5;
        } else {
            niceStep = 10;
        }
        
        return niceStep * Math.pow(10, power);
    }
    
    renderCanvas(frame) {
        super.renderCanvas(frame);
        
        if (!this.visible) return;
        
        const ctx = this.ctx;
        const margin = 60;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const graphWidth = width - margin * 2;
        const graphHeight = height - margin * 2;
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        
        ctx.strokeStyle = '#444';
        ctx.fillStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.font = '12px sans-serif';
        
        ctx.beginPath();
        ctx.rect(margin, margin, graphWidth, graphHeight);
        ctx.stroke();
        
        const xRange = this.maxX - this.minX;
        const yRange = this.maxY - this.minY;
        const dynamicXStep = this.calculateStep(xRange, graphWidth);
        const dynamicYStep = this.calculateStep(yRange, graphHeight);
        
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        for (let x = Math.ceil(this.minX / dynamicXStep) * dynamicXStep; x <= this.maxX; x += dynamicXStep) {
            const screen = this.graphToScreen(x, this.minY);
            ctx.beginPath();
            ctx.moveTo(screen.x, margin);
            ctx.lineTo(screen.x, margin + graphHeight);
            ctx.stroke();
            
            ctx.fillText(x.toString(), screen.x - 10, margin + graphHeight + 20);
        }
        
        ctx.textAlign = 'right';
        for (let y = Math.ceil(this.minY / dynamicYStep) * dynamicYStep; y <= this.maxY; y += dynamicYStep) {
            const screen = this.graphToScreen(this.minX, y);
            ctx.beginPath();
            ctx.moveTo(margin, screen.y);
            ctx.lineTo(margin + graphWidth, screen.y);
            ctx.stroke();
            
            ctx.fillText(y.toString(), margin - 5, screen.y + 5);
        }
        ctx.textAlign = 'left';
        
        ctx.fillStyle = '#fff';
        ctx.font = '14px sans-serif';
        ctx.fillText(this.xLabel, width / 2 - 20, height - 10);
        
        ctx.save();
        ctx.translate(15, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(this.yLabel, 0, 0);
        ctx.restore();
        
        if (this.points.length > 1) {
            const firstX = this.points[0].x;
            const lastX = this.points[this.points.length - 1].x;
            const step = (this.maxX - this.minX) / graphWidth;
            
            if (this.minX < firstX) {
                ctx.strokeStyle = 'rgba(74, 170, 255, 0.5)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                let started = false;
                for (let x = this.minX; x <= firstX; x += step) {
                    const y = this.interpolateValue(x, this.points);
                    const screen = this.graphToScreen(x, y);
                    if (!started) {
                        ctx.moveTo(screen.x, screen.y);
                        started = true;
                    } else {
                        ctx.lineTo(screen.x, screen.y);
                    }
                }
                const screen = this.graphToScreen(firstX, this.points[0].y);
                ctx.lineTo(screen.x, screen.y);
                ctx.stroke();
            }
            
            ctx.strokeStyle = '#4af';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < this.points.length; i++) {
                const screen = this.graphToScreen(this.points[i].x, this.points[i].y);
                if (i === 0) {
                    ctx.moveTo(screen.x, screen.y);
                } else {
                    ctx.lineTo(screen.x, screen.y);
                }
            }
            ctx.stroke();
            
            if (this.maxX > lastX) {
                ctx.strokeStyle = 'rgba(74, 170, 255, 0.5)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                const startScreen = this.graphToScreen(lastX, this.points[this.points.length - 1].y);
                ctx.moveTo(startScreen.x, startScreen.y);
                for (let x = lastX; x <= this.maxX; x += step) {
                    const y = this.interpolateValue(x, this.points);
                    const screen = this.graphToScreen(x, y);
                    ctx.lineTo(screen.x, screen.y);
                }
                ctx.stroke();
            }
        }
        
        ctx.fillStyle = '#4af';
        for (let i = 0; i < this.points.length; i++) {
            const screen = this.graphToScreen(this.points[i].x, this.points[i].y);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        if (Sit.aFrame !== undefined && Sit.aFrame >= this.minX && Sit.aFrame <= this.maxX) {
            const frameScreen = this.graphToScreen(Sit.aFrame, this.minY);
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(frameScreen.x, margin);
            ctx.lineTo(frameScreen.x, height - margin);
            ctx.stroke();
        }
        
        if (Sit.bFrame !== undefined && Sit.bFrame >= this.minX && Sit.bFrame <= this.maxX) {
            const frameScreen = this.graphToScreen(Sit.bFrame, this.minY);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(frameScreen.x, margin);
            ctx.lineTo(frameScreen.x, height - margin);
            ctx.stroke();
        }
        
        if (par.frame >= this.minX && par.frame <= this.maxX) {
            const frameScreen = this.graphToScreen(par.frame, this.minY);
            ctx.strokeStyle = '#ff0';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(frameScreen.x, margin);
            ctx.lineTo(frameScreen.x, height - margin);
            ctx.stroke();
        }
    }
    
    getPoints() {
        return this.points;
    }
    
    setPoints(points) {
        this.points = points;
    }
}

export class CNodeCurveEditor2 extends CNodeTrack {
    constructor(v) {
        super(v);
        
        const config = v.editorConfig;
        
        this.useSitFrames = false;
        if (config.maxX === "Sit.frames") {
            this.useSitFrames = true;
            config.maxX = Sit.frames;
        }
        
        const viewId = v.id + "View";
        this.editorView = new CNodeCurveEditorView2({
            ...v,
            id: viewId,
            editorConfig: config
        });
        
        this.editorView.onChange = () => this.onPointsChanged();
        
        this.frames = v.frames ?? Sit.frames;
        if (this.frames === -1) {
            this.frames = Sit.frames;
        }
        
        this.array = new Array(this.frames);
        this.recalculate();
    }
    
    onPointsChanged() {
        this.recalculate();
        this.recalculateCascade();
    }
    
    recalculate() {
        super.recalculate();
        
        const points = this.editorView.getPoints();
        
        for (let f = 0; f < this.frames; f++) {
            this.array[f] = this.interpolateValue(f, points);
        }
    }
    
    interpolateValue(frame, points) {
        if (points.length === 0) return 0;
        if (points.length === 1) return points[0].y;
        
        if (frame < points[0].x) {
            const dx = points[1].x - points[0].x;
            const dy = points[1].y - points[0].y;
            const slope = dy / dx;
            return points[0].y + slope * (frame - points[0].x);
        }
        
        if (frame > points[points.length - 1].x) {
            const lastIdx = points.length - 1;
            const dx = points[lastIdx].x - points[lastIdx - 1].x;
            const dy = points[lastIdx].y - points[lastIdx - 1].y;
            const slope = dy / dx;
            return points[lastIdx].y + slope * (frame - points[lastIdx].x);
        }
        
        for (let i = 0; i < points.length - 1; i++) {
            if (frame >= points[i].x && frame <= points[i + 1].x) {
                const t = (frame - points[i].x) / (points[i + 1].x - points[i].x);
                return points[i].y + t * (points[i + 1].y - points[i].y);
            }
        }
        
        return points[points.length - 1].y;
    }
    
    update(f) {
        super.update(f);
        
        if (this.useSitFrames) {
            if (Sit.frames !== this.frames) {
                this.frames = Sit.frames;
                this.array = new Array(this.frames);
                this.recalculate();
            }
            if (Sit.frames !== this.editorView.maxX) {
                this.editorView.maxX = Sit.frames;
            }
        }
    }
    
    show(visible) {
        super.show(visible);
        if (this.editorView) {
            this.editorView.show(visible);
        }
    }
    
    modSerialize() {
        const points = this.editorView.getPoints();
        const flatPoints = [];
        for (let i = 0; i < points.length; i++) {
            flatPoints.push(points[i].x, points[i].y);
        }
        
        return {
            ...super.modSerialize(),
            points: flatPoints,
        };
    }
    
    modDeserialize(v) {
        super.modDeserialize(v);
        
        if (v.points) {
            const points = [];
            for (let i = 0; i < v.points.length; i += 2) {
                points.push({x: v.points[i], y: v.points[i + 1]});
            }
            this.editorView.setPoints(points);
            this.recalculate();
        }
    }
    
    getValueFrame(f) {
        return this.array[Math.floor(f)];
    }
}
