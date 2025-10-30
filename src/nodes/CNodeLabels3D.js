// 3D labels (and other text that exists in 3D)
// uses the SpriteText library
// and adjusts the scale of the sprites on a per-camera basis

import SpriteText from '../js/three-spritetext';
import * as LAYER from "../LayerMasks";
import {calculateAltitude, DebugArrowAB, propagateLayerMaskObject, removeDebugArrow} from "../threeExt";
import {altitudeAboveSphere, pointOnSphereBelow} from "../SphericalMath";
import {CNodeMunge} from "./CNodeMunge";
import {Globals, guiShowHide, NodeMan, setRenderOne, Units} from "../Globals";
import {CNode3DGroup} from "./CNode3DGroup";
import {par} from "../par";
import {LLAToEUS} from "../LLA-ECEF-ENU";

import {assert} from "../assert.js";
import {V2, V3} from "../threeUtils";

import {ViewMan} from "../CViewManager";
import {EventManager} from "../CEventManager";


export const measurementUIVars = {
}

// a global flag to show/hide all measurements
let measurementUIDdone = false;
let measureArrowGroupNode = null;
let measureDistanceGroupNode = null;

let labelsGroupNode = null;
let labelsControllerMain = null;
let labelsControllerLook = null;

let featuresGroupNode = null;
let featuresControllerMain = null;
let featuresControllerLook = null;


// adds a new group for measurements, and a GUI controller to toggle it.
export function setupMeasurementUI() {
    if (measurementUIDdone) return;
    measurementUIDdone = true;

    // We create a group node to hold all the measurement arrows
    measureArrowGroupNode = new CNode3DGroup({id: "MeasurementsGroupNode"});
    measureArrowGroupNode.isMeasurement = true

    labelsGroupNode = new CNode3DGroup({id: "LabelsGroupNode"});

    featuresGroupNode = new CNode3DGroup({id: "FeaturesGroupNode"});

    measureDistanceGroupNode = new CNode3DGroup({id: "MeasureDistanceGroupNode"});
    measureDistanceGroupNode.isMeasurement = true;



//    console.warn("%%%%%%% setupMeasurementUI: Globals.showMeasurements = " + Globals.showMeasurements)

    function refreshMeasurementVisibility() {
        NodeMan.iterate((key, node) => {
            if (node.isMeasurement) {
//                console.log ("Setting visibility of " + key + " to " + Globals.showMeasurements)
                node.group.visible = Globals.showMeasurements;
            }
        })
    }

    refreshMeasurementVisibility();

    measurementUIVars.controller =  guiShowHide.add(Globals, "showMeasurements").name("Measurements").listen().onChange( (value) => {
//        console.warn("%%%%%%% showMeasurements changed to " + value)
        refreshMeasurementVisibility();
        setRenderOne(true);
    })

    Globals.showLabelsMain = true;
    Globals.showLabelsLook = false;





    labelsControllerMain = guiShowHide.add(Globals, "showLabelsMain").name("Labels in Main").listen().onChange( (value) => {
       refreshLabelVisibility();
    });

    labelsControllerLook = guiShowHide.add(Globals, "showLabelsLook").name("Labels in Look").listen().onChange( (value) => {

        refreshLabelVisibility();
    })

    Globals.showFeaturesMain = true;
    Globals.showFeaturesLook = false;

    featuresControllerMain = guiShowHide.add(Globals, "showFeaturesMain").name("Features in Main").listen().onChange( (value) => {
        refreshFeatureVisibility();
    });

    featuresControllerLook = guiShowHide.add(Globals, "showFeaturesLook").name("Features in Look").listen().onChange( (value) => {
        refreshFeatureVisibility();
    })

}

export function refreshLabelsAfterLoading() {
    measurementUIVars.controller._callOnChange(); // PATCH: call the onChange function to update the UI for the visibility of the measurements

    labelsControllerMain._callOnChange();
    labelsControllerLook._callOnChange();
    featuresControllerMain._callOnChange();
    featuresControllerLook._callOnChange();

    refreshLabelVisibility();
    refreshFeatureVisibility();
}

export function refreshLabelVisibility() {
    // we just set the layers mask to the appropriate value
    let mask = 0;
    if (Globals.showLabelsMain) {
        mask |= LAYER.MASK_MAIN;
    }
    if (Globals.showLabelsLook) {
        mask |= LAYER.MASK_LOOK;
    }
    labelsGroupNode.group.layers.mask = mask;
    propagateLayerMaskObject(labelsGroupNode.group);
}

export function refreshFeatureVisibility() {
    // we just set the layers mask to the appropriate value
    let mask = 0;
    if (Globals.showFeaturesMain) {
        mask |= LAYER.MASK_MAIN;
    }
    if (Globals.showFeaturesLook) {
        mask |= LAYER.MASK_LOOK;
    }
    featuresGroupNode.group.layers.mask = mask;
    propagateLayerMaskObject(featuresGroupNode.group);
}

