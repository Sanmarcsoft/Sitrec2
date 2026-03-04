import {CNode, CNodeOrigin} from "./CNode";
import {metersPerSecondFromKnots, radians} from "../utils";
import {GlobalDateTimeNode, NodeMan, Sit} from "../Globals";
import {DebugArrowAB} from "../threeExt";
import {GlobalScene} from "../LocalFrame";
import {getLocalNorthVector, getLocalUpVector} from "../SphericalMath";
import {assert} from "../assert.js";
import {V3} from "../threeUtils";
import {ECEFToLLAVD_radii} from "../LLA-ECEF-ENU";
import {meanSeaLevelOffset} from "../EGM96Geoid";
import {showError} from "../showError";

const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30];

// Interpolate wind speed and direction at a target altitude given arrays of
// geopotential heights, wind speeds, and wind directions from pressure-level data.
function interpolateWindAtAltitude(targetAlt, heights, speeds, dirs) {
    const valid = [];
    for (let i = 0; i < heights.length; i++) {
        if (heights[i] != null && speeds[i] != null && dirs[i] != null) {
            valid.push({height: heights[i], speed: speeds[i], dir: dirs[i]});
        }
    }

    if (valid.length === 0) {
        return {speed: 0, direction: 0};
    }

    // geopotential heights increase as pressure decreases
    valid.sort((a, b) => a.height - b.height);

    // clamp to nearest if outside range
    if (targetAlt <= valid[0].height) {
        return {speed: valid[0].speed, direction: valid[0].dir};
    }
    if (targetAlt >= valid[valid.length - 1].height) {
        const last = valid[valid.length - 1];
        return {speed: last.speed, direction: last.dir};
    }

    // find bracketing levels
    for (let i = 0; i < valid.length - 1; i++) {
        if (valid[i].height <= targetAlt && valid[i + 1].height >= targetAlt) {
            const t = (targetAlt - valid[i].height) / (valid[i + 1].height - valid[i].height);
            const speed = valid[i].speed + t * (valid[i + 1].speed - valid[i].speed);
            const direction = circularInterp(valid[i].dir, valid[i + 1].dir, t);
            return {speed, direction};
        }
    }

    // fallback (shouldn't reach here)
    return {speed: valid[0].speed, direction: valid[0].dir};
}

// Interpolate between two angles (in degrees) handling the 360/0 wraparound
function circularInterp(a, b, t) {
    const aRad = a * Math.PI / 180;
    const bRad = b * Math.PI / 180;
    const sinVal = Math.sin(aRad) * (1 - t) + Math.sin(bRad) * t;
    const cosVal = Math.cos(aRad) * (1 - t) + Math.cos(bRad) * t;
    let result = Math.atan2(sinVal, cosVal) * 180 / Math.PI;
    if (result < 0) result += 360;
    return result;
}

export class CNodeWind extends CNode {
    constructor(v, _guiMenu) {
        super(v);

        
        this.setGUI(v, _guiMenu)

        this.from = v.from;  // true heading of the wind soruce. North = 0
        this.knots = v.knots
        this.name = v.name ?? v.id // if no name is supplied, use the id

        this.max = v.max ?? 200;

        // this.input("pos")
        // this.input("radius")

        if(this.gui) {
            this.guiFrom = this.gui.add (this, "from", 0,359,1).name(this.name+" Wind From").onChange(x =>this.recalculateCascade()).wrap()
            this.guiKnots = this.gui.add (this, "knots", 0, this.max, 1).name(this.name+" Wind Knots").onChange(x => this.recalculateCascade())
        }

       // this.optionalInputs(["originTrack"])
        // wind defaults to being in the frame of reference of the ECEF origin (Earth center)
        this.position=V3(0,0,0);



        // we can't use originTrack as an input as typically it's going to be something like the
        // target position, which then depends on the wind, which depends on the target position
        // so in the update function we can just get the zero frame position of the origin track
        // the zero frame will NOT have any wind applied, as that time dependent (and the zero frame has t=0)
        this.originTrack = v.originTrack; // optional, if supplied, the wind is in the frame of reference of the track

        // add fetch button if we have an origin track to get position from
        this.fetchingWind = false;
        if (this.gui && this.originTrack) {
            this.fetchWindButtonName = "Fetch " + this.name + " Wind";
            this.guiFetchWind = this.gui.add(this, "fetchWind").name(this.fetchWindButtonName);
        }

        // forcing extra intial recalculate cascades (only of there's an origin track)
        // this is to ensure that the wind is in the correct frame of reference
        // bit of a patch, but it works. Really need to sort out the initialization order here
        this.extraRecalculate = 2;

        this.lock = v.lock;

        this.recalculate()
    }

