// loading and storing video frames
import {CNodeViewCanvas2D} from "./CNodeViewCanvas";
import {par} from "../par";
import {quickToggle} from "../KeyBoardHandler";
import {CNodeGUIFlag, CNodeGUIValue} from "./CNodeGUIValue";
import {CNodeConstant} from "./CNode";
import {guiTweaks, NodeMan, setRenderOne, Sit} from "../Globals";
import {CMouseHandler} from "../CMouseHandler";
import {CNodeViewUI} from "./CNodeViewUI";
import {CVideoMp4Data} from "../CVideoMp4Data";
import {CVideoImageData} from "../CVideoImageData";
import {assert} from "../assert";
import {EventManager} from "../CEventManager";


export class CNodeVideoView extends CNodeViewCanvas2D {
    constructor(v) {
        super(v);
        // this.canvas.addEventListener( 'wheel', e => this.handleMouseWheel(e) );

        // these no longer work with the new rendering pipeline
        // TODO: reimplement them as effects?
         this.optionalInputs(["brightness", "contrast", "blur", "greyscale", "hue", "invert", "saturate", "enableVideoEffects", "convolutionFilter"])
        //

        //  if (this.overlayView === undefined)
             addFiltersToVideoNode(this)

        this.positioned = false;
        this.autoFill = v.autoFill ?? true; // default to autofill
        this.shiftDrag = true;

        this.scrubFrame = 0; // storing fractiona accumulation of frames while scrubbing

        this.autoClear = (v.autoClear !== undefined)? v.autoClear : false;

        this.input("zoom", true); // zoom input is optional

        this.videoSpeed = v.videoSpeed ?? 1; // default to 1x speed

        this.setupMouseHandler();

        // if it's an overlay view then we don't need to add the overlay UI view
        if (!v.overlayView) {
            // Add an overlay view to show status (mostly errors)
            this.overlay = new CNodeViewUI({id: this.id+"_videoOverlay", overlayView: this})
            this.overlay.ignoreMouseEvents();
        }

        v.id = v.id + "_data"

        if (v.file !== undefined) {
            this.newVideo(v.file, false); // don't clear Sit.frames as legacy code sets it when passing in a video filename this way
        }


    }

    get videoWidth() {
        return this.videoData?.videoWidth || 0;
    }

    get videoHeight() {
        return this.videoData?.videoHeight || 0;
    }

    newVideo(fileName, clearFrames = true) {
        if (clearFrames) {
            Sit.frames = undefined; // need to recalculate this
        }
        this.fileName = fileName;
        this.disposeVideoData()
        this.videoData = new CVideoMp4Data({id: this.id + "_data", file: fileName, videoSpeed: this.videoSpeed},
            this.loadedCallback.bind(this), this.errorCallback.bind(this))

        // loaded from a URL, so we can set the staticURL
        this.staticURL = this.fileName;

        this.positioned = false;
        par.frame = 0;
        par.paused = false; // unpause, otherwise we see nothing.
        this.addLoadingMessage()
        this.addDownloadButton()


    }

    addLoadingMessage() {
        if (this.overlay)
            this.overlay.addText("videoLoading", "LOADING", 50, 50, 5, "#f0f000")
    }


    removeText() {
        if (this.overlay) {
            this.overlay.removeText("videoLoading")
            this.overlay.removeText("videoError")
            this.overlay.removeText("videoErrorName")
            this.overlay.removeText("videoNo")
        }
    }


    stopStreaming() {
        this.removeText()
        par.frame = 0
        par.paused = false;
        if (this.videoData) {
            this.videoData.stopStreaming()
        }
        this.positioned = false;
    }



    loadedCallback(videoData) {
        this.removeText();


        // in the case where the videoData is immediately set up ina  constructor,
        // allow video data derived constructors to pass in "this" so we can get the width and height
        // Speicifically this handles the case where a "video" is a single image.
        if (videoData === undefined)
            videoData = this.videoData;

        assert (videoData, "CNodeVideoView loadedCallback called with no videoData, possibly because it's called in the constructor before the this.videoData is assigned");

        console.log("🍿🍿🍿Video loaded, width=" + this.videoWidth + ", height=" + this.videoHeight);

        // if we loaded from a mod or custom
        // then we might want to set the frame nubmer
        if (Sit.pars !== undefined && Sit.pars.frame !== undefined) {
            par.frame = Sit.pars.frame;
        }


    }

