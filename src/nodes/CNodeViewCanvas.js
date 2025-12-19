// simple UI intermediate class that just has a canvas.
// we use this for the CNodeViewUI and the (upcoming) CNodeVideoView
// passing in an "overlayView" parameter will attache
import {CNodeView} from "./CNodeView";
import {guiMenus} from "../Globals";
import {CNodeGUIValue} from "./CNodeGUIValue";


export class CNodeViewCanvas extends CNodeView {
    constructor(v) {
        super(v)

        this.autoFill = v.autoFill;

        this.canvas = document.createElement('canvas')
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = 0 + 'px';
        this.canvas.style.left = 0 + 'px';

        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";

        // this.canvasWidth = v.canvasWidth;
        // this.canvasHeight = v.canvasHeight;

        this.optionalInputs(["canvasWidth", "canvasHeight"])

        if (v.transparency !== undefined) {
            this.transparency = v.transparency;
            this.canvas.style.opacity = this.transparency;
            new CNodeGUIValue({
                id: this.id+"_transparency",
                value: this.transparency, start: 0, end: 1, step: 0.01,
                desc: "Vid Overlay Trans %",
                tip: "If non-zero, then the video will overlay the look view, with this transparency (0-1)\nIf there's no video, it will use a black screen as overlay",
                onChange: (value) => {
                    this.transparency = value;
                    this.canvas.style.opacity = this.transparency;
                }
            }, guiMenus.view)
        }


       // this.adjustSize()

        this.div.appendChild(this.canvas)
    }

    dispose() {
        super.dispose()
        this.div.removeChild(this.canvas)
        this.canvas = null;
    }

    ignoreMouseEvents() {
        this.canvas.style.pointerEvents = 'none';
    }

    adjustSize() {

        let changed = false;

        let oldWidth = this.widthPx;
        let oldHeight = this.heightPx;

        let width, height;
        if (this.in.canvasWidth) {
            width = this.in.canvasWidth.v0;
        } else {
            width = this.div.clientWidth;
        }



        if (width !== oldWidth) {
            this.widthPx = width;
            changed = true;
        }

        if (this.in.canvasHeight) {
            height = this.in.canvasHeight.v0;
        } else {
            height = this.div.clientHeight;
        }

        if (height !== oldHeight) {
            this.heightPx = height;
            changed = true;
        }




        // just keep the canvas the same size as its div
        // unless we specify canvas with and height
        // if (this.canvas.width !== this.div.clientWidth || this.canvas.height !== this.div.clientHeight || this.autoClear) {
        //     this.canvas.width = this.div.clientWidth
        //     this.canvas.height = this.div.clientHeight

        if (changed) {

            if (this.renderer) {
                this.renderer.setSize(this.heightPx, this.widthPx, false)
            }

            // Scale canvas backing store by devicePixelRatio for high DPI displays
            // Logical dimensions (widthPx, heightPx) stay the same for coordinate calculations
            // Physical canvas size is scaled for better resolution
            if (this.canvas) {
                this.canvas.width = this.widthPx * this.devicePixelRatio;
                this.canvas.height = this.heightPx * this.devicePixelRatio;
                // Scale the 2D context so drawing commands work with logical coordinates
                // Setting canvas.width/height automatically resets the transform
                if (this.ctx) {
                    this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
                    this._contextScaled = true;
                }
            }

            // shoudl not be neede
            //this.canvas.style.width = "100%";
            //this.canvas.style.height = "100%";

            // this.canvas.style.width =  ((this.div.clientWidth/width)*100)+'%'; // Stretch to fill the parent div
            // this.canvas.style.height =  ((this.div.clientHeight/height)*100)+'%'; // Stretch to fill the parent div

            // console.log("this.div.clientWidth,Height", this.div.clientWidth +","+this.div.clientHeight)
            console.log("Canvas resized to ", width, height, this.canvas.style.width, this.canvas.style.height + "from " + oldWidth + "," + oldHeight);

            // bit of a patch to redraw the editor/graph, as resizing clears
            if (this.editor) {
                // this is just resizing, so don't need to recalculate, just redraw.
                this.editor.dirty = true;
            }
        } else {
            if (this.autoClear) {
                // not clearing it by changing the size, so clear it here
                // Use logical coordinates (widthPx, heightPx) since context is scaled by devicePixelRatio
                this.ctx.clearRect(0, 0, this.widthPx, this.heightPx);
            }
            // Context scaling is still valid if size hasn't changed
            this._contextScaled = true;
        }
    }

}

class CNodeViewCanvas2D extends CNodeViewCanvas {
    constructor(v) {
        super(v)

        this.ctx = this.canvas.getContext('2d')
        this.ctx.font = '36px serif'
        this.ctx.fillStyle = '#FF00FF'
        this.ctx.strokeStyle = '#FF00FF'

        // this.canvas.style.backgroundColor = 'transparent';
        // this.ctx.globalAlpha = 0.5;

        this.autoClear = v.autoClear;
        this.autoFill = v.autoFill;
        this.autoFillColor = v.autoFillColor;

        this.devicePixelRatio = window.devicePixelRatio || 1;
        this._lastScaledWidth = 0;
        this._lastScaledHeight = 0;
    }

    // Helper method: ensures canvas dimensions and context scaling match current display requirements
    // This should be called before direct drawing operations when the context needs to be scaled
    // It will only re-scale if canvas dimensions have actually changed
    ensureContextScaled() {
        const requiredWidth = this.widthPx * this.devicePixelRatio;
        const requiredHeight = this.heightPx * this.devicePixelRatio;
        
        if (this.canvas.width !== requiredWidth || this.canvas.height !== requiredHeight) {
            this.canvas.width = requiredWidth;
            this.canvas.height = requiredHeight;
            this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
        }
    }

    dispose() {
        // release the WebGL context
        this.ctx = null

        super.dispose()
    }

    renderCanvas(frame) {
        super.renderCanvas(frame)

        if (this.visible) {
            this.adjustSize()

            // the autoClear will clear it to transparent, so need to
            // fill it with a solid color if we've got an autoFill

            if (this.autoFill) {
                this.ctx.fillStyle = this.autoFillColor ?? "black";
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }

    }
}

export {CNodeViewCanvas2D};
