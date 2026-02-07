import {CNodeViewUI} from "./CNodeViewUI";
import {GlobalDateTimeNode, Sit} from "../Globals";
import {par} from "../par";

export class CNodeVideoInfoUI extends CNodeViewUI {

    constructor(v) {
        super(v);

        this.doubleClickFullScreen = false;

        this.showInfo = v.showInfo ?? false;
        this.showFrameCounter = v.showFrameCounter ?? false;
        this.showTimecode = v.showTimecode ?? false;
        this.showTimestamp = v.showTimestamp ?? false;
        this.showDateLocal = v.showDateLocal ?? false;
        this.showTimeLocal = v.showTimeLocal ?? false;
        this.showDateTimeLocal = v.showDateTimeLocal ?? false;
        this.showDateUTC = v.showDateUTC ?? false;
        this.showTimeUTC = v.showTimeUTC ?? false;
        this.showDateTimeUTC = v.showDateTimeUTC ?? false;
        this.fontSize = v.fontSize ?? 30;

        this.frameCounterX = v.frameCounterX ?? 50;
        this.frameCounterY = v.frameCounterY ?? 8;
        this.timecodeX = v.timecodeX ?? 50;
        this.timecodeY = v.timecodeY ?? 8;
        this.timestampX = v.timestampX ?? 50;
        this.timestampY = v.timestampY ?? 8;
        this.dateLocalX = v.dateLocalX ?? 50;
        this.dateLocalY = v.dateLocalY ?? 8;
        this.timeLocalX = v.timeLocalX ?? 50;
        this.timeLocalY = v.timeLocalY ?? 8;
        this.dateTimeLocalX = v.dateTimeLocalX ?? 50;
        this.dateTimeLocalY = v.dateTimeLocalY ?? 8;
        this.dateUTCX = v.dateUTCX ?? 50;
        this.dateUTCY = v.dateUTCY ?? 8;
        this.timeUTCX = v.timeUTCX ?? 50;
        this.timeUTCY = v.timeUTCY ?? 8;
        this.dateTimeUTCX = v.dateTimeUTCX ?? 50;
        this.dateTimeUTCY = v.dateTimeUTCY ?? 8;

        this.addSimpleSerial("showInfo");
        this.addSimpleSerial("showFrameCounter");
        this.addSimpleSerial("showTimecode");
        this.addSimpleSerial("showTimestamp");
        this.addSimpleSerial("showDateLocal");
        this.addSimpleSerial("showTimeLocal");
        this.addSimpleSerial("showDateTimeLocal");
        this.addSimpleSerial("showDateUTC");
        this.addSimpleSerial("showTimeUTC");
        this.addSimpleSerial("showDateTimeUTC");
        this.addSimpleSerial("fontSize");
        this.addSimpleSerial("frameCounterX");
        this.addSimpleSerial("frameCounterY");
        this.addSimpleSerial("timecodeX");
        this.addSimpleSerial("timecodeY");
        this.addSimpleSerial("timestampX");
        this.addSimpleSerial("timestampY");
        this.addSimpleSerial("dateLocalX");
        this.addSimpleSerial("dateLocalY");
        this.addSimpleSerial("timeLocalX");
        this.addSimpleSerial("timeLocalY");
        this.addSimpleSerial("dateTimeLocalX");
        this.addSimpleSerial("dateTimeLocalY");
        this.addSimpleSerial("dateUTCX");
        this.addSimpleSerial("dateUTCY");
        this.addSimpleSerial("timeUTCX");
        this.addSimpleSerial("timeUTCY");
        this.addSimpleSerial("dateTimeUTCX");
        this.addSimpleSerial("dateTimeUTCY");

        this.canvas.style.pointerEvents = 'none';

        this.dragging = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        this.boundHandleMouseDown = (e) => this.handleMouseDown(e);
        this.boundHandleMouseMove = (e) => this.handleMouseMove(e);
        this.boundHandleMouseUp = (e) => this.handleMouseUp(e);

        document.addEventListener('mousemove', this.boundHandleMouseMove);
        document.addEventListener('mouseup', this.boundHandleMouseUp);
        this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);

        this.show(this.showInfo);
    }

    getElementBounds() {
        const bounds = [];
        const padding = 6;

        const addBbox = (id, show, bbox) => {
            if (show && bbox) {
                bounds.push({
                    id,
                    x: bbox.x - padding,
                    y: bbox.y - padding,
                    w: bbox.w + padding * 2,
                    h: bbox.h + padding * 2
                });
            }
        };

        addBbox('frameCounter', this.showFrameCounter, this._frameCounterBbox);
        addBbox('timecode', this.showTimecode, this._timecodeBbox);
        addBbox('timestamp', this.showTimestamp, this._timestampBbox);
        addBbox('dateLocal', this.showDateLocal, this._dateLocalBbox);
        addBbox('timeLocal', this.showTimeLocal, this._timeLocalBbox);
        addBbox('dateTimeLocal', this.showDateTimeLocal, this._dateTimeLocalBbox);
        addBbox('dateUTC', this.showDateUTC, this._dateUTCBbox);
        addBbox('timeUTC', this.showTimeUTC, this._timeUTCBbox);
        addBbox('dateTimeUTC', this.showDateTimeUTC, this._dateTimeUTCBbox);

        return bounds;
    }

    getElementAtPosition(x, y) {
        const bounds = this.getElementBounds();
        for (const b of bounds) {
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                return b.id;
            }
        }
        return null;
    }

    getElementPos(id) {
        const map = {
            frameCounter: ['frameCounterX', 'frameCounterY'],
            timecode: ['timecodeX', 'timecodeY'],
            timestamp: ['timestampX', 'timestampY'],
            dateLocal: ['dateLocalX', 'dateLocalY'],
            timeLocal: ['timeLocalX', 'timeLocalY'],
            dateTimeLocal: ['dateTimeLocalX', 'dateTimeLocalY'],
            dateUTC: ['dateUTCX', 'dateUTCY'],
            timeUTC: ['timeUTCX', 'timeUTCY'],
            dateTimeUTC: ['dateTimeUTCX', 'dateTimeUTCY'],
        };
        return map[id];
    }

    handleMouseDown(e) {
        if (!this.showInfo) return;

        const canvasRect = this.canvas.getBoundingClientRect();
        const x = e.clientX - canvasRect.left;
        const y = e.clientY - canvasRect.top;

        const element = this.getElementAtPosition(x, y);
        if (element) {
            this.dragging = element;
            const videoRect = this.getVideoRect();
            const pos = this.getElementPos(element);
            if (pos) {
                this.dragOffsetX = x - this.videoPx(this[pos[0]], videoRect);
                this.dragOffsetY = y - this.videoPy(this[pos[1]], videoRect);
            }
            this.canvas.style.pointerEvents = 'auto';
            e.stopPropagation();
            e.preventDefault();
        }
    }

    handleMouseMove(e) {
        const canvasRect = this.canvas.getBoundingClientRect();
        const x = e.clientX - canvasRect.left;
        const y = e.clientY - canvasRect.top;

        if (this.dragging) {
            const videoRect = this.getVideoRect();
            const newPctX = ((x - this.dragOffsetX - videoRect.x) / videoRect.w) * 100;
            const newPctY = ((y - this.dragOffsetY - videoRect.y) / videoRect.h) * 100;

            const clampedX = Math.max(5, Math.min(95, newPctX));
            const clampedY = Math.max(5, Math.min(95, newPctY));

            const pos = this.getElementPos(this.dragging);
            if (pos) {
                this[pos[0]] = clampedX;
                this[pos[1]] = clampedY;
            }
            return;
        }

        if (x >= 0 && x <= canvasRect.width && y >= 0 && y <= canvasRect.height) {
            const element = this.getElementAtPosition(x, y);
            if (element && this.showInfo) {
                this.canvas.style.pointerEvents = 'auto';
                this.canvas.style.cursor = 'move';
            } else {
                this.canvas.style.pointerEvents = 'none';
                this.canvas.style.cursor = '';
            }
        } else {
            this.canvas.style.pointerEvents = 'none';
            this.canvas.style.cursor = '';
        }
    }

    handleMouseUp(e) {
        if (this.dragging) {
            this.dragging = null;
            this.canvas.style.pointerEvents = 'none';
        }
    }

    formatTimecode(frame, fps, showHours) {
        const totalSeconds = frame / fps;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const frames = Math.floor(frame % fps);

        const mm = String(minutes).padStart(2, '0');
        const ss = String(seconds).padStart(2, '0');
        const ff = String(frames).padStart(2, '0');

        if (showHours) {
            const hh = String(hours).padStart(2, '0');
            return `${hh}:${mm}:${ss}:${ff}`;
        }
        return `${mm}:${ss}:${ff}`;
    }

    formatTimestamp(frame, fps, showHours) {
        const totalSeconds = frame / fps;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const mm = String(minutes).padStart(2, '0');
        const ssDecimal = seconds.toFixed(2).padStart(5, '0');

        if (showHours) {
            const hh = String(hours).padStart(2, '0');
            return `${hh}:${mm}:${ssDecimal}`;
        }
        return `${mm}:${ssDecimal}`;
    }

    getVideoRect() {
        let vx = 0, vy = 0, vw = this.widthPx, vh = this.heightPx;
        const videoView = this.in.relativeTo;
        if (videoView && videoView.getSourceAndDestCoords) {
            videoView.getSourceAndDestCoords();
            vx = videoView.dx;
            vy = videoView.dy;
            vw = videoView.dWidth;
            vh = videoView.dHeight;
        }
        return { x: vx, y: vy, w: vw, h: vh };
    }

    videoPx(pct, rect) {
        return rect.x + (pct / 100) * rect.w;
    }

    videoPy(pct, rect) {
        return rect.y + (pct / 100) * rect.h;
    }

    renderCanvas(frame) {
        if (this.overlayView && !this.overlayView.visible) return;
        if (this.in.relativeTo && !this.in.relativeTo.visible) return;
        if (!this.showInfo) return;

        super.renderCanvas(frame);

        const c = this.ctx;
        const fps = Sit.fps || 30;
        const totalSeconds = (Sit.frames || 1) / fps;
        const showHours = totalSeconds >= 3600;

        const rect = this.getVideoRect();
        const referenceHeight = 1080;
        const scaledFontSize = Math.round(this.fontSize * rect.h / referenceHeight);
        c.font = `${scaledFontSize}px monospace`;
        c.textAlign = 'center';
        c.textBaseline = 'top';

        const padding = Math.round(6 * rect.h / referenceHeight);

        if (this.showFrameCounter) {
            const text = `${Math.floor(par.frame)}`;
            const x = this.videoPx(this.frameCounterX, rect);
            const y = this.videoPy(this.frameCounterY, rect);
            const metrics = c.measureText(text);
            const textHeight = scaledFontSize;
            const bgX = x - metrics.width / 2 - padding;
            const bgY = y - padding;
            const bgW = metrics.width + padding * 2;
            const bgH = textHeight + padding * 2;

            c.fillStyle = 'rgba(0, 0, 0, 0.5)';
            c.fillRect(bgX, bgY, bgW, bgH);
            c.fillStyle = '#FFFFFF';
            c.fillText(text, x, y);

            this._frameCounterBbox = { x: bgX, y: bgY, w: bgW, h: bgH };
        }

        if (this.showTimecode) {
            const text = this.formatTimecode(par.frame, fps, showHours);
            const x = this.videoPx(this.timecodeX, rect);
            const y = this.videoPy(this.timecodeY, rect);
            const metrics = c.measureText(text);
            const textHeight = scaledFontSize;
            const bgX = x - metrics.width / 2 - padding;
            const bgY = y - padding;
            const bgW = metrics.width + padding * 2;
            const bgH = textHeight + padding * 2;

            c.fillStyle = 'rgba(0, 0, 0, 0.5)';
            c.fillRect(bgX, bgY, bgW, bgH);
            c.fillStyle = '#FFFFFF';
            c.fillText(text, x, y);

            this._timecodeBbox = { x: bgX, y: bgY, w: bgW, h: bgH };
        }

        if (this.showTimestamp) {
            const text = this.formatTimestamp(par.frame, fps, showHours);
            const x = this.videoPx(this.timestampX, rect);
            const y = this.videoPy(this.timestampY, rect);
            const metrics = c.measureText(text);
            const textHeight = scaledFontSize;
            const bgX = x - metrics.width / 2 - padding;
            const bgY = y - padding;
            const bgW = metrics.width + padding * 2;
            const bgH = textHeight + padding * 2;

            c.fillStyle = 'rgba(0, 0, 0, 0.5)';
            c.fillRect(bgX, bgY, bgW, bgH);
            c.fillStyle = '#FFFFFF';
            c.fillText(text, x, y);

            this._timestampBbox = { x: bgX, y: bgY, w: bgW, h: bgH };
        }

        const nowDate = GlobalDateTimeNode?.dateNow;
        if (nowDate) {
            if (this.showDateLocal) {
                const text = this.formatDateLocal(nowDate);
                this._dateLocalBbox = this.renderInfoElement(c, text, this.dateLocalX, this.dateLocalY, rect, scaledFontSize, padding);
            }

            if (this.showTimeLocal) {
                const text = this.formatTimeLocal(nowDate);
                this._timeLocalBbox = this.renderInfoElement(c, text, this.timeLocalX, this.timeLocalY, rect, scaledFontSize, padding);
            }

            if (this.showDateTimeLocal) {
                const text = this.formatDateTimeLocal(nowDate);
                this._dateTimeLocalBbox = this.renderInfoElement(c, text, this.dateTimeLocalX, this.dateTimeLocalY, rect, scaledFontSize, padding);
            }

            if (this.showDateUTC) {
                const text = this.formatDateUTC(nowDate);
                this._dateUTCBbox = this.renderInfoElement(c, text, this.dateUTCX, this.dateUTCY, rect, scaledFontSize, padding);
            }

            if (this.showTimeUTC) {
                const text = this.formatTimeUTC(nowDate);
                this._timeUTCBbox = this.renderInfoElement(c, text, this.timeUTCX, this.timeUTCY, rect, scaledFontSize, padding);
            }

            if (this.showDateTimeUTC) {
                const text = this.formatDateTimeUTC(nowDate);
                this._dateTimeUTCBbox = this.renderInfoElement(c, text, this.dateTimeUTCX, this.dateTimeUTCY, rect, scaledFontSize, padding);
            }
        }
    }

    renderInfoElement(c, text, pctX, pctY, rect, fontSize, padding) {
        const x = this.videoPx(pctX, rect);
        const y = this.videoPy(pctY, rect);
        const metrics = c.measureText(text);
        const bgX = x - metrics.width / 2 - padding;
        const bgY = y - padding;
        const bgW = metrics.width + padding * 2;
        const bgH = fontSize + padding * 2;

        c.fillStyle = 'rgba(0, 0, 0, 0.5)';
        c.fillRect(bgX, bgY, bgW, bgH);
        c.fillStyle = '#FFFFFF';
        c.fillText(text, x, y);

        return { x: bgX, y: bgY, w: bgW, h: bgH };
    }

    getLocalDate(date) {
        const offsetHours = GlobalDateTimeNode?.getTimeZoneOffset() || 0;
        const offsetMs = offsetHours * 60 * 60 * 1000;
        const localOffset = date.getTimezoneOffset() * 60000;
        const utc = date.getTime() + localOffset;
        return new Date(utc + offsetMs);
    }

    formatDateLocal(date) {
        const d = this.getLocalDate(date);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    formatTimeLocal(date) {
        const d = this.getLocalDate(date);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    formatDateTimeLocal(date) {
        const tzName = GlobalDateTimeNode?.getTimeZoneName() || '';
        return `${this.formatDateLocal(date)} ${this.formatTimeLocal(date)} ${tzName}`;
    }

    formatDateUTC(date) {
        const pad = n => String(n).padStart(2, '0');
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    }

    formatTimeUTC(date) {
        const pad = n => String(n).padStart(2, '0');
        return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
    }

    formatDateTimeUTC(date) {
        return `${this.formatDateUTC(date)} ${this.formatTimeUTC(date)} UTC`;
    }

    dispose() {
        if (this.boundHandleMouseMove) {
            document.removeEventListener('mousemove', this.boundHandleMouseMove);
        }
        if (this.boundHandleMouseUp) {
            document.removeEventListener('mouseup', this.boundHandleMouseUp);
        }
        if (this.canvas && this.boundHandleMouseDown) {
            this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
        }
        super.dispose();
    }
}