    modSerialize() {
        return {
            ...super.modSerialize(),
            from: this.from,
            knots: this.knots,
            name: this.name,
            max: this.max,
            lock: this.lock,
        }
    }

    modDeserialize(v) {
        super.modDeserialize(v);
        this.from = v.from;
        this.knots = v.knots;
        this.name = v.name;
        this.max = v.max;
        this.lock = v.lock;
        this.guiFrom.updateDisplay()
        this.guiKnots.updateDisplay()
    }

    // // hide and show will be called from a switch node
    // hide() {
    //     super.hide()
    //     this.guiFrom.hide()
    //     this.guiKnots.hide()
    //     return this;
    //
    // }

    show(visible=true) {
        super.show(visible)
        this.guiFrom.show(visible)
        this.guiKnots.show(visible)
        return this;
    }

    setPosition(pos) {
        assert(!isNaN(pos.x) && !isNaN(pos.y) && !isNaN(pos.z), "Setting Wind position has NaNs");
        this.position = pos.clone();
    }

    // returns a pre-frame wind vector, indicating wind motion for that frame
    // in ECEF coordinates
    // optionally supply a position to get the wind at that position
    // with reference to local north and up vectors
    getValueFrame(f, position) {

        // if no position is supplied, use the current position
        // fine for a target that does not move much, but if the target moves a lot, then
        // we should supply the position of the target at the time of the frame
        if (position === undefined) {
            position = this.position;
        }

        //let wind = V3(0, 0, -metersPerSecondFromKnots(this.knots) / Sit.fps);
        //const posUp = V3(0, 1, 0)
        let wind = getLocalNorthVector(position)
        wind.multiplyScalar(metersPerSecondFromKnots(this.knots) / Sit.fps)
        const posUp = getLocalUpVector(position)
        wind.applyAxisAngle(posUp, radians(180-this.from))

        // assert no NaNs in the wind vector
        assert(!isNaN(wind.x) && !isNaN(wind.y) && !isNaN(wind.z), "Wind vector has NaNs");

        return wind;
    }


    update(f) {
        // if we have a lock, then hide the gui of the wind we lock to
        if (this.lock !== undefined) {
            if (NodeMan.exists("lockWind")) {
                const lock = NodeMan.get("lockWind");
                const target = NodeMan.get(this.lock);

                if (lock.value) {
                    this.updateLockedWind()
                }

                if (lock.value !== target.visible) {
                    target.recalculate();
                }

                target.show(!lock.value)
            }
        }

        // if we have an origin track, then update the position to be the zero frame position of that track
        // so we have an accurate frame of reference for the wind

        // if the originTrack is a string, then get the node from NodeMan
        // this allows to make the wind position depended on a track that has not been created yet
        // (i.e. the target position, which depends on the wind)
        if (typeof this.originTrack === "string") {
            this.originTrack = NodeMan.get(this.originTrack);
        }

        if (this.originTrack !== undefined) {
            const newPosition = this.originTrack.p(0);
            assert(newPosition.x !== undefined, "Wind origin track did not return a valid position");
            if (!newPosition.equals(this.position)) {
                // force TWO recalculate cycles to ensure it propogates through the system
                this.extraRecalculate = 2;
                this.setPosition(newPosition);
            }

            if (this.extraRecalculate) {
                this.extraRecalculate--;
                // changing the frame of reference of the wind will change dependent nodes
                // so we need to recalculate them
                this.recalculateCascade();
            }
        }
    }

    updateLockedWind() {
        const target = NodeMan.get(this.lock);
        target.from = this.from;
        target.knots = this.knots;
        target.guiFrom.updateDisplay()
        target.guiKnots.updateDisplay()
    }

    recalculate() {
         if (this.dontRecurse) return;
         this.dontRecurse = true;

        if (this.lock !== undefined) {
            if (NodeMan.exists("lockWind")) {
                const lock = NodeMan.get("lockWind");
                if (lock.value) {
                    this.updateLockedWind()
                }
            }
        }

        this.dontRecurse = false;

        // var A = Sit.jetOrigin.clone()
        //
        // var B = A.clone().add(this.p().multiplyScalar(Sit.frames))
        // DebugArrowAB(this.id+" Wind",A,B,this.arrowColor,true,GlobalScene)
    }

