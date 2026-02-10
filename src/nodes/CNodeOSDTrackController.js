import {CNode} from "./CNode";
import {guiMenus, NodeMan, registerFrameBlocker, setRenderOne, Sit, unregisterFrameBlocker} from "../Globals";
import {par} from "../par";
import {EventManager} from "../CEventManager";
import {CNodeOSDGraphView} from "./CNodeCurveEdit2";

const DEFAULT_X = 50;
const DEFAULT_Y = 20;
const PLACEHOLDER_TEXT = "?????";

/*
 TODO:

- If the frame numberis changed externally, update the editing text to match the new frame's value for the active track, if any.
 the same as if the user had navigated to that frame using the [ and ] keys while editing.

 - Add "Type" field to each track,.
 This will allow for future expansion of different types of OSD tracks,
 like MGRS grid squares, lat/lon coordinates, altitude, etc.
 - Us that to add a dynamic track type that can use user-selected OSDtracks as data sources
  this will allow real-time visualization of the track

- Add export of CSV position tracks, keyframe based, just interpolating where there's a keyframe in one OSD track but not another

- Add impport of CSV frame based data into OSD tracks.

(Mick: make the merged higher qualiting 30 fps version before editing)

(seperately)
 - video zoom to match the way we can video zoom in the video sitch. This will be complex, so keep it separate


 */

class COSDTrack {
    constructor(controller, index) {
        this.controller = controller;
        this.index = index;
        this.name = `OSD Track ${index + 1}`;
        this.show = true;
        this.x = DEFAULT_X;
        this.y = DEFAULT_Y + index * 8;
        this.frameData = {};
        this.editing = false;
        this.guiFolder = null;
    }

    isKeyframe(frame) {
        const val = this.frameData[frame];
        return val !== undefined && val !== PLACEHOLDER_TEXT && val !== "";
    }
    
    getValue(frame) {
        if (this.isKeyframe(frame)) {
            return this.frameData[frame];
        }
        
        let prevFrame = frame - 1;
        while (prevFrame >= 0) {
            if (this.isKeyframe(prevFrame)) {
                return this.frameData[prevFrame];
            }
            prevFrame--;
        }
        
        return PLACEHOLDER_TEXT;
    }
    
    getDisplayInfo(frame) {
        if (this.isKeyframe(frame)) {
            return { value: this.frameData[frame], isKeyframe: true };
        }
        
        let prevFrame = frame - 1;
        while (prevFrame >= 0) {
            if (this.isKeyframe(prevFrame)) {
                return { value: this.frameData[prevFrame], isKeyframe: false };
            }
            prevFrame--;
        }
        
        return { value: PLACEHOLDER_TEXT, isKeyframe: false };
    }

    setValue(frame, value) {
        this.frameData[frame] = value;
        this.controller.updateSliderStatus();
    }

    hasValue(frame) {
        return this.isKeyframe(frame);
    }
    
    getKeyframeStatusArray() {
        const status = new Array(Sit.frames).fill(0);
        for (let frame = 0; frame < Sit.frames; frame++) {
            if (this.isKeyframe(frame)) {
                status[frame] = 1;
            }
        }
        return status;
    }

    serialize() {
        return {
            name: this.name,
            show: this.show,
            x: this.x,
            y: this.y,
            frameData: {...this.frameData}
        };
    }

    deserialize(data) {
        this.name = data.name ?? this.name;
        this.show = data.show ?? true;
        this.x = data.x ?? DEFAULT_X;
        this.y = data.y ?? DEFAULT_Y;
        this.frameData = data.frameData ?? {};
    }

    setupGUI(parentFolder) {
        this.guiFolder = parentFolder.addFolder(this.name).close();
        
        this.guiFolder.add(this, "name").name("Name").listen()
            .onChange(() => {
                this.guiFolder.title(this.name);
                this.controller.rebuildGraphDropdowns();
            });
        
        this.guiFolder.add(this, "show").name("Show").listen()
            .onChange(() => setRenderOne());
        
        this.guiFolder.add(this, "remove").name("Remove Track");
    }

    remove() {
        this.controller.removeTrack(this);
    }