    errorCallback() {
        this.videoData.error = false;
        if (this.overlay) {
            this.overlay.removeText("videoLoading")
            this.overlay.addText("videoError", "Error Loading", 50, 45, 5, "#f0f000", "center")
            this.overlay.addText("videoErrorName", this.fileName, 50, 55, 1.5, "#f0f000", "center")
        }
    }

    onMouseWheel(e) {

        if (this.overlayView !== undefined) {
            // if this is an overlay view, then we don't want to zoom
            // as the overlay view is not zoomable
            // so we just pass the event to the overlaid view
            if (this.overlayView.onMouseWheel !== undefined) {
                this.overlayView.onMouseWheel(e);
            }
            return;
        }

        var scale = 0.90;  // zoom in/out by 10% on mouse wheel up/down
        if (e.deltaY < 0) {
            scale = 1 / scale
        }

        const videoZoom = NodeMan.get("videoZoom", false);
        if (videoZoom !== undefined) {
            let v = videoZoom.value;
            v *= scale;
            videoZoom.setValue(v);
        }
    }


    setupMouseHandler() {
        this.mouse = new CMouseHandler(this, {

            wheel: (e) => {

//                console.log(e.deltaY)
                var scale = 0.90;
                if (e.deltaY > 0) {
//                    this.in.zoom.value *= 0.6666
                } else {
//                    this.in.zoom.value *= 1 / 0.6666
                    scale = 1 / scale
                }

                this.zoomView(scale)

            },

            drag: (e) => {
                const moveX = this.mouse.dx / this.widthPx; // px = mouse move as a fraction of the screen width
                const moveY = this.mouse.dy / this.widthPx
                this.posLeft += moveX
                this.posRight += moveX
                this.posTop += moveY
                this.posBot += moveY

            },


            rightDrag: (e) => {
                this.scrubFrame += this.mouse.dx / 4
                if (this.scrubFrame >= 1.0 || this.scrubFrame <= -1.0) {
                    const whole = Math.floor(this.scrubFrame)
                    par.frame += whole
                    this.scrubFrame -= whole;
                }

                setRenderOne(true);
            },


            centerDrag: (e) => {
                this.zoomView(100/(100-this.mouse.dx))
            },

            dblClick: (e) => {
                this.defaultPosition();
            },

            contextMenu: (e) => {
                // TODO: Implement actual video view context menu
                alert("Context menu triggered on video view.\nContext menus are not yet fully implemented for video views.");
            }

        })
    }

    toSerializeCNodeVideoView = ["posLeft", "posRight", "posTop", "posBot"]

    modSerialize() {
            return {
                ...super.modSerialize(),
                ...this.simpleSerialize(this.toSerializeCNodeVideoView)

            }
    }

    modDeserialize(v) {
        super.modDeserialize(v)
        this.simpleDeserialize(v, this.toSerializeCNodeVideoView)
        this.positioned = true;
    }

    disposeVideoData() {
        if (this.videoData) {
            this.videoData.stopStreaming()
            this.videoData.dispose();
            this.videoData = null;
        }
        this.staticURL = undefined; // clear the static URL, so we will rehost any dropped file
    }


    makeImageVideo(filename, img, deleteAfterUsing = false) {

        this.fileName = filename;

        this.disposeVideoData()
        this.videoData = new CVideoImageData({
                id: this.id + "_data",
                filename:filename,
                img: img,
                deleteAfterUsing: deleteAfterUsing
            },
            this.loadedCallback.bind(this), this.errorCallback.bind(this))
        this.positioned = false;
        par.frame = 0;
        par.paused = false; // unpause, otherwise we see nothing.
        // this.addLoadingMessage()
        // this.addDownloadButton()
        EventManager.dispatchEvent("videoLoaded", {
            width: img.width, height: img.height,
            videoData: this});
    }