    async fetchWind() {
        if (!this.originTrack) return;
        if (this.fetchingWind) return; // ignore clicks while already fetching

        // resolve originTrack string to node if needed
        if (typeof this.originTrack === "string") {
            this.originTrack = NodeMan.get(this.originTrack);
        }

        // start animated "Fetching..." indicator
        this.fetchingWind = true;
        let dotCount = 0;
        const dotInterval = setInterval(() => {
            dotCount = (dotCount % 5) + 1;
            this.guiFetchWind?.name("Fetching" + ".".repeat(dotCount));
        }, 300);

        // get position from originTrack at current frame
        const f = Sit.currentFrame ?? 0;
        const posECEF = this.originTrack.p(f);
        const lla = ECEFToLLAVD_radii(posECEF);
        const lat = lla.x;
        const lon = lla.y;
        const altMSL = lla.z - meanSeaLevelOffset(lat, lon);

        // determine date — use sitch date if available, otherwise current time
        const dateNow = (GlobalDateTimeNode && GlobalDateTimeNode.dateNow)
            ? GlobalDateTimeNode.dateNow
            : new Date();
        const dateStr = dateNow.toISOString().slice(0, 10);

        // choose forecast vs historical-forecast endpoint
        // note: archive-api does NOT support pressure-level variables,
        // but historical-forecast-api does (reanalysis data with pressure levels)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isHistorical = dateNow < today;
        const baseUrl = isHistorical
            ? "https://historical-forecast-api.open-meteo.com/v1/forecast"
            : "https://api.open-meteo.com/v1/forecast";

        // build query with all pressure levels
        const windSpeedVars = PRESSURE_LEVELS.map(l => `wind_speed_${l}hPa`).join(",");
        const windDirVars = PRESSURE_LEVELS.map(l => `wind_direction_${l}hPa`).join(",");
        const geoHeightVars = PRESSURE_LEVELS.map(l => `geopotential_height_${l}hPa`).join(",");

        const url = `${baseUrl}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
            + `&hourly=${windSpeedVars},${windDirVars},${geoHeightVars}`
            + `&wind_speed_unit=kn&start_date=${dateStr}&end_date=${dateStr}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();

            // find hourly index closest to our time
            const hourIndex = dateNow.getUTCHours();

            // extract values at this hour for each pressure level
            const heights = PRESSURE_LEVELS.map(l => data.hourly[`geopotential_height_${l}hPa`]?.[hourIndex]);
            const speeds = PRESSURE_LEVELS.map(l => data.hourly[`wind_speed_${l}hPa`]?.[hourIndex]);
            const dirs = PRESSURE_LEVELS.map(l => data.hourly[`wind_direction_${l}hPa`]?.[hourIndex]);

            const result = interpolateWindAtAltitude(altMSL, heights, speeds, dirs);

            this.from = Math.round(result.direction);
            this.knots = Math.round(result.speed);

            if (this.guiFrom) this.guiFrom.updateDisplay();
            if (this.guiKnots) this.guiKnots.updateDisplay();
            this.recalculateCascade();

            console.log(`Fetched ${this.name} wind at ${lat.toFixed(2)}, ${lon.toFixed(2)}, `
                + `alt ${altMSL.toFixed(0)}m MSL: from ${this.from}° at ${this.knots} kn`);

        } catch (error) {
            console.error("Wind fetch failed:", error);
            showError("Failed to fetch wind data: " + error.message);
        } finally {
            clearInterval(dotInterval);
            this.fetchingWind = false;
            this.guiFetchWind?.name(this.fetchWindButtonName);
        }
    }


}

export class CNodeDisplayWindArrow extends CNode {
    constructor(v) {
        super(v)
        this.input("source")
        this.input("displayOrigin",true)
        if (!this.in.displayOrigin) {
            this.addInput("displayOrigin", new CNodeOrigin({id:"displayOrigin"}))
        }
        this.arrowColor = v.arrowColor ?? "white"
        this.recalculate();
    }

    recalculate() {
    //    var A = Sit.jetOrigin.clone()
        var A = this.in.displayOrigin.p(0);
        var B = A.clone().add(this.in.source.p().multiplyScalar(10000))
        DebugArrowAB(this.id+" Wind",A,B,this.arrowColor,true,GlobalScene)
    }
}