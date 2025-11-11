import {CNodeTrack} from "./CNodeTrack";
import {CNodeViewCanvas2D} from "./CNodeViewCanvas";
import {Sit} from "../Globals";

export class CNodeCurveEditorView2 extends CNodeViewCanvas2D {
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
        this.isDragging = false;
        
        this.setupMouseHandlers();
    }
    
    setupMouseHandlers() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
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
    
    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.draggedPointIndex = this.findPointAt(x, y);
        if (this.draggedPointIndex !== null) {
            this.isDragging = true;
        }
    }
    
    onMouseMove(e) {
        if (this.isDragging && this.draggedPointIndex !== null) {
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
        }
    }
    
    onMouseUp(e) {
        this.isDragging = false;
        this.draggedPointIndex = null;
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