    renderCanvas(frame = 0) {
        super.renderCanvas(frame); // needed for setting window size

        if (!this.visible) return;

        // if no video file, this is just a drop target for now
        if (!this.videoData) return;
        this.videoData.update()
        const image = this.videoData.getImage(frame);
        if (image) {

            const ctx = this.canvas.getContext("2d");

           //  ctx.fillstyle = "#FF00FFFF"
           //  ctx.fillRect(0, 0, this.canvas.width/3, this.canvas.height);

            // video width might change, for example, with the tiny images used by the old Gimbal video
            if (this.videoWidth !== image.width) {
                console.log("🍿🍿🍿Video width changed from " + this.videoWidth + " to " + image.width)
                this.videoData.videoWidth = image.width;
                this.videoData.videoHeight = image.height;
            }

            if (!this.positioned) {
                this.defaultPosition()
            }
            // positions are a PERCENTAGE OF THE WIDTH

            if (quickToggle("Smooth", false, guiTweaks) === false)
                ctx.imageSmoothingEnabled = false;

            var filter = ''
            const effectsEnabled = this.in.enableVideoEffects ? this.in.enableVideoEffects.v0 : true;
            if (effectsEnabled) {
                if (this.in.contrast && this.in.contrast.v0 !== 1){
                    filter += "contrast("+this.in.contrast.v0+") "
                }
                if (this.in.brightness && this.in.brightness.v0 !== 1){
                    filter += "brightness("+this.in.brightness.v0+") "
                }
                if (this.in.blur && this.in.blur.v0 !== 0){
                 filter += "blur("+this.in.blur.v0+"px) "
                }
                if (this.in.greyscale && this.in.greyscale.v0 !== 0){
                    filter += "grayscale("+this.in.greyscale.v0+") "
                }
                if (this.in.hue && this.in.hue.v0 !== 0){
                    filter += "hue-rotate("+this.in.hue.v0+"deg) "
                }
                if (this.in.invert && this.in.invert.v0 !== 0){
                    filter += "invert("+this.in.invert.v0+") "
                }
                if (this.in.saturate && this.in.saturate.v0 !== 1){
                    filter += "saturate("+this.in.saturate.v0+") "
                }
            }

            ctx.filter = filter || 'none';

            const sourceW = this.videoWidth;
            const sourceH = this.videoHeight
            // rendering fill the view in at least one direction
            const aspectSource = sourceW / sourceH
            const aspectView = this.widthPx / this.heightPx


            // TODO - combine this zoom input with the mouse zoom
            if (this.in.zoom != undefined) {

                this.getSourceAndDestCoords();
                ctx.drawImage(image,this.sx, this.sy, this.sWidth, this.sHeight,
                    this.dx, this.dy, this.dWidth, this.dHeight);

            } else {
                // Here the zoom is being controlled by zoomView
                // which zooming in and out around the mouse
                ctx.drawImage(image,
                    0, 0, this.videoWidth, this.videoHeight,
                    this.widthPx*(0.5+this.posLeft), this.heightPx*0.5+this.widthPx*this.posTop,
                    this.widthPx*(this.posRight-this.posLeft), this.widthPx*(this.posBot-this.posTop))
                ctx.imageSmoothingEnabled = true;

            }

            if (effectsEnabled && this.in.convolutionFilter && this.in.convolutionFilter.value !== 'none') {
                const filterType = this.in.convolutionFilter.value;
                const params = {
                    amount: this.in.sharpenAmount?.v0 ?? 1,
                    threshold: this.in.edgeDetectThreshold?.v0 ?? 0,
                    strength: (filterType === 'emboss' ? this.in.embossDepth?.v0 : 1) ?? 1
                };
                applyConvolution(ctx, this.widthPx, this.heightPx, filterType, params);
            }

            ctx.filter = 'none';


        }
    }


    // so we need to account for the mouse position, in this fractional system
    zoomView(scale) {
        var offX = (this.mouse.anchorX - this.widthPx / 2) / this.widthPx;
        var offY = (this.mouse.anchorY - this.heightPx / 2) / this.widthPx;

        this.posLeft -= offX;
        this.posRight -= offX;
        this.posTop -= offY;
        this.posBot -= offY;

        this.posLeft *= scale;
        this.posRight *= scale;
        this.posTop *= scale;
        this.posBot *= scale;

        this.posLeft += offX;
        this.posRight += offX;
        this.posTop += offY;
        this.posBot += offY;

        setRenderOne(true);
    }

    defaultPosition() {
        const sourceW = this.videoWidth;
        const sourceH = this.videoHeight
        // rendering fill the view in at least one direction
        const aspectSource = sourceW / sourceH
        const aspectView = this.widthPx / this.heightPx

        if (aspectSource > aspectView) {
            // fill for width
            this.posLeft = -0.5;
            this.posTop = this.posLeft / aspectSource;
        } else {
            // fill to height
            //this.posTop = -0.5;
            //this.posLeft = -0.5*sourceW/sourceH;

            // we want to distance to the top as a percentage of the width
            this.posTop = -0.5 / aspectView

            this.posLeft = this.posTop * aspectSource;

        }
        this.posRight = -this.posLeft;
        this.posBot = -this.posTop;
        this.positioned = true;
        setRenderOne(true);
    }