    disposeGUI() {
        if (this.guiFolder) {
            this.guiFolder.destroy();
            this.guiFolder = null;
        }
    }
}

export class CNodeOSDTrackController extends CNode {
    constructor(v) {
        super(v);
        
        this.tracks = [];
        this.activeTrack = null;
        this.editingText = "";
        this.editingModified = false;
        this.showAll = true;
        
        this.boundHandleKeyDown = (e) => this.handleKeyDown(e);
        this.boundHandleDoubleClick = (e) => this.handleDoubleClick(e);
        
        this.setupMenu();
    }

    setupMenu() {
        this.guiFolder = guiMenus.view.addFolder("OSD Tracker").close()
            .tooltip("On-Screen Display text tracker for user-defined per-frame text");
        
        this.guiFolder.add(this, "addNewTrack").name("Add New OSD Track")
            .tooltip("Create a new OSD track for per-frame text overlay");
        
        this.guiFolder.add(this, "showAll").name("Show All").listen()
            .onChange(() => {
                for (const track of this.tracks) {
                    track.show = this.showAll;
                }
                setRenderOne();
            })
            .tooltip("Toggle visibility of all OSD tracks");
        
        EventManager.addEventListener("keydown", (data) => {
            if (data.key === '\\') {
                this.cycleEditingTrack();
            }
        });

        this.graphView = null;
        this.graphSettings = { xAxis: "None", y1Axis: "None", y2Axis: "None" };
        this.graphFolder = this.guiFolder.addFolder("Graph").close();
        this.xAxisCtrl = null;
        this.y1AxisCtrl = null;
        this.y2AxisCtrl = null;
        this.rebuildGraphDropdowns();
    }
    
    getGraphAxisOptions() {
        const options = { "None": "None", "Frame": "Frame" };
        for (let i = 0; i < this.tracks.length; i++) {
            options[this.tracks[i].name] = "OSD" + (i + 1);
        }
        return options;
    }

    rebuildGraphDropdowns() {
        if (this.xAxisCtrl) this.xAxisCtrl.destroy();
        if (this.y1AxisCtrl) this.y1AxisCtrl.destroy();
        if (this.y2AxisCtrl) this.y2AxisCtrl.destroy();

        const options = this.getGraphAxisOptions();

        const storedX = this._storedX ?? "None";
        const storedY1 = this._storedY1 ?? "None";
        const storedY2 = this._storedY2 ?? "None";

        const isValidStored = (v) => Object.values(options).includes(v);
        this.graphSettings.xAxis = isValidStored(storedX) ? storedX : "None";
        this.graphSettings.y1Axis = isValidStored(storedY1) ? storedY1 : "None";
        this.graphSettings.y2Axis = isValidStored(storedY2) ? storedY2 : "None";

        const onChange = () => {
            this._storedX = this.graphSettings.xAxis;
            this._storedY1 = this.graphSettings.y1Axis;
            this._storedY2 = this.graphSettings.y2Axis;
            this.updateGraph();
        };

        this.xAxisCtrl = this.graphFolder.add(this.graphSettings, "xAxis", options).name("X Axis").onChange(onChange);
        this.y1AxisCtrl = this.graphFolder.add(this.graphSettings, "y1Axis", options).name("Y1 Axis").onChange(onChange);
        this.y2AxisCtrl = this.graphFolder.add(this.graphSettings, "y2Axis", options).name("Y2 Axis").onChange(onChange);
    }

    getTrackNumericData(trackIndex) {
        const track = this.tracks[trackIndex];
        if (!track) return [];
        const data = [];
        for (let f = 0; f < Sit.frames; f++) {
            const val = track.getValue(f);
            if (val !== PLACEHOLDER_TEXT && val !== "") {
                const num = parseFloat(val);
                if (!isNaN(num)) data.push({ frame: f, value: num });
            }
        }
        return data;
    }

    resolveAxisData(storedValue) {
        if (storedValue === "None") return null;
        if (storedValue === "Frame") {
            const data = [];
            for (let f = 0; f < Sit.frames; f++) data.push({ frame: f, value: f });
            return data;
        }
        if (storedValue.startsWith("OSD")) {
            const idx = parseInt(storedValue.substring(3), 10) - 1;
            return this.getTrackNumericData(idx);
        }
        return null;
    }

    updateGraph() {
        const xStored = this._storedX ?? "None";
        const y1Stored = this._storedY1 ?? "None";
        const y2Stored = this._storedY2 ?? "None";

        if (y1Stored === "None" && y2Stored === "None") {
            if (this.graphView) {
                this.graphView.show(false);
            }
            return;
        }

        if (!this.graphView) {
            this.graphView = new CNodeOSDGraphView({
                id: "osdGraphView",
                menuName: "OSD Graph",
                visible: true,
                left: 0, top: 0.5, width: 0.5, height: 0.5,
                draggable: true, resizable: true, freeAspect: true, shiftDrag: false,
            });
        }
        this.graphView.show(true);

        const xData = this.resolveAxisData(xStored);
        const series = [];

        const buildSeries = (yStored, label) => {
            const yData = this.resolveAxisData(yStored);
            if (!yData || yData.length === 0) return;

            const points = [];
            if (xData) {
                const xByFrame = {};
                for (const d of xData) xByFrame[d.frame] = d.value;
                for (const d of yData) {
                    if (xByFrame[d.frame] !== undefined) {
                        points.push({ x: xByFrame[d.frame], y: d.value });
                    }
                }
                points.sort((a, b) => a.x - b.x);
            } else {
                for (const d of yData) {
                    points.push({ x: d.frame, y: d.value });
                }
            }
            series.push({ data: points, label: label });
        };

        const getLabel = (stored) => {
            if (stored === "Frame") return "Frame";
            if (stored.startsWith("OSD")) {
                const idx = parseInt(stored.substring(3), 10) - 1;
                return this.tracks[idx] ? this.tracks[idx].name : stored;
            }
            return stored;
        };

        if (y1Stored !== "None") buildSeries(y1Stored, getLabel(y1Stored));
        if (y2Stored !== "None") buildSeries(y2Stored, getLabel(y2Stored));

        if (xData) {
            this.graphView.xLabel = getLabel(xStored);
        } else {
            this.graphView.xLabel = "Frame";
        }

        this.graphView.setSeries(series);
    }

    cycleEditingTrack() {
        if (this.tracks.length === 0) return;
        
        const visibleTracks = this.getVisibleTracks();
        if (visibleTracks.length === 0) return;
        
        if (!this.activeTrack) {
            this.startEditing(visibleTracks[0]);
        } else {
            const currentIndex = visibleTracks.indexOf(this.activeTrack);
            const nextIndex = (currentIndex + 1) % visibleTracks.length;
            this.startEditing(visibleTracks[nextIndex]);
        }
    }

    addNewTrack() {
        const track = new COSDTrack(this, this.tracks.length);
        this.tracks.push(track);
        track.setupGUI(this.guiFolder);
        this.updateSliderStatus();
        this.rebuildGraphDropdowns();
        setRenderOne();
        return track;
    }

    removeTrack(track) {
        const index = this.tracks.indexOf(track);
        if (index !== -1) {
            if (this.activeTrack === track) {
                this.stopEditing();
            }
            track.disposeGUI();
            this.tracks.splice(index, 1);
            this.updateSliderStatus();
            this.rebuildGraphDropdowns();
            this.updateGraph();
            setRenderOne();
        }
    }

    getVisibleTracks() {
        return this.tracks.filter(t => t.show);
    }
    
    updateSliderStatus() {
        const slider = NodeMan.get("FrameSlider", false);
        if (!slider) return;
        
        const status = new Array(Sit.frames).fill(0);
        for (const track of this.tracks) {
            if (!track.show) continue;
            for (let frame = 0; frame < Sit.frames; frame++) {
                if (track.isKeyframe(frame)) {
                    status[frame] = 1;
                }
            }
        }
        
        slider.setStatusOverlay(status, 2);
    }
    
    clearSliderStatus() {
        const slider = NodeMan.get("FrameSlider", false);
        if (slider) {
            slider.clearStatusOverlay();
        }
    }

    startEditing(track) {
        if (this.activeTrack === track) {
            return;
        }
        
        if (this.activeTrack) {
            this.stopEditing();
        }
        
        this.activeTrack = track;
        track.editing = true;
        const frame = Math.floor(par.frame);
        const value = track.getValue(frame);
        this.editingText = (value === PLACEHOLDER_TEXT) ? "" : value;
        this.editingModified = track.isKeyframe(frame);
        
        document.addEventListener('keydown', this.boundHandleKeyDown, true);
        
        registerFrameBlocker('osdTrackEdit', {
            check: () => false,
            requiresSingleFrame: () => true
        });
        
        setRenderOne();
    }

    stopEditing() {
        if (!this.activeTrack) return;
        
        if (this.editingModified) {
            this.activeTrack.setValue(Math.floor(par.frame), this.editingText);
        }
        this.activeTrack.editing = false;
        this.activeTrack = null;
        this.editingText = "";
        this.editingModified = false;
        
        document.removeEventListener('keydown', this.boundHandleKeyDown, true);
        unregisterFrameBlocker('osdTrackEdit');
        
        setRenderOne();
    }

    handleKeyDown(e) {
        if (!this.activeTrack) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const frame = Math.floor(par.frame);
        
        if (e.key === '[') {
            if (this.editingModified) {
                this.activeTrack.setValue(frame, this.editingText);
            }
            this.advanceFrame(-1);
            return;
        }
        
        if (e.key === ']') {
            if (this.editingModified) {
                this.activeTrack.setValue(frame, this.editingText);
            }
            this.advanceFrame(1);
            return;
        }
        
        if (e.key === 'Tab') {
            this.cycleEditingTrack();
            return;
        }
        
        if (e.key === 'Escape') {
            this.stopEditing();
            return;
        }
        
        if (e.key === 'Enter') {
            this.stopEditing();
            return;
        }
        
        if (e.key === 'Backspace') {
            this.editingText = this.editingText.slice(0, -1);
            this.editingModified = true;
            setRenderOne();
            return;
        }
        
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            this.editingText += e.key;
            this.editingModified = true;
            setRenderOne();
        }
    }

    advanceFrame(delta) {
        const currentFrame = Math.floor(par.frame);
        
        const newFrame = Math.max(0, Math.min(Sit.frames - 1, currentFrame + delta));
        
        if (newFrame === currentFrame) return;
        
        const frameSlider = NodeMan.get("frameSlider", false);
        if (frameSlider) {
            frameSlider.setFrame(newFrame);
        } else {
            par.frame = newFrame;
        }
        
        if (this.activeTrack.isKeyframe(newFrame)) {
            this.editingText = this.activeTrack.frameData[newFrame];
            this.editingModified = false;
        } else {
            const value = this.activeTrack.getValue(newFrame);
            this.editingText = (value === PLACEHOLDER_TEXT) ? "" : value;
            this.editingModified = false;
        }
        
        setRenderOne();
    }

    handleDoubleClick(e) {
    }

    isEditing() {
        return this.activeTrack !== null;
    }

    getEditingTrack() {
        return this.activeTrack;
    }

    getEditingText() {
        return this.editingText;
    }

    modSerialize() {
        return {
            ...super.modSerialize(),
            showAll: this.showAll,
            tracks: this.tracks.map(t => t.serialize())
        };
    }

    modDeserialize(v) {
        super.modDeserialize(v);
        
        if (v.showAll !== undefined) {
            this.showAll = v.showAll;
        }
        
        if (v.tracks && Array.isArray(v.tracks)) {
            for (const track of this.tracks) {
                track.disposeGUI();
            }
            this.tracks = [];
            
            for (const trackData of v.tracks) {
                const track = new COSDTrack(this, this.tracks.length);
                track.deserialize(trackData);
                this.tracks.push(track);
                track.setupGUI(this.guiFolder);
            }
            
            this.updateSliderStatus();
            this.rebuildGraphDropdowns();
        }
    }

    dispose() {
        this.stopEditing();
        this.clearSliderStatus();
        if (this.graphView) {
            NodeMan.unlinkDisposeRemove(this.graphView.id);
            this.graphView = null;
        }
        for (const track of this.tracks) {
            track.disposeGUI();
        }
        this.tracks = [];
        if (this.guiFolder) {
            this.guiFolder.destroy();
        }
        super.dispose();
    }
}