export function removeMeasurementUI() {
    if (measureArrowGroupNode) {
        measureArrowGroupNode.dispose();
        measureArrowGroupNode = null;
        measureDistanceGroupNode.dispose();
        measureDistanceGroupNode = null;
        labelsGroupNode.dispose();
        labelsGroupNode = null;
        featuresGroupNode.dispose();
        featuresGroupNode = null;
        measurementUIDdone = false
    }
}

export class CNodeLabel3D extends CNode3DGroup {
    constructor(v) {
        const groupNode = NodeMan.get(v.groupNode ?? "MeasurementsGroupNode");
        v.container = groupNode.group;
        super(v)
        this.groupNode = groupNode;
        this.unitType = v.unitType ?? "big";
        this.decimals = v.decimals ?? 2;
        this.size = v.size ?? 12;
        this.sprite = new SpriteText(v.text, this.size);
        this.optionalInputs(["position"])
        this.position = V3();
        if (this.in.position !== undefined) {
            const pos = this.in.position.p(0);
//            this.sprite.position.set(pos.x, pos.y, pos.z);
            this.position.copy(pos)
        }

        // simple LLA input for markers
        if (v.positionLLA !== undefined) {
            const lla = v.positionLLA;
            const pos = LLAToEUS(lla.lat, lla.lon, lla.alt);
            this.position.set(pos.x, pos.y, pos.z);
        }

        this.input("color",true)

        let color = '#FFFFFF';
        if (this.in.color !== undefined) {
            color = this.in.color.v(0)
            // convert from THREE.Color to hex
            if (color.getStyle !== undefined) {
                color = color.getStyle();
            }
        }

        this.sprite.color = color;
        this.sprite.layers.mask = v.layers ?? LAYER.MASK_HELPERS;
        this.group.add(this.sprite);
        this.isMeasurement = true;

        // for sprite center (anchor point), 0,0 is lower left
        this.sprite.center = V2(v.centerX ?? 0.5, v.centerY ?? 0.5);
        this.offset = V2(v.offsetX ?? 0, v.offsetY ?? 0);

//        setupMeasurementUI();

    }

    preRender(view) {
        this.updateVisibility(view);
        this.updateScale(view);
    }

    updateVisibility(view) {
        // text is draw with no depth test, so it's always visible
        // so here we check if it's underground, and hide it if it is
        const altitude = calculateAltitude(this.position);
        let transparency = 1;
        if (altitude > 0) {
        } else {
            const fadeDepth = 25000;
            if (altitude < -fadeDepth) {
                transparency = 0 ;
            } else {
                transparency = (1 + altitude / fadeDepth);
            }

        }


        //console.log("transparency = " + transparency + " altitude = " + altitude)
        this.sprite.setTransparency(transparency);



    }

    // Update the Scale based on the camera's position
    // Since this is a simple fixed size, we code just use sizeAttenuation:false in the sprite material
    // however I might want to change the size based on distance in the future.
    updateScale(view) {
        if (!this.group.visible) {
            return;
        }

        const camera = view.camera

        //this.sprite.position.copy(this.position)

        // given:
        // a 3D position in this.position
        // a 2D pixel offset in this.offset
        // a 3D camera position in camera.position
        // the camera vertical FOV in camera.fov
        // then modify the sprites position by the offset
        // accounting for the camera's FOV and distance to the sprite, and the viewport size in pixels
        // to keep the offset in pixels

        let pos = this.position.clone();
        if (this.offset !== undefined) {
           pos = view.offsetScreenPixels(pos, this.offset.x, this.offset.y);
        }

        this.sprite.position.copy(pos);


        let zoom = 1;
        if (view.syncVideoZoom && NodeMan.exists("videoZoom")) {
            var videoZoom = NodeMan.get("videoZoom")
            if (videoZoom != undefined) {
                zoom = videoZoom.v0 / 100;
            }
        }

        const mask = camera.layers.mask;
        const fovScale = 0.0025 * Math.tan((camera.fov / 2) * (Math.PI / 180))
         const sprite = this.sprite;
        if (sprite.layers.mask & mask) {
            const distance = camera.position.distanceTo(sprite.position);
            let scale = distance * fovScale * this.size * ViewMan.heightPx/view.heightPx/zoom;
            sprite.scale.set(scale * sprite.aspect, scale, 1);
        }

    }

    update(f) {
        if (this.in.position !== undefined) {
            const pos = this.in.position.p(f);
            this.position.set(pos.x, pos.y, pos.z);
        }
    }

    dispose() {
        this.group.remove(this.sprite)
        this.sprite.material.dispose();
        this.sprite.geometry.dispose();
        super.dispose();
    }

    changeText(text) {
        if (this.sprite.text === text) return;
        // using the settor will regenerate the sprite canvas
        this.sprite.text = text;
    }

    // changePosition(position) {
    //     this.position.set(position.x, position.y, position.z);
    // }

}

// a text label that shows a given lat/lon at that position
// for labeling pins, etc
export class CNodeLLALabel extends CNodeLabel3D {
    constructor(v) {
        super(v);
        this.lat = v.lat;
        this.lon = v.lon;
        this.alt = v.alt;
        this.update(0);

    }

    update(f) {
        const lat = this.lat;
        const lon = this.lon;
        const text = `${lat.toFixed(4)} ${lon.toFixed(4)}`;
        this.changeText(text);

        const pos = LLAToEUS(lat, lon, this.alt);
        this.position.set(pos.x, pos.y, pos.z);

    }

    changeLLA(lat, lon, alt) {
        this.lat = lat;
        this.lon = lon;
        this.alt = alt;
        this.update(0);
    }

}

export class CNodeMeasureAB extends CNodeLabel3D {
    constructor(v) {
        v.position = v.A;  // PATCH !! we have A and B, but super needs position
        super(v);
        this.input("A");
        this.input("B");
        this.update(0)
    }

    update(f) {

        // no need to update if it's parent group is not visible
        if (!this.group.visible)
            return;


        this.A = this.in.A.p(f);
        this.B = this.in.B.p(f);
        const midPoint = this.A.clone().add(this.B).multiplyScalar(0.5);
        this.position.set(midPoint.x, midPoint.y, midPoint.z);

        // get a point that's 90% of the way from A to midPoint
        this.C = this.A.clone().lerp(midPoint, 0.9);
        // and the same for B
        this.D = this.B.clone().lerp(midPoint, 0.9);

        let color = 0x00FF00;
        if (this.in.color !== undefined) {
            color = this.in.color.v(f)
        }

        // add an arrow from A to C and B to D
        // Use this.group instead of this.groupNode.group so arrows are children of this measurement
        // and will be hidden/shown along with the text label
        DebugArrowAB(this.id + "start", this.C, this.A, color, true, this.group);
        DebugArrowAB(this.id + "end", this.D, this.B, color, true, this.group);

        let length

        if (this.altitude) {
            // if we are measuring altitude, then we need to use the altitude of A and B
            // to calculate the length
            length = altitudeAboveSphere(this.A) - altitudeAboveSphere(this.B);
        } else {
            length = this.A.distanceTo(this.B);
        }



        let text;
        if (this.altitude) {
            // TODO: verify this is correct, use the fixed camera and target
            var alt = altitudeAboveSphere(this.A)
            if (Math.abs(alt-length) < 1) {
                // if the altitude is within 1 meter of the length, then just show the length
                // as that means we are over the ocean (zero altitude msl))
                text = Units.withUnits(length, this.decimals, this.unitType) + " msl\n ";
            } else {
                text = Units.withUnits(length, this.decimals, this.unitType) + " agl";
                text += "\n " + Units.withUnits(alt, this.decimals, this.unitType) + " msl";
            }
            //text += "\n "+Units.withUnits(alt, this.decimals, this.unitType)+ " msl";
        } else {
            text = Units.withUnits(length, this.decimals, this.unitType);
        }
        this.changeText(text);

    }

    dispose() {
        removeDebugArrow(this.id+"start");
        removeDebugArrow(this.id+"end");
        super.dispose();
    }
}

export class CNodeLabeledArrow extends CNodeLabel3D {
    constructor(v) {
        super(v);
        this.input("start");
        this.input("direction")
        this.input("length");
        this.input("color")

        this.label = v.label ?? "";

        this.recalculate(0);
    }

    recalculate(f) {

        this.calculateVectors(f)

        const color = this.in.color.v(f)
        // add an arrow from A to C and B to D
        DebugArrowAB(this.id+"arrow", this.start, this.end, color, true, this.groupNode.group);


        this.changeText(this.label);

    }

    calculateVectors(f) {
        this.start = this.in.start.p(f);
        this.length = this.in.length.v(f);
        this.direction = this.in.direction.p(f);

        // normalize the direction
        this.direction.normalize();

        this.end = this.start.clone().add(this.direction.clone().multiplyScalar(this.length));
        this.position.copy(this.end);
    }

    // update the arrow with a new direction
    // which will override the current direction
    updateDirection(dir) {
        this.calculateVectors(par.frame);

        this.direction.copy(dir);
        this.update(0);
    }



    // scale things based on the camera's position
    preRender(view) {

        // change the length of the arrows based on the camera's position
        if (this.length < 0) {
            const lengthPixels = -this.length;
            const lengthMeters = view.pixelsToMeters(this.start, lengthPixels);
            const color = this.in.color.v(0)
            this.end = this.start.clone().add(this.direction.clone().multiplyScalar(lengthMeters));

            // just calling this again will update the length of the arrow
            DebugArrowAB(this.id+"arrow", this.start, this.end, color, true, this.groupNode.group);
        }

        // update the position of the text
        this.position.copy(this.end);
        super.preRender(view);
    }

    dispose() {
        removeDebugArrow(this.id+"arrow");
        super.dispose();
    }
}


// MeasureAltitude will create a munge node B that has A as an input
// and updates itself to be below A (on terrain if any, or MSL if none)
export class CNodeMeasureAltitude extends CNodeMeasureAB {
    constructor(v) {

        assert(v.id !== undefined, "CNodeMeasureAltitude id is undefined")
        v.A = v.position; // we are going to add an AB measure, so we need A
// we are going to munge the position to get the altitude
        const B = new CNodeMunge({
            id: v.id + "_Below",
            inputs: {source: v.A},
            munge: (f) => {
                let B;
                const posNode = NodeMan.get(v.A); // cant use this.in.A as super hasnt been called yet
                const A = posNode.p(f);
                if (NodeMan.exists("TerrainModel")) {
                    let terrainNode = NodeMan.get("TerrainModel")
                    B = terrainNode.getPointBelow(A)
                } else {
                    B = pointOnSphereBelow(A);
                }
                return B;
            }
        })
        v.B = B;

        // patch to make it double size with two lines
        // should handle this better
        v.size = 24;

        v.unitType ??= "small";
        v.decimals ??= 0;

        super(v);

        this.altitude = true;
    }
}

// A feature marker with a label and an arrow pointing down from 100 pixels above the feature
export class CNodeFeatureMarker extends CNodeLabel3D {
    constructor(v) {
        // Set the groupNode to FeaturesGroupNode instead of MeasurementsGroupNode
        v.groupNode = v.groupNode ?? "FeaturesGroupNode";
        
        // Set the label to be 100 pixels above the feature
        v.offsetY = v.offsetY ?? 100;
        v.centerY = v.centerY ?? 0; // Bottom of label at the top of arrow
        
        // Set default white color for text label
        v.color = v.color ?? 0xFFFFFF;
        
        super(v);
        
        // Store the text for serialization
        this.text = v.text ?? "";
        
        // Add black stroke/border to the text
        this.sprite.strokeWidth = 1;
        this.sprite.strokeColor = 'black';
        this.sprite.fontWeight = 'bold';
        
        // Store the original LLA values
        this.lla = null;
        if (v.positionLLA !== undefined) {
            this.lla = {
                lat: v.positionLLA.lat,
                lon: v.positionLLA.lon,
                alt: v.positionLLA.alt
            };
        }
        
        // Store the base feature position (without offset)
        this.featurePosition = V3();
        
        // Initial calculation
        this.recalculate(0);
        
        // Listen for elevation changes to update ground-conformed positions
        EventManager.addEventListener("elevationChanged", () => {
            this.recalculate(0);
        });
    }
    
    recalculate(f) {
        if (!this.lla) return;
        
        // If altitude is zero, conform to ground
        if (this.lla.alt === 0) {
            // First get the position at the lat/lon with zero altitude
            const basePos = LLAToEUS(this.lla.lat, this.lla.lon, 0);
            
            // Then get the point on the terrain/sphere below
            if (NodeMan.exists("TerrainModel")) {
                const terrainNode = NodeMan.get("TerrainModel");
                this.featurePosition.copy(terrainNode.getPointBelow(basePos));
            } else {
                this.featurePosition.copy(pointOnSphereBelow(basePos));
            }
        } else {
            // Use the specified altitude
            const pos = LLAToEUS(this.lla.lat, this.lla.lon, this.lla.alt);
            this.featurePosition.copy(pos);
        }
        
        // Update the position used by the parent class
        this.position.copy(this.featurePosition);
    }
    
    preRender(view) {
        super.preRender(view);
        
        // Calculate the top position (100 pixels above in screen space)
        const topPosition = view.offsetScreenPixels(this.featurePosition.clone(), 0, 100);
        
        // Arrow is always red for feature markers
        const color = 0xFF0000;
        
        // Add arrow pointing down from label to feature
        // Use the parent group's layer mask so arrow visibility matches the label visibility
        DebugArrowAB(this.id + "_arrow", topPosition, this.featurePosition, color, true, this.group, 20, this.group.layers.mask);
    }
    
    dispose() {
        removeDebugArrow(this.id + "_arrow");
        super.dispose();
    }
}


export function doLabel3D(id, pos, text, size, layers) {
    let node = NodeMan.get(id, false);
    if (node == undefined) {
        node = new CNodeLabel3D({id, position: pos, text, size, layers});
        NodeMan.add(id, node);
    }
    return node;

}