    // as per https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage

    getSourceAndDestCoords() {
        assert(this.in.zoom !== undefined, "canvasToVideoCoords requires zoom input to be defined");

        // videoWidth and videoHeight are the original video dimensions
        let sourceW = this.videoWidth;
        let sourceH = this.videoHeight

        if (sourceW <= 0 || sourceH <= 0) {
            // if the sourceW or sourceH is not set, then we can't calculate the coordinates correctly
            // so we just use the canvas size for now
            // when the is loaded, this will be updated
//            showError("CNodeVideoView.getSourceAndDestCoords called with invalid image dimensions, video not loaded? this="+this.id+", sourceW="+sourceW+", sourceH="+sourceH);
            sourceW = this.widthPx;
            sourceH = this.heightPx;
        }


        const aspectSource = sourceW / sourceH

        // the view is the canvas size, widthPx and heightPx
        const aspectView = this.widthPx / this.heightPx

        // magnification factor, it's a percentage, and we convert it to a decimal
        // if 1, then the video will fill the view in the direction of smallest dimension
        const zoom = this.in.zoom.v0 / 100;


        // there offsets are relative to the source image, not the view
        // they will be the virtual start corner of the video
        const offsetW = (sourceW - sourceW / zoom) / 2;
        const offsetH = (sourceH - sourceH / zoom) / 2;

        // as if we are doing
        // ctx.drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)

        this.sx = offsetW;
        this.sy = offsetH;
        this.sWidth = sourceW / zoom;
        this.sHeight = sourceH / zoom;

        //  aspectSource = width/height ratio of the source image or video
        //  aspectView = width/height ratio of the view
        // so bigger numbers (>1) = wider, smaller numbers (<1) = taller

        if (aspectSource > aspectView) {
            // Source video is WIDER than the view, so we scale to fit width
            // leaving black bars on top and bottom
            // (Typical in the Narrow Video view preset)

            // fov coverage is how much of the vertical field of view is covered by the video
            // perhaps easier to visalize as dHeight / heightPx
            this.fovCoverage = (this.widthPx / aspectSource) / this.heightPx;

            // dx,dy is and offset of the top left corner of the video in the view
            this.dx = 0;
            this.dy = (this.heightPx - this.widthPx / aspectSource) / 2;

            // dWidth,dHeight is the size of the video in the view
            this.dWidth = this.widthPx;
            this.dHeight = this.widthPx / aspectSource;
        } else {
            // Source is TALLER than the view, so we scale to fit height
            // and adjust from left

            // entire vertical FOV is covered by the video
            this.fovCoverage = 1;

            this.dx  = (this.widthPx - this.heightPx * aspectSource) / 2;
            this.dy = 0;
            this.dWidth = this.heightPx * aspectSource;
            this.dHeight = this.heightPx;
        }
        assert(!isNaN(this.dWidth) && !isNaN(this.dHeight), "getSourceAndDestCoords returned NaN for dWidth or dHeight, this="+this.id+", zoom="+this.in.zoom.v0);

    }

    /**
     * Convert a canvas x,y point to relative video coordinates vX, vY
     * Returns values that can be outside [0,1]
     */
    canvasToVideoCoords(x, y) {
        this.getSourceAndDestCoords()

        // we have the source and destination coordinates s and d
        // as in // ctx.drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        // so we can calculate the relative video coordinates
        const vX = (x - this.dx) / this.dWidth * this.sWidth + this.sx;
        const vY = (y - this.dy) / this.dHeight * this.sHeight + this.sy;
        // return as video pixels, not canvas pixels
        return [vX, vY];


    }

    // and the inverse, convert video coordinates to canvas coordinates
    videoToCanvasCoords(vX, vY) {
        this.getSourceAndDestCoords()

        // we have the source and destination coordinates s and d
        // as in // ctx.drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        // so we can calculate the relative video coordinates
        const cX = (vX - this.sx) / this.sWidth * this.dWidth + this.dx;
        const cY = (vY - this.sy) / this.sHeight * this.dHeight + this.dy;
        // return as canvas pixels
        return [cX, cY];
    }





}

let guiVideoEffectsFolder = null;

export function addFiltersToVideoNode(videoNode) {

    if (guiVideoEffectsFolder === null) {
        guiVideoEffectsFolder = guiTweaks.addFolder("Video Adjustments").close().perm();
    }

    let brightness, contrast, blur, greyscale, hue, invert, saturate, enableVideoEffects, convolutionFilter;
    let sharpenAmount, edgeDetectThreshold, embossDepth;
    let convolutionFilterDropdown, sharpenAmountControl, edgeDetectThresholdControl, embossDepthControl;

    const filterOptions = {
        convolutionFilterValue: 'none'
    };

    const updateConvolutionControlVisibility = () => {
        const filterType = filterOptions.convolutionFilterValue;
        sharpenAmount?.show(filterType === 'sharpen');
        edgeDetectThreshold?.show(filterType === 'edgeDetect');
        embossDepth?.show(filterType === 'emboss');
    };

    const reset = {
        resetFilters: () => {
            videoNode.inputs.brightness.value = 1;
            videoNode.inputs.contrast.value = 1;
            videoNode.inputs.blur.value = 0;
            videoNode.inputs.greyscale.value = 0;
            videoNode.inputs.hue.value = 0;
            videoNode.inputs.invert.value = 0;
            videoNode.inputs.saturate.value = 1;
            if (videoNode.inputs.enableVideoEffects) {
                videoNode.inputs.enableVideoEffects.value = true;
            }
            filterOptions.convolutionFilterValue = 'none';
            if (videoNode.inputs.sharpenAmount) videoNode.inputs.sharpenAmount.value = 1;
            if (videoNode.inputs.edgeDetectThreshold) videoNode.inputs.edgeDetectThreshold.value = 0;
            if (videoNode.inputs.embossDepth) videoNode.inputs.embossDepth.value = 1;
            updateConvolutionControlVisibility();
            setRenderOne(true);
        }
    }

    if (!NodeMan.exists("videoBrightness")) {
        brightness = new CNodeGUIValue({id: "videoBrightness", value: 1, start: 0, end: 5, step: 0.01, desc: "Brightness"}, guiVideoEffectsFolder),
        contrast =  new CNodeGUIValue({id: "videoContrast", value: 1, start: 0, end: 5, step: 0.01, desc: "Contrast"}, guiVideoEffectsFolder),
        blur = new CNodeGUIValue({id: "videoBlur", value: 0, start: 0, end: 20, step: 1, desc: "Blur Px"}, guiVideoEffectsFolder),
        greyscale = new CNodeGUIValue({id: "videoGreyscale", value: 0, start: 0, end: 1, step: 0.01, desc: "Greyscale"}, guiVideoEffectsFolder),
        hue = new CNodeGUIValue({id: "videoHue", value: 0, start: 0, end: 360, step: 1, desc: "Hue Rotate"}, guiVideoEffectsFolder),
        invert = new CNodeGUIValue({id: "videoInvert", value: 0, start: 0, end: 1, step: 0.01, desc: "Invert"}, guiVideoEffectsFolder),
        saturate = new CNodeGUIValue({id: "videoSaturate", value: 1, start: 0, end: 5, step: 0.01, desc: "Saturate"}, guiVideoEffectsFolder),
        enableVideoEffects = new CNodeGUIFlag({id: "videoEnableEffects", value: true, desc: "Enable Video Effects"}, guiVideoEffectsFolder),
        sharpenAmount = new CNodeGUIValue({id: "videoSharpenAmount", value: 1, start: 0, end: 5, step: 0.1, desc: "Sharpen Amount"}, guiVideoEffectsFolder),
        edgeDetectThreshold = new CNodeGUIValue({id: "videoEdgeDetectThreshold", value: 0, start: 0, end: 255, step: 1, desc: "Edge Threshold"}, guiVideoEffectsFolder),
        embossDepth = new CNodeGUIValue({id: "videoEmbossDepth", value: 1, start: 0, end: 3, step: 0.1, desc: "Emboss Depth"}, guiVideoEffectsFolder),
        convolutionFilter = new CNodeConstant({id: "videoConvolutionFilter", value: 'none'}),
        convolutionFilterDropdown = guiVideoEffectsFolder.add(filterOptions, "convolutionFilterValue", ['none', 'sharpen', 'edgeDetect', 'emboss']).name("Convolution Filter").onChange(value => {
            convolutionFilter.value = value;
            updateConvolutionControlVisibility();
            setRenderOne(true);
        }),
        sharpenAmountControl = sharpenAmount.guiEntry,
        edgeDetectThresholdControl = edgeDetectThreshold.guiEntry,
        embossDepthControl = embossDepth.guiEntry,
        updateConvolutionControlVisibility(),
        guiVideoEffectsFolder.add(reset, "resetFilters").name("Reset Video Adjustments")
    } else {
        brightness = NodeMan.get("videoBrightness");
        contrast = NodeMan.get("videoContrast");
        blur = NodeMan.get("videoBlur");
        greyscale = NodeMan.get("videoGreyscale");
        hue = NodeMan.get("videoHue");
        invert = NodeMan.get("videoInvert");
        saturate = NodeMan.get("videoSaturate");
        enableVideoEffects = NodeMan.get("videoEnableEffects");
        sharpenAmount = NodeMan.get("videoSharpenAmount");
        edgeDetectThreshold = NodeMan.get("videoEdgeDetectThreshold");
        embossDepth = NodeMan.get("videoEmbossDepth");
        convolutionFilter = NodeMan.get("videoConvolutionFilter");
        if (convolutionFilter) {
            filterOptions.convolutionFilterValue = convolutionFilter.value;
        }
        sharpenAmountControl = sharpenAmount?.guiEntry;
        edgeDetectThresholdControl = edgeDetectThreshold?.guiEntry;
        embossDepthControl = embossDepth?.guiEntry;
        updateConvolutionControlVisibility();
    }


    videoNode.addMoreInputs({
        brightness: brightness,
        contrast: contrast,
        blur: blur,
        greyscale: greyscale,
        hue: hue,
        invert: invert,
        saturate: saturate,
        enableVideoEffects: enableVideoEffects,
        convolutionFilter: convolutionFilter,
        sharpenAmount: sharpenAmount,
        edgeDetectThreshold: edgeDetectThreshold,
        embossDepth: embossDepth
    });



}

const CONVOLUTION_KERNELS = {
    none: { kernel: null, divisor: 1, offset: 0 },
    sharpen: { 
        kernel: [
            0, -1,  0,
            -1, 5, -1,
            0, -1,  0
        ], 
        divisor: 1, 
        offset: 0 
    },
    edgeDetect: { 
        kernel: [
            -1, -1, -1,
            -1,  8, -1,
            -1, -1, -1
        ], 
        divisor: 1, 
        offset: 0 
    },
    emboss: { 
        kernel: [
            -2, -1,  0,
            -1,  1,  1,
            0,  1,  2
        ], 
        divisor: 1, 
        offset: 128 
    }
};

export function applyConvolution(ctx, width, height, kernelName, params = {}) {
    if (kernelName === 'none' || !CONVOLUTION_KERNELS[kernelName]) return;
    
    let { kernel, divisor, offset } = CONVOLUTION_KERNELS[kernelName];
    if (!kernel) return;
    
    const amount = params.amount ?? 1;
    const threshold = params.threshold ?? 0;
    const strength = params.strength ?? 1;
    
    if (kernelName === 'sharpen') {
        kernel = [
            0, -1 * amount, 0,
            -1 * amount, 5 * amount, -1 * amount,
            0, -1 * amount, 0
        ];
        divisor = 1;
    } else if (kernelName === 'emboss') {
        const d = strength;
        kernel = [
            -2 * d, -1 * d, 0,
            -1 * d, 1 * d, 1 * d,
            0, 1 * d, 2 * d
        ];
        divisor = 1;
        offset = 128;
    }
    
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const output = new Uint8ClampedArray(data.length);
    
    const w = width;
    const h = height;
    
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            for (let c = 0; c < 4; c++) {
                let sum = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const px = x + kx;
                        const py = y + ky;
                        const idx = (py * w + px) * 4 + c;
                        const kidx = (ky + 1) * 3 + (kx + 1);
                        sum += data[idx] * kernel[kidx];
                    }
                }
                const val = sum / divisor + offset;
                if (kernelName === 'edgeDetect') {
                    output[(y * w + x) * 4 + c] = val > threshold ? 255 : 0;
                } else {
                    output[(y * w + x) * 4 + c] = Math.min(255, Math.max(0, val));
                }
            }
            output[((y * w + x) * 4 + 3)] = data[((y * w + x) * 4 + 3)];
        }
    }
    
    for (let i = 0; i < data.length; i += 4) {
        if (output[i] !== 0 || output[i + 1] !== 0 || output[i + 2] !== 0 || output[i + 3] !== 0) {
            data[i] = output[i];
            data[i + 1] = output[i + 1];
            data[i + 2] = output[i + 2];
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
}