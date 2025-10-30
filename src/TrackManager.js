// Creating timed data and then tracks from pre-parsed track files
// should be agnostic to the source of the data (KML/ADSB, CSV, KLVS, etc)
import {CNodeScale} from "./nodes/CNodeScale";
import {CNodeGUIValue} from "./nodes/CNodeGUIValue";
import {CNodeConstant} from "./nodes/CNode";
import * as LAYER from "./LayerMasks";
import {Color, Vector3} from "three";
import {getFileExtension, scaleF2M} from "./utils";
import {
    FileManager,
    GlobalDateTimeNode,
    Globals,
    guiMenus,
    NodeMan,
    setRenderOne,
    setSitchEstablished,
    Sit
} from "./Globals";
import {CNodeDisplayTrack} from "./nodes/CNodeDisplayTrack";
import {CManager} from "./CManager";
import {CNodeControllerMatrix, CNodeControllerTrackPosition} from "./nodes/CNodeControllerVarious";
import {MISB} from "./MISBUtils";
// Removed mathjs import - using native JavaScript Number.isFinite or typeof checks
import {CNodeMISBDataTrack, makeLOSNodeFromTrackAngles, removeLOSNodeColumnNodes} from "./nodes/CNodeMISBData";
import {KMLToMISB} from "./KMLUtils";
import {CNodeTrackFromMISB} from "./nodes/CNodeTrackFromMISB";
import {assert} from "./assert.js";
import {getLocalSouthVector, getLocalUpVector, pointOnSphereBelow} from "./SphericalMath";
import {closestIntersectionTime, trackBoundingBox} from "./trackUtils";
import {CNode3DObject, ModelFiles} from "./nodes/CNode3DObject";
import {CNodeTrackGUI} from "./nodes/CNodeControllerTrackGUI";
import {CGeoJSON} from "./geoJSONUtils";
import {CNodeSmoothedPositionTrack} from "./nodes/CNodeSmoothedPositionTrack";
import {CNodeSplineEditor} from "./nodes/CNodeSplineEdit";


class CMetaTrack {
    constructor(trackFileName, trackDataNode, trackNode) {
        this.trackNode = trackNode;
        this.trackDataNode = trackDataNode;
        this.trackFileName = trackFileName;
        this.isSynthetic = false; // Flag to identify synthetic tracks
    }

    // TODO - call this when switching levels
    dispose() {

        // Remove the menu folder
       // guiMenus.contents.removeFolder(this.guiFolder);
        this.guiFolder.destroy();

        const shortName = this.trackNode.shortName;
        
        // Remove the short name from the used names set
        TrackManager.usedShortNames.delete(shortName);


// TODO
        // OTHER DROP TAGETS
        // RESTORE SELECTIONS ON DROP IF A TRACK IS RE-LOADED
        // (currently it restets it to the first selection, fixed target)

        if (Sit.dropTargets !== undefined && Sit.dropTargets["track"] !== undefined) {
            const dropTargets = Sit.dropTargets["track"]
            for (let dropTargetSwitch of dropTargets) {


                // if it ends with a - and a number, then we delete that part
                const match = dropTargetSwitch.match(/-(\d+)$/);
                if (match !== null) {
                    dropTargetSwitch = dropTargetSwitch.substring(0, dropTargetSwitch.length - match[0].length);
                }


                if (NodeMan.exists(dropTargetSwitch)) {
//                    console.log("Removing track ", shortName, " from drop target: ", dropTargetSwitch)
                    const switchNode = NodeMan.get(dropTargetSwitch);
                    switchNode.removeOption(shortName)
                }
            }
        }



        // dispose data nodes before track nodes, as the track nodes have data nodes as inputs
        // OH, BUT THEY LINK FORWARD AND BACKWARDS.... SO WE NEED TO UNLINK THEM FIRST
        // BUT NOT ANYTHING ELSE, AS WE STILL WANT TO CHECK FOR UNANTICIPATED LINKS
        //NodeMan.unlink(this.trackNode, this.trackDataNode); TODO
        //OR  - change disposeRemove so it unlinks first

        // trackNode and centerNode will also have the _unsmoothed versions as input, so need to delete those first
        // they will be in the "source" input object

        NodeMan.unlinkDisposeRemove(this.trackNode.inputs.source);
        if (this.centerNode) {
            NodeMan.unlinkDisposeRemove(this.centerNode.inputs.source);
        }

        // a bit messy, should keep track of nodes some other way
        NodeMan.unlinkDisposeRemove(this.trackID + "_smoothValue");

        NodeMan.unlinkDisposeRemove(this.trackDataNode);
        NodeMan.unlinkDisposeRemove(this.trackNode);
        NodeMan.unlinkDisposeRemove(this.centerDataNode);
        NodeMan.unlinkDisposeRemove(this.centerNode);
        NodeMan.unlinkDisposeRemove(this.trackDisplayDataNode);
        NodeMan.unlinkDisposeRemove(this.trackDisplayNode);
        NodeMan.unlinkDisposeRemove(this.displayCenterDataNode);
        NodeMan.unlinkDisposeRemove(this.displayCenterNode);
        NodeMan.unlinkDisposeRemove(this.displayTargetSphere);
        NodeMan.unlinkDisposeRemove(this.displayCenterSphere);
        NodeMan.unlinkDisposeRemove(this.gui);

        NodeMan.unlinkDisposeRemove(this.anglesNode);
        NodeMan.unlinkDisposeRemove(this.anglesController);
        removeLOSNodeColumnNodes(this.trackID);

        // more limited pruning
        NodeMan.pruneUnusedControllers();
        NodeMan.pruneUnusedFlagged();

        // DON"T DO THIS
        //NodeMan.pruneUnusedConstants();

    }


    show(visible) {

        if (this.displayCenterDataNode) {
            this.displayCenterDataNode.show(visible);
        }
        if (this.displayCenterNode) {
            this.displayCenterNode.show(visible);
        }
        if (this.displayTargetSphere) {
            this.displayTargetSphere.show(visible);
        }
        if (this.displayCenterSphere) {
            this.displayCenterSphere.show(visible);
        }

    }

}



/**
 * Get information about tracks in a complex MISB CSV
 * @param {Array} complexMisb - Full MISB array with potentially multiple tracks
 * @returns {Object} - Object with trackIDArray and count
 */
function getCSVTrackInfo(complexMisb) {
    // Count the number of unique values in the TrackID column
    // This is a full MISB array with the PlatformCallSign standing in for TrackID
    // (they both have the same column index)
    const trackIDs = new Set();
    const trackIDCol = MISB.TrackID;
    for (let i = 0; i < complexMisb.length; i++) {
        const trackID = complexMisb[i][trackIDCol];
        if (trackID !== null && trackID !== undefined) {
            trackIDs.add(trackID);
        }
    }

    const trackIDArray = Array.from(trackIDs);
    // if empty, then just patch it as if it has one entry
    if (trackIDArray.length === 0) {
        console.warn("getCSVTrackInfo: No TrackIDs found, assuming single track");
        trackIDArray.push("dummyTrackID");
    }

    return {
        trackIDArray: trackIDArray,
        count: trackIDArray.length
    };
}

/**
 * Extract a single track from a complex MISB CSV by index
 * @param {Array} complexMisb - Full MISB array with potentially multiple tracks
 * @param {number} index - Index of the track to extract
 * @returns {Array|null} - Extracted MISB array for the specified track, or null if index out of range
 */
function extractIndexedMisbCSV(complexMisb, index) {
    console.log("extractIndexedMisbCSV: extracting index ", index, " from complex MISB CSV with length ", complexMisb.length);
    
    const trackInfo = getCSVTrackInfo(complexMisb);
    const trackIDArray = trackInfo.trackIDArray;

    if (index >= trackIDArray.length) {
        console.warn("extractIndexedMisbCSV: index ", index, " out of range, only ", trackIDArray.length, " unique TrackIDs");
        return null;
    }

    // now create a new MISB array with only the entries (rows) matching the selected TrackID
    const selectedTrackID = trackIDArray[index];
    const extractedMisb = complexMisb.filter(row => row[MISB.TrackID] === selectedTrackID);
    console.log("extractIndexedMisbCSV: extracted MISB length ", extractedMisb.length);
    return extractedMisb;
}


class CTrackManager extends CManager {

    constructor() {
        super();
        this.usedShortNames = new Set(); // Track all used short names for uniqueness
    }


// given a source file id:
// first create a CNodeTimedData from whatever type of data it is (KML, SRT, etc)
// the create a track node from that
// Note, the track node might be recalculated, as it depends on the global start time
//
// sourceFile = the input, either a KLM file, or one already in MISB array format
// if it's a kml file we will first make a MISB array
// dataID = the id of the intermediate CNodeMISBDataTrack
    makeMISBDataTrack(sourceFile, dataID, trackIndex = 0) {
        const fileInfo = FileManager.getInfo(sourceFile);
        const ext = getFileExtension(fileInfo.filename);

        let misb = null;

        if (ext === "json") {
            const geo = new CGeoJSON();
            geo.json = FileManager.get(sourceFile);
            misb = geo.toMISB(trackIndex);
        } else if (ext === "kml") {
            misb = KMLToMISB(FileManager.get(sourceFile), trackIndex);
        } else if (ext === "srt" || ext === "klv") {
            misb = FileManager.get(sourceFile);
        } else if (ext === "csv") {
            const complexMisb = FileManager.get(sourceFile);
            misb = extractIndexedMisbCSV(complexMisb, trackIndex)
        } else {
            assert(0, "Unknown file type: " + fileInfo.filename);
        }

        if (!misb) {
            console.warn("makeMISBDataTrack: No data in file:", sourceFile);
            return false;
        }

        if (misb.length <= 1) {
            console.warn("makeMISBDataTrack: Insufficient data in file:", sourceFile, " misb length:", misb.length);
            return false;
        }

        new CNodeMISBDataTrack({
            id: dataID,
            misb: misb,
            exportable: true,
        });

        return true;
    }

    makeTrackFromMISBData(sourceFile, dataID, trackID, columns, guiFolder = null) {
        const fileInfo = FileManager.getInfo(sourceFile);
        const frameRelativeTime = (fileInfo.dataType === "CUSTOM_FLL");

        // right now we only smooth the track if it's a custom situation
        // otherwise we just use the raw interpolated data
        if (Sit.name !== "custom") {
            return new CNodeTrackFromMISB({
                id: trackID,
                misb: dataID,
                columns: columns,
                exportable: true,
            });
        }

        // we want to smooth the track
        // so first create an unsmoothed node (same as above, but with a different id)
        const unsmoothed = new CNodeTrackFromMISB({
            id: trackID + "_unsmoothed",
            misb: dataID,
            columns: columns,
            exportable: true,
            pruneIfUnused: true,
            frameRelativeTime: frameRelativeTime,
        });

        new CNodeGUIValue({
            id: trackID + "_smoothValue",
            value: 0,
            start: 0,
            end: 200,
            step: 1,
            desc: "Smoothing window",
        }, guiFolder);

        return new CNodeSmoothedPositionTrack({
            id: trackID,
            source: trackID + "_unsmoothed",
            method: "moving",
            window: trackID + "_smoothValue",
            copyData: true,
            exportable: false,
        });
    }

    makeTrackFromDataFile(sourceFile, dataID, trackID, columns, trackIndex = 0, guiFolder = null) {
        if (!this.makeMISBDataTrack(sourceFile, dataID, trackIndex)) {
            return false;
        }

        return this.makeTrackFromMISBData(sourceFile, dataID, trackID, columns, guiFolder);
    }


// tracks = array of filenames of files that have been loaded and that
// we want to make tracks from
    addTracks(trackFiles, removeDuplicates = false, sphereMask = LAYER.MASK_HELPERS) {

        let settingSitchEstablished = false;


        console.log("-----------------------------------------------------")
        console.log("addTracks called with ", trackFiles)
        console.log("-----------------------------------------------------")

        // if we are adding tracks, then we need to add a scale for the target sphere
        if (!NodeMan.exists("sizeTargetScaled")) {
            new CNodeScale("sizeTargetScaled", scaleF2M,
                new CNodeGUIValue({
                    value: Sit.targetSize,
                    start: 10,
                    end: 20000,
                    step: 0.1,
                    desc: "Target Sphere size ft"
                }, guiMenus.objects)
            )
        }

        for (const trackFileName of trackFiles) {
            ////////////////////////////////////////////////////


            // an individual file might have multiple tracks
            // for example the ADSB-Exchange files can have an array of tracks
            // to handle this we pass in an index to the parsing function


            let moreTracks = true;
            let trackIndex = 0;
            while (moreTracks) {

                console.log("------------------------------------")
                console.log("Adding track index = ", trackIndex)
                console.log("------------------------------------")

                // most of the time there's only one track in a file
                // the exception is the ADSB-Exchange files, which have an array of tracks
                // the parsing for that will decide if there are more tracks
                moreTracks = false;


                const __ret = this.findShortName(trackFileName, trackIndex, moreTracks);
                let shortName = __ret.shortName;
                moreTracks = __ret.moreTracks;

                const trackDataID = "TrackData_" + shortName;
                const trackID = "Track_" + shortName;
                //let hasAngles = false;
                let hasFOV = false;
                let hasCenter = false;
                console.log("Creating track with trackID", shortName, "in addTracks")




                // removeDuplicates will be true if it's, for example, loaded via drag-and-drop
                // where the user might drag in the same file(s) twice
                // so if it exists, we call disposeRemove to free any buffers, and remove it from the manager
                // so then we can just reload it again
                let trackColor = null; // Declare trackColor variable
                if (removeDuplicates) {
                    // iterate over the tracks and find if there is one that has the same filename
                    // in trackFileName
                    TrackManager.iterate((key, trackOb) => {
                        if (trackOb.trackID === trackID) {

                            trackColor = trackOb.trackColor; // keep the color of the existing track

                            // remove it from the track manager
                            TrackManager.disposeRemove(key);

                        }
                    })
                }

                const guiFolder = guiMenus.contents.addFolder(trackID);
                // just use the default MISB Columns, so no columns are specified
                //const success = this.makeTrackFromDataFile(trackFileName, trackDataID, trackID, undefined, trackIndex, guiFolder);

                const success = this.makeMISBDataTrack(trackFileName, trackDataID, trackIndex);

                if (success) {

                    // add to the "Sync Time to" menu
                    GlobalDateTimeNode.addSyncToTrack(trackDataID);
                    // and call it to sync the time. Note we do this BEFORE we create the actual tracks
                    // to ensure we have the correct start time, and hence we can get good track positions for use
                    // with determining the initial terrain
                    if (!Globals.sitchEstablished) {
                        GlobalDateTimeNode.syncStartTimeTrack();
                    }

                    this.makeTrackFromMISBData(trackFileName, trackDataID, trackID, undefined, guiFolder);

                    const trackNode = NodeMan.get(trackID);
                    const trackDataNode = NodeMan.get(trackDataID);
                    // this has the original data in common MISB format, regardless of the data type
                    // actual MISB (and possibly other CSV inputs) might have a center track
                    //
                    const misb = trackDataNode.misb;

                    // Create the track object
                    const trackOb = TrackManager.add(trackID, new CMetaTrack(trackFileName, trackDataNode, trackNode));
                    trackOb.trackID = trackID;
                    trackOb.menuText = shortName;
                    trackNode.shortName = shortName;
                    trackDataNode.shortName = shortName;

                    // track folder in Contents menu
                    trackOb.guiFolder = guiFolder;


                    const dummy = {
                        removeTrack : () => {
                            // remove the track from the TrackManager
                            TrackManager.disposeRemove(trackID);
                        }
                    }

                    // add a remove button to the folder
                    trackOb.guiFolder.add(dummy, "removeTrack").name("Remove Track");



                    // how many tracks are there now?
                    const trackNumber = TrackManager.size();
                    const trackColors = [
                        new Color(1, 0, 0),
                        new Color(0, 1, 0),
                        new Color(0, 0, 1),
                        // new Color(1, 1, 0), skip yellow as it's the traverse color
                        new Color(1, 0, 1),
                        new Color(0, 1, 1),
                        new Color(0.5, 0, 0),
                        new Color(0, 0.5, 0),
                        new Color(0, 0, 0.5),
                        new Color(0.5, 0.5, 0),
                        new Color(0, 0.5, 0.5),
                        new Color(0.5, 0, 0.5),
                    ];

                    if (trackColor === null) {
                        trackColor = trackColors[trackNumber % trackColors.length];
                    }
                    // make dropcolor be the same as the track color bur reduced in brightness to 75%
                    const dropColor = trackColor.clone().multiplyScalar(0.75);

                    trackOb.trackColor = trackColor;

                    // This track will include FOV and angles
                    // but if there's a center track, we make a separate track for that
                    // in data it looks like
                    // targetTrack: {
                    //     kind: "TrackFromMISB",
                    //         misb: "cameraTrackData",
                    //         columns: ["FrameCenterLatitude", "FrameCenterLongitude", "FrameCenterElevation"]
                    // },


                    let centerID = null;
                    if (misb[0][MISB.FrameCenterLatitude] !== undefined && misb[0][MISB.FrameCenterLatitude] !== null) {
                        hasCenter = true;

                        const centerDataID = "CenterData_" + shortName;
                        centerID = "Center_" + shortName;
                        // const centerTrack = new CNodeTrackFromMISB({
                        //     id: centerTrackID,
                        //     misb: trackDataNode,
                        //     columns: ["FrameCenterLatitude", "FrameCenterLongitude", "FrameCenterElevation"],
                        //     exportable: true,
                        // })

                        this.makeTrackFromDataFile(trackFileName, centerDataID, centerID,
                            ["FrameCenterLatitude", "FrameCenterLongitude", "FrameCenterElevation"]);

                        trackOb.centerDataNode = NodeMan.get(centerDataID);
                        trackOb.centerNode = NodeMan.get(centerID);


                    }


                    let hasAngles = this.updateDropTargets(trackNumber, shortName, trackID, centerID, trackDataID, trackNode, hasFOV, trackOb);

                    this.makeMotionTrack(trackOb, shortName, trackColor, dropColor, trackID);
                    this.makeAnyCenterTrack(centerID, trackOb, shortName);


                    this.centerOnTrack(shortName, trackNumber, trackOb, hasCenter, hasAngles);

                    // if there's more than one track loaded, or there's a center track, then flag to set setSitchEstablished(true) after the track is processed
                    if (trackNumber > 0 || hasCenter) {
                        settingSitchEstablished = true;
                    }


                    trackOb.gui = new CNodeTrackGUI({
                        id: trackID + "_GUI",
                        metaTrack: trackOb,
                    })
                } else {
                    // if we failed to make the track, then remove the folder
                    // (nothing will have been added to it)
                    guiFolder.destroy();
                }

                trackIndex++;
            }


        } // and go to the next track

        if (settingSitchEstablished) {
            setSitchEstablished(true);
        }

        // we've loaded some tracks, and set stuff up, so ensure everything is calculated
        NodeMan.recalculateAllRootFirst()
        setRenderOne(true);

    }


    makeMotionTrack(trackOb, shortName, trackColor, dropColor, trackID) {
        // diplay the full track data as imported
        trackOb.trackDisplayDataNode = new CNodeDisplayTrack({
            id: "TrackDisplayData_" + shortName,
            track: "TrackData_" + shortName,
            color: new CNodeConstant({
                id: "colorData_" + shortName,
                value: new Color(trackColor),
                pruneIfUnused: true
            }),
            dropColor: dropColor,

            width: 0.5,
            //  toGround: 1, // spacing for lines to ground
            ignoreAB: true,
            layers: LAYER.MASK_HELPERS,
            skipGUI: true,
            trackDisplayStep: 1, // display every point in the track, as this is original data

        })

        // Display the shorter segment of the track that matches the Sitch duration
        // using a thicker line and a brighter color
        trackOb.trackDisplayNode = new CNodeDisplayTrack({
            id: "TrackDisplay_" + shortName,
            track: "Track_" + shortName,
            dataTrack: "TrackData_" + shortName,
            dataTrackDisplay: "TrackDisplayData_" + shortName,
            color: new CNodeConstant({
                id: "colorTrack_" + shortName,
                value: new Color(trackColor),
                pruneIfUnused: true
            }),
            width: 2,
            //  toGround: 1, // spacing for lines to ground
            ignoreAB: true,
            layers: LAYER.MASK_HELPERS,
            trackDisplayStep: 10, // display every 10th point in the track as this is per-frame

        })

        // link back to here as the visiblity menue is hooked up to TrackDisplay_<shortName>
        trackOb.trackDisplayNode.metaTrack = trackOb;


        //    trackOb.displayTargetSphere = new CNodeDisplayTargetSphere({
        //        id: trackOb.shortName+"_ob",
        //        inputs: {
        //            track: trackOb.trackNode,
        // //           size: "sizeTargetScaled",
        //        },
        //        color: [1, 0, 1],
        //        layers: sphereMask,
        //        wireframe: true,
        //
        //    })


        const sphereId = trackOb.menuText ?? shortName;


        if (process.env.DEFAULT_PLATFORM_MODEL && trackOb.trackFileName.endsWith(".klv")) {

            // check if in the ModelFiles object, and use it if available
            if (ModelFiles[process.env.DEFAULT_PLATFORM_MODEL]) {
                trackOb.displayTargetSphere = new CNode3DObject({
                    id: sphereId + "_ob",
                    model: process.env.DEFAULT_PLATFORM_MODEL,

                    label: shortName,
                })
            }
        }

        // if we didn't make a model, then we use a default sphere
        if (!trackOb.displayTargetSphere)
        {

            trackOb.displayTargetSphere = new CNode3DObject({
                id: sphereId + "_ob",
                object: "sphere",
                radius: 40,
                color: trackColor,
                label: shortName,

            });
        }

        trackOb.displayTargetSphere.addController("TrackPosition", {
            //   id: trackOb.shortName+"_controller",
            sourceTrack: trackID,
        });

        trackOb.displayTargetSphere.addController("ObjectTilt", {
            track: trackID,
            tiltType: "banking",
            //                 wind: "targetWind" // NOT ALL SITCHES HAVE THIS
        })
    }

    makeAnyCenterTrack(centerID, trackOb, shortName) {
        if (centerID !== null) {

            trackOb.displayCenterDataNode = new CNodeDisplayTrack({
                id: "CenterDisplayData_" + shortName,
                track: "CenterData_" + shortName,
                color: new CNodeConstant({
                    id: "colorCenterData_" + shortName,
                    value: new Color(0, 1, 0),
                    pruneIfUnused: true
                }),
                width: 0.5,
                //  toGround: 1, // spacing for lines to ground
                ignoreAB: true,
                layers: LAYER.MASK_HELPERS,
                skipGUI: true,


            })

            trackOb.displayCenterNode = new CNodeDisplayTrack({
                id: "CenterDisplay_" + shortName,
                track: centerID,
                dataTrackDisplay: "CenterDisplayData_" + shortName,
                color: new CNodeConstant({
                    id: "colorCenter_" + shortName,
                    value: new Color(1, 1, 0),
                    pruneIfUnused: true
                }),
                width: 3,
                //  toGround: 1, // spacing for lines to ground
                ignoreAB: true,
                layers: LAYER.MASK_HELPERS,

            })

        }
    }

    centerOnTrack(shortName, trackNumber, trackOb, hasCenter, hasAngles) {
        console.log("Considering setup options for track: ", shortName, " number ", trackNumber)
        console.log("Sit.centerOnLoadedTracks: ", Sit.centerOnLoadedTracks, " Globals.dontAutoZoom: ", Globals.dontAutoZoom, " Globals.sitchEstablished: ", Globals.sitchEstablished)


        if (Sit.centerOnLoadedTracks && !Globals.dontAutoZoom && !Globals.sitchEstablished) {


            console.log("Centering on loaded track ", shortName)

            // maybe adjust the main view camera to look at the center of the track
            const mainCameraNode = NodeMan.get("mainCamera");
            const mainCamera = mainCameraNode.camera;
            const mainView = NodeMan.get("mainView");
            const bbox = trackBoundingBox(trackOb.trackDataNode);
//                    console.log(`Track ${shortName} bounding box: ${bbox.min.x}, ${bbox.min.y}, ${bbox.min.z} to ${bbox.max.x}, ${bbox.max.y}, ${bbox.max.z}`)
            const center = bbox.min.clone().add(bbox.max).multiplyScalar(0.5);
            // get point on sphere
            const ground = pointOnSphereBelow(center);
            // what's the length of the diagonal of the bounding box?
            const diagonal = bbox.max.clone().sub(bbox.min).length();

            const hfov = mainView.getHFOV();
            // we want the camera height be enough to encompass the diagonal across the hfov
            const cameraHeight = (diagonal * 1.25) / (2 * Math.tan(hfov / 2));


            // move the camera up by the cameraHeight
            const up = getLocalUpVector(ground);
            const cameraTarget = ground.clone().add(up.clone().multiplyScalar(cameraHeight));
            // and move south by  the cameraHeight
            const south = getLocalSouthVector(ground);
            cameraTarget.add(south.clone().multiplyScalar(cameraHeight));
            mainCamera.position.copy(cameraTarget);

            // set the up vector to the local up vector
            mainCamera.up.copy(up);

            // and look at the ground point
            mainCamera.lookAt(ground);

            // since we've set the camera default postion for this track, store it
            // so calling mainCameraNode.resetCamera() will use these new values

            mainCameraNode.snapshotCamera();


            // // first get LLA versions of the EUS values cameraTarget and ground
            // const cameraTargetLLA = EUSToLLA(cameraTarget);
            // const groundLLA = EUSToLLA(ground);
            // // then store them in the mainCamera node
            // mainCameraNode.startPosLLA = cameraTargetLLA;
            // mainCameraNode.lookAtLLA = groundLLA;


            // If this is not the first track, then find the time of the closest intersection.
            const track0 = TrackManager.getByIndex(0);
            if (track0 !== trackOb) {
                let time = closestIntersectionTime(track0.trackDataNode, trackOb.trackDataNode);
                console.log("Closest intersection time: ", time);

                // we want this in the middle, so subtract half the Sit.frames

                //    time -= Math.floor(Sit.frames*Sit.fps*1000);

                GlobalDateTimeNode.setStartDateTime(time);
                GlobalDateTimeNode.recalculateCascade();
                setRenderOne(true);

                // and make the 2nd track the target track if we have a targetTrackSwitch
                if (NodeMan.exists("targetTrackSwitch")) {
                    // console.log("Setting Target Track to ", trackOb.menuText, " and Camera Track to ", track0.menuText)
                    // const targetTrackSwitch = NodeMan.get("targetTrackSwitch");
                    // targetTrackSwitch.selectOption(trackOb.menuText);
                    //
                    // // and make the camera track switch use the other track.
                    // const cameraTrackSwitch = NodeMan.get("cameraTrackSwitch");
                    // cameraTrackSwitch.selectOption(track0.menuText);
                    //
                    // // and set the traverse mode to target object
                    // const traverseModeSwitch = NodeMan.get("LOSTraverseSelectTrack");
                    // traverseModeSwitch.selectOption("Target Object");
                    //
                    // // second track, so we assume we want to focus on this target
                    // // so we are setting the "Camera Heading"  to "To Target" (from "Use Angles")
                    // const headingSwitch = NodeMan.get("CameraLOSController", true);
                    // if (headingSwitch) {
                    //     headingSwitch.selectOption("To Target");
                    // }


                }

                // and since we have an intersection, zoomTo it if there's a TerrainModel
                if (NodeMan.exists("terrainUI")) {
                    let terrainUINode = NodeMan.get("terrainUI")
                    terrainUINode.zoomToTrack(trackOb.trackNode);
                }


            } else {
                console.log("FIRST TRACK LOADED, setting initial terrain")
                console.log("ALSO setting camera heading to use angles")


                // this is the first track loaded.
                // so just center on this track
                if (NodeMan.exists("terrainUI")) {
                    let terrainUINode = NodeMan.get("terrainUI")
                    terrainUINode.zoomToTrack(trackOb.trackNode);
                }



                // if it's a simple track with no center track and no angles (i.e. not MISB)
                // then switch to "Use Angles" for the camera heading
                // which will use the PTZ control as no angles track will be loaded yet

                if (!hasCenter && !hasAngles) {

                    // first simple track, so just use angles
                    // which will point the camera in a fixed direction
                    const headingSwitch = NodeMan.get("CameraLOSController", true);
                    if (headingSwitch) {
                        headingSwitch.selectOption("Use Angles");
                    }

                }


            }

        }
    }

    updateDropTargets(trackNumber, shortName, trackID, centerID, trackDataID, trackNode, hasFOV, trackOb) {
        let hasAngles = false;
        if (Sit.dropTargets !== undefined && Sit.dropTargets["track"] !== undefined) {
            const dropTargets = Sit.dropTargets["track"]
            for (let dropTargetSwitch of dropTargets) {

                // if it ends with a - and a number, then we extract that number, called "selectNumber

                // we set the selectNumber to the track number by default
                // which means that it will always be selected
                // unless the dropTarget has a number at the end
                // in which case it will be selected only that's the same as the track number
                let selectNumber = trackNumber;
                const match = dropTargetSwitch.match(/-(\d+)$/);
                if (match !== null) {
                    selectNumber = Number(match[1]);
                    // strip off the last part
                    dropTargetSwitch = dropTargetSwitch.substring(0, dropTargetSwitch.length - match[0].length);

                }

                if (NodeMan.exists(dropTargetSwitch)) {
                    const switchNode = NodeMan.get(dropTargetSwitch);

//                            console.log("Adding track ", trackID, "  to drop target: ", dropTargetSwitch)

                    if (Sit.dropAsController) {
                        // NOT USED IN CUSTOM SITUATION (or anything other than SitNightSky)
                        // backwards compatibility for SitNightSky
                        // which expects dropped tracks to create a controller
                        switchNode.addOption(shortName, new CNodeControllerTrackPosition({
                            id: "TrackController_" + trackID,
                            sourceTrack: trackID,
                        }))
                        // and select it
                        if (trackNumber === selectNumber) {
                            switchNode.selectOption(shortName)
                        }
                    } else {
                        // drag and drop default now just adds the data source track, not a controller
                        // this is more flexible, as the user can then add a controller if they want
                        switchNode.removeOption(shortName)
                        switchNode.addOption(shortName, NodeMan.get(trackID))
                        // and select it (Quietly, as we don't want to zoom to it yet)
                        if (trackNumber === selectNumber && !Globals.sitchEstablished) {
                            switchNode.selectOptionQuietly(shortName)

                            // bit of a patch, this will be the second track, and we already set the
                            // camera to follow the first track and "Use Angles"
                            // but now we've added a target track, so we need to change the camera heading
                            // to "To Target" so the first track points at the second track
                            if (switchNode.id === "targetTrackSwitch") {
                                const headingSwitch = NodeMan.get("CameraLOSController", true);
                                if (headingSwitch) {
                                    headingSwitch.selectOption("To Target");
                                }
                            }
                        }
                        // if there's a center point track, make that as well
                        if (centerID !== null) {
                            const menuTextCenter = "Center " + shortName;
                            switchNode.removeOption(menuTextCenter)
                            switchNode.addOption(menuTextCenter, NodeMan.get(centerID))
                            // if it's being added to targetTrackSwitch then select it
                            if (switchNode.id === "targetTrackSwitch" && !Globals.sitchEstablished) {
                                switchNode.selectOption(menuTextCenter)
                            }
                        }

                    }


                    // // add to the "Sync Time to" menu
                    // GlobalDateTimeNode.addSyncToTrack(trackDataID);
                    // // and call it to sync the time
                    // // we don't need to recalculate from this track
                    // // as it's only just been loaded. ????????
                    // // Actually, we do, as the change in time will change the
                    // // position of the per-frame track segment and the display
                    // if (!Globals.sitchEstablished) {
                    //     GlobalDateTimeNode.syncStartTimeTrack();
                    //
                    //     // PROBLEM - at this point the track was calculated with the old time
                    //     // and the new time will change the position of the track
                    //
                    //     // it's all based on the trackDataNode
                    //    // trackOb.trackDataNode.checkDisplayOutputs = false;
                    //     trackOb.trackDataNode.recalculateCascade();
                    //
                    //     console.log("TrackManager: Updated trackDataNode for ", shortName, " with new time")
                    //
                    // }

                }
            }

            // If we are adding the track to a drop target
            // then also creat a Track Options menu for it, so the user can:
            // - change the color
            // - change the width
            // - toggle the display
            // - toggle distance and altitiude labels
            // - toggle the display of the target sphere
            // - edit the size of the target sphere
            // - toggle wireframe or solid
            // - change the sphere color
            // - toggle sunlight illumination
            // - add a model, like a 737, etc. Maybe even a custom local model?
            // - add a label

            // perhaps we need a track manager to keep track of all the tracks

            // HERE WE ARE!!!!
        }

        // if the track had FOV data, and there's an fov drop target, then add it
        //
        let value = trackNode.v(0);
        if (typeof value === "string") {
            value = Number(value);
        }

        if (typeof value === 'number' && !isNaN(value)) {
            hasFOV = true;
        } else if (value.misbRow !== undefined
            && value.misbRow[MISB.SensorVerticalFieldofView] !== null
            && value.misbRow[MISB.SensorVerticalFieldofView] !== undefined
            && !isNaN(Number(value.misbRow[MISB.SensorVerticalFieldofView]))) {
            hasFOV = true;
        } else if (value.vFOV !== undefined) {
            hasFOV = true;
        }


        if (hasFOV && Sit.dropTargets !== undefined && Sit.dropTargets["fov"] !== undefined) {
            const dropTargets = Sit.dropTargets["fov"]
            for (const dropTargetSwitch of dropTargets) {
                if (NodeMan.exists(dropTargetSwitch)) {
                    const switchNode = NodeMan.get(dropTargetSwitch);
                    switchNode.removeOption(trackID)
                    switchNode.addOption(trackID, NodeMan.get(trackID))
                    if (!Globals.sitchEstablished) {
                        switchNode.selectOption(trackID)
                    }
                }
            }
        }

        // same type of thing for heading angles
        if (value.misbRow !== undefined && typeof value.misbRow[MISB.PlatformPitchAngle] === 'number' && !isNaN(value.misbRow[MISB.PlatformPitchAngle])) {
            hasAngles = true;
        }

        //
        if (hasAngles && Sit.dropTargets !== undefined && Sit.dropTargets["angles"] !== undefined) {
            let data = {
                id: trackID + "_LOS",
                smooth: 120, // maybe GUI this?
            }
            let anglesNode = makeLOSNodeFromTrackAngles(trackID, data);
            trackOb.anglesNode = anglesNode;
            let anglesID = "Angles_" + shortName;
            let anglesController = new CNodeControllerMatrix({
                id: anglesID,
                source: anglesNode,
            })
            trackOb.anglesController = anglesController;

            const lookCamera = NodeMan.get("lookCamera");
            lookCamera.addControllerNode(anglesController)

            const dropTargets = Sit.dropTargets["angles"]
            for (const dropTargetSwitch of dropTargets) {
                if (NodeMan.exists(dropTargetSwitch)) {
                    const switchNode = NodeMan.get(dropTargetSwitch);
                    switchNode.removeOption(anglesID)
                    switchNode.addOption(anglesID, NodeMan.get(anglesID))
                    if (!Globals.sitchEstablished) {
                        switchNode.selectOption(anglesID)
                    }
                }
            }
        }

        let hasWind = false;
        // and for wind speed and direction
        if (value.misbRow !== undefined && typeof value.misbRow[MISB.WindSpeed] === 'number' && !isNaN(value.misbRow[MISB.WindSpeed])) {
            hasWind = true;
        }

        if (hasWind && Sit.dropTargets !== undefined && Sit.dropTargets["wind"] !== undefined) {

            // TODO - make a wind data node from this track
            // shoudl return heading and speed

            const dropTargets = Sit.dropTargets["wind"]
            for (const dropTargetSwitch of dropTargets) {
                if (NodeMan.exists(dropTargetSwitch)) {

                    // THEN ADD IT TO THE DROP TARGET

                    // BUT WHAT ABOUT MANUAL WIND?
                    // WE"D NEED A WIND NODE THAT RETURNS MANUAL WIND
                    // So we need to add a manual wind node
                    // need to handlge local, and target wind, and the locking

                }
            }
        }
        return hasAngles;
    }

    findShortName(trackFileName, trackIndex, moreTracks) {
        // try to find the flight number as a shorter name
        // For check for format like: FlightAware_DAL2158_KCHS_KBOS_20230218.kml
        let shortName = trackFileName
        if (trackIndex > 0) {
            // additional tracks will have a _1, _2, etc added to the name
            // in case the short name (i.e the plane's tail number) is not found
            shortName += "_" + trackIndex;
        }
        let found = false;

        // if it's a KML file, then we might have the flight number in the data
        // check there first, which gives more flexibility in filenames (which might get changed by the user, or the system)

        const ext = getFileExtension(trackFileName);
        if (ext === "kml") {
            const kml = FileManager.get(trackFileName);

            // adsbX flight number will be in
            // kml.kml.Folder.Folder.name in the format "Flightnumber track"
            // so first check that exits, along with intermedia objects
            // kml is NOT an array, so we need to check for the existence of the object
            if (kml.kml !== undefined && kml.kml.Folder !== undefined && kml.kml.Folder.Folder !== undefined
            ) {

                let indexedTrack = kml.kml.Folder.Folder;
                // is it an array?
                if (Array.isArray(indexedTrack)) {
                    // first check if there's more data after this
                    // so we can set moreTracks to true
                    if (kml.kml.Folder.Folder[trackIndex + 1] !== undefined) {
                        moreTracks = true;
                    }
                    indexedTrack = indexedTrack[trackIndex];
                    // make a dummy short name with the index
                    shortName = trackFileName + "_" + trackIndex;
                    found = true;
                    // We are default to the filename, and it's typically long and confusing
                    // This should not happen, and we might want to address it if it arises
                }

                if (indexedTrack.name !== undefined) {
                    let match = indexedTrack.name['#text'].match(/([A-Z0-9\-]+) track/);

                    // backwards compatability for the old format which did not allow for - in the flight number
                    if (!Sit.allowDashInFlightNumber) {
                        match = indexedTrack.name['#text'].match(/([A-Z0-9]+) track/);
                    }

                    if (match !== null) {
                        shortName = match[1];
                        found = true;
                    }
                }

                console.log("KML track short name: ", shortName, " index: ", trackIndex)

            }

            if (!found) {
                if (kml.kml !== undefined
                    && kml.kml.Document !== undefined
                    && kml.kml.Document.name !== undefined
                    && kml.kml.Document.name['#text'] !== undefined) {
                    // example: FlightAware ✈ RYR5580 15-Oct-2022 (EDI / EGPH-ALC / LEAL)
                    // so we want the RYR5580 part
                    const name = kml.kml.Document.name['#text'];

                    const match = name.match(/FlightAware ✈ ([A-Z0-9]+) /);
                    if (match !== null) {
                        shortName = match[1];
                        found = true;
                    } else {
                        // another format is like:
                        // "DL4113/SKW4113"
                        // check to see if we have an alphanumeric string followed by a slash then another alphanumeric string
                        // and use the first one if so
                        const match = name.match(/([A-Z0-9]+)\/[A-Z0-9]+/);
                        if (match !== null) {
                            shortName = match[1];
                            found = true;
                        } else {
                            // just use the Document name
                            shortName = name;
                            found = true;
                        }
                    }
                }
            }

        }

        if (ext === "json") {
            const geo = new CGeoJSON();
            geo.json = FileManager.get(trackFileName);
            shortName = geo.shortTrackIDForIndex(trackIndex);
            found = true; // flag that we found a short name

            // check if there are more tracks (telling us to loop again)
            const numTracks = geo.countTracks();
            if (trackIndex < numTracks - 1) {
                moreTracks = true;
            }

        }

        // Handle complex CSV files with multiple tracks
        if (ext === "csv") {
            const complexMisb = FileManager.get(trackFileName);
            
            if (complexMisb && complexMisb.length > 0) {
                // Get track information
                const trackInfo = getCSVTrackInfo(complexMisb);
                const numTracks = trackInfo.count;
                const trackIDArray = trackInfo.trackIDArray;
                
                console.log(`CSV file contains ${numTracks} unique track(s)`);
                
                // Check if there are more tracks after this one
                if (trackIndex < numTracks - 1) {
                    moreTracks = true;
                }
                
                // If we have multiple tracks or explicit index, extract the specific track
                if (numTracks > 1 || trackIndex > 0) {
                    if (trackIndex < numTracks) {
                        const trackID = trackIDArray[trackIndex];
                        // Filter to get rows for this track to check for tail number
                        const trackRows = complexMisb.filter(row => row[MISB.TrackID] === trackID);
                        
                        if (trackRows.length > 0) {
                            // Try to use tail number as short name
                            const tailNumber = trackRows[0][MISB.PlatformTailNumber];
                            if (tailNumber !== null && tailNumber !== undefined && tailNumber !== "") {
                                shortName = tailNumber;
                                console.log(`Using tail number as short name: ${shortName}`);
                            } else {
                                // Use the trackID as short name
                                shortName = trackID;
                                console.log(`Using trackID as short name: ${shortName}`);
                            }
                            found = true;
                        }
                    } else {
                        console.warn(`CSV trackIndex ${trackIndex} out of range (${numTracks} tracks available)`);
                    }
                }
                // If single track, continue to default handling below
            }
        }

        if (!found) {
            const match = trackFileName.match(/FlightAware_([A-Z0-9]+)_/);
            if (match !== null) {
                shortName = match[1];
            } else {
                // check for something like N121DZ-track-EGM96.kml
                const match = trackFileName.match(/([A-Z0-9]+)-track-/);
                if (match !== null) {
                    shortName = match[1];
                } else {
                    // check if this has MISB data, and if so, use the platform tail
                    // if (misb[0][MISB.PlatformTailNumber] !== undefined) {
                    //     shortName = misb[0][MISB.PlatformTailNumber];
                    // }
                    // get the file from the file manager

                    // is it a misb file?
                    if (ext === "srt" || ext === "csv" || ext === "klv") {
                        const misb = FileManager.get(trackFileName)

                        assert(misb, `Misb file ${trackFileName} not found when expected in findShortName`)

                        assert(misb[0] !== undefined, `Misb file ${trackFileName} does not contain data when expected in findShortName`)

                        if (misb[0][MISB.PlatformTailNumber] !== null) {
                            shortName = misb[0][MISB.PlatformTailNumber];
                        } else {
                            // MISB, but can't find a tail number, so just use the filename without the extension
                            shortName = trackFileName.replace(/\.[^/.]+$/, "");
                        }

                    } else {
                        // some KLM files are like
                        // DL4113-3376e834.kml
                        // so we just want the DL4113 part
                        // but we need to check first to see if it:
                        // alphanum hexnum.kml
                        const match = trackFileName.match(/([A-Z0-9]+)-[0-9a-f]+\.kml/);
                        if (match !== null) {
                            shortName = match[1];
                        } else {
                            // not a misb file, but no filename format found
                            // just use the filename without the extension
                            shortName = trackFileName.replace(/\.[^/.]+$/, "");
                        }

                    }

                }
            }
        }
        
        // Limit short name to 10 characters
        // shortName = shortName.substring(0, 10);
        //
        // // Ensure uniqueness by adding a number if duplicate
         let uniqueShortName = shortName;
        // let counter = 1;
        // while (this.usedShortNames.has(uniqueShortName)) {
        //     uniqueShortName = shortName + counter;
        //     counter++;
        // }
        //
        // // Store the unique short name
        // this.usedShortNames.add(uniqueShortName);
        
        return {shortName: uniqueShortName, moreTracks};
    }

    /**
     * Add a synthetic (user-created) track to the TrackManager
     * @param {Object} options - Track creation options
     * @param {Vector3} options.startPoint - Starting point in EUS coordinates
     * @param {string} options.name - Optional name for the track
     * @param {string} options.objectID - Optional 3D object to associate with track
     * @param {boolean} options.editMode - Whether to start in edit mode (default: true)
     * @param {string} options.curveType - Type of curve: "linear", "catmull", "chordal", "centripetal" (default: "chordal")
     * @param {number} options.color - Track color as hex (default: 0xffff00)
     * @param {number} options.lineWidth - Track line width (default: 2)
     * @param {number} options.startFrame - Frame number for the initial point (default: 0)
     * @returns {Object} The created track object
     */
    addSyntheticTrack(options) {
        const trackNumber = this.size();
        const name = options.name || `Track ${trackNumber + 1}`;
        const curveType = options.curveType || "chordal";
        const editMode = options.editMode !== undefined ? options.editMode : true;
        const colorHex = options.color || 0xffff00;
        const lineWidth = options.lineWidth || 2;
        const startFrame = options.startFrame !== undefined ? options.startFrame : 0;
        
        // Generate unique short name for display (like "synth_01_d")
        const shortName = `synth_${String(trackNumber + 1).padStart(2, '0')}_d`;
        
        // Use provided IDs if available (for deserialization), otherwise generate new ones
        const trackID = options.trackID || `syntheticTrack_${Date.now()}`;
        const displayTrackID = options.displayTrackID || `syntheticTrackDisplay_${Date.now()}`;
        
        // Get the main view ID
        const viewID = "mainView";
        const view = NodeMan.get(viewID);
        if (!view) {
            console.error("TrackManager.addSyntheticTrack: No view found");
            return null;
        }
        
        const scene = view.scene;
        if (!scene) {
            console.error("TrackManager.addSyntheticTrack: View has no scene");
            return null;
        }

        // Prepare initial points - CNodeSplineEditor expects [frame, x, y, z] format
        const initialPoints = [];
        if (options.startPoint) {
            const sp = options.startPoint;
            initialPoints.push([startFrame, sp.x, sp.y, sp.z]);
        }
        
        // Smart fallback: Use linear interpolation if we don't have enough points for spline curves
        let effectiveCurveType = curveType;
        if (initialPoints.length < 4 && curveType !== "linear") {
            effectiveCurveType = "linear";
            console.log(`TrackManager: Using linear interpolation (only ${initialPoints.length} point(s), need 4 for ${curveType})`);
        }
        
        // Create GUI folder in Contents menu using the DISPLAY TRACK ID
        // This is important: CNodeDisplayTrack will look for a folder with this.in.track.id
        // So we create the folder with trackID, which is what the display track will reference
        // IMPORTANT: Don't change the folder title yet! getFolder() looks up by innerText,
        // so we need to keep it as trackID until after CNodeDisplayTrack finds it
        const guiFolder = guiMenus.contents.addFolder(trackID);
        
        // Create spline editor node (the data track)
        // Pass skipGUI: true to prevent it from creating its own GUI in physics menu
        const splineEditorNode = new CNodeSplineEditor({
            id: trackID,
            type: effectiveCurveType,
            scene: scene,
            camera: "mainCamera",
            view: viewID,
            frames: Sit.frames,
            initialPoints: initialPoints,
            skipGUI: true, // Don't create GUI in physics menu
        });
        
        splineEditorNode.menuText = name;
        const splineEditor = splineEditorNode.splineEditor;
        
        // Convert hex color to RGB array for display track
        const trackColor = new Color(
            ((colorHex >> 16) & 0xff) / 255,
            ((colorHex >> 8) & 0xff) / 255,
            (colorHex & 0xff) / 255
        );
        
        // Create display track for visualization
        // Don't use skipGUI - let it create its controls in the folder we just created
        // It will find the folder by looking up this.in.track.id (which is trackID)
        const displayTrack = new CNodeDisplayTrack({
            id: displayTrackID,
            track: trackID,
            color: new CNodeConstant({
                id: "colorSynthetic_" + trackID,
                value: trackColor,
                pruneIfUnused: true
            }),
            width: lineWidth,
            extendToGround: true, // Synthetic tracks extend to ground by default
            // skipGUI: false (default) - let it add controls to the folder
        });
        
        // NOW change the folder title to the short name
        // This must happen AFTER CNodeDisplayTrack has found the folder
        guiFolder.$title.innerText = shortName;
        
        // Create the track object first so we can reference it in the edit mode toggle
        const trackOb = this.add(trackID, new CMetaTrack(null, splineEditorNode, splineEditorNode));
        trackOb.trackID = trackID;
        trackOb.menuText = shortName;
        trackOb.isSynthetic = true;
        trackOb.splineEditor = splineEditor;
        trackOb.splineEditorNode = splineEditorNode;
        trackOb.displayTrack = displayTrack;
        trackOb.displayTrackID = displayTrackID;
        trackOb.guiFolder = guiFolder;
        trackOb.trackColor = trackColor;
        trackOb.curveType = curveType;
        trackOb.editMode = editMode; // Store initial edit mode state
        trackOb.constantSpeed = false; // Default to time-based interpolation
        trackOb.extrapolateTrack = true; // Default to extrapolating beyond control points
        trackOb.objectID = options.objectID || null; // Store associated object ID
        
        splineEditorNode.shortName = shortName;
        
        // Add edit mode checkbox to the GUI folder (before display track controls)
        // This checkbox controls whether the track is in edit mode
        guiFolder.add(trackOb, 'editMode').name('Edit Track').onChange((value) => {
            splineEditor.setEnable(value);
            
            // Set or clear the global editing track reference
            if (value) {
                // Disable edit mode on any other track that's currently being edited
                if (Globals.editingTrack && Globals.editingTrack !== trackOb) {
                    Globals.editingTrack.editMode = false;
                    Globals.editingTrack.splineEditor.setEnable(false);
                }
                Globals.editingTrack = trackOb;
                console.log(`Edit mode enabled for track: ${shortName}`);
            } else {
                if (Globals.editingTrack === trackOb) {
                    Globals.editingTrack = null;
                }
                console.log(`Edit mode disabled for track: ${shortName}`);
            }
        });
        
        // Sync constantSpeed from splineEditorNode (in case it was loaded from saved data)
        if (splineEditorNode.constantSpeed !== undefined) {
            trackOb.constantSpeed = splineEditorNode.constantSpeed;
        }
        
        // Sync extrapolateTrack from splineEditorNode (in case it was loaded from saved data)
        if (splineEditorNode.extrapolateTrack !== undefined) {
            trackOb.extrapolateTrack = splineEditorNode.extrapolateTrack;
        }
        
        // Add constant speed checkbox to the GUI folder
        // This checkbox controls whether the track uses constant speed interpolation
        guiFolder.add(trackOb, 'constantSpeed').name('Constant Speed').onChange((value) => {
            splineEditorNode.constantSpeed = value;
            splineEditorNode.recalculateCascade();
            console.log(`Constant speed ${value ? 'enabled' : 'disabled'} for track: ${shortName}`);
        });
        
        // Add extrapolate track checkbox to the GUI folder
        // This checkbox controls whether the track extrapolates beyond first/last control points
        guiFolder.add(trackOb, 'extrapolateTrack').name('Extrapolate Track').onChange((value) => {
            splineEditorNode.extrapolateTrack = value;
            splineEditorNode.recalculateCascade();
            console.log(`Extrapolate track ${value ? 'enabled' : 'disabled'} for track: ${shortName}`);
        });
        
        // Set initial edit mode state
        if (editMode) {
            splineEditor.setEnable(true);
            Globals.editingTrack = trackOb;
        }
        
        // Add delete button to the folder
        const dummy = {
            deleteTrack: () => {
                if (confirm(`Delete synthetic track "${shortName}"?`)) {
                    this.disposeSyntheticTrack(trackID);
                }
            }
        };
        guiFolder.add(dummy, "deleteTrack").name("Delete Track");
        
        // Add to drop targets if configured
        if (Sit.dropTargets !== undefined && Sit.dropTargets["track"] !== undefined) {
            const dropTargets = Sit.dropTargets["track"];
            for (let dropTargetSwitch of dropTargets) {
                // Strip off any -number suffix
                const match = dropTargetSwitch.match(/-(\d+)$/);
                if (match !== null) {
                    dropTargetSwitch = dropTargetSwitch.substring(0, dropTargetSwitch.length - match[0].length);
                }
                
                if (NodeMan.exists(dropTargetSwitch)) {
                    const switchNode = NodeMan.get(dropTargetSwitch);
                    switchNode.removeOption(shortName);
                    switchNode.addOption(shortName, splineEditorNode);
                }
            }
        }
        
        // Associate with object if provided
        if (options.objectID) {
            const objectNode = NodeMan.get(options.objectID);
            if (objectNode) {
                if (objectNode.inputs && objectNode.inputs.track !== undefined) {
                    objectNode.inputs.track = trackID;
                    objectNode.recalculateCascade();
                }
                console.log(`Associated object ${options.objectID} with track ${trackID}`);
            } else {
                console.warn(`Object ${options.objectID} not found`);
            }
        }
        
        // Enable edit mode if requested
        if (editMode) {
            splineEditor.setEnable(true);
        }
        
        console.log(`Created synthetic track: ${trackID} (${name})`);
        
        // Recalculate and render
        NodeMan.recalculateAllRootFirst();
        setRenderOne(true);
        
        return trackOb;
    }

    /**
     * Dispose a synthetic track
     * @param {string} trackID - ID of the track to delete
     */
    disposeSyntheticTrack(trackID) {
        const trackOb = this.get(trackID);
        if (!trackOb || !trackOb.isSynthetic) {
            console.warn(`Synthetic track ${trackID} not found`);
            return;
        }
        
        // Clear global editing track reference if this is the track being edited
        if (Globals.editingTrack === trackOb) {
            Globals.editingTrack = null;
        }
        
        // Disable edit mode first and dispose the spline editor
        if (trackOb.splineEditor) {
            trackOb.splineEditor.setEnable(false);
            // Dispose the spline editor to clean up the position indicator cone
            if (trackOb.splineEditor.dispose) {
                trackOb.splineEditor.dispose();
            }
        }
        
        // Remove from drop targets
        const shortName = trackOb.menuText;
        if (Sit.dropTargets !== undefined && Sit.dropTargets["track"] !== undefined) {
            const dropTargets = Sit.dropTargets["track"];
            for (let dropTargetSwitch of dropTargets) {
                const match = dropTargetSwitch.match(/-(\d+)$/);
                if (match !== null) {
                    dropTargetSwitch = dropTargetSwitch.substring(0, dropTargetSwitch.length - match[0].length);
                }
                
                if (NodeMan.exists(dropTargetSwitch)) {
                    const switchNode = NodeMan.get(dropTargetSwitch);
                    switchNode.removeOption(shortName);
                }
            }
        }
        
        // Remove GUI folder
        if (trackOb.guiFolder) {
            trackOb.guiFolder.destroy();
        }
        
        // Remove display track
        if (trackOb.displayTrackID) {
            NodeMan.unlinkDisposeRemove(trackOb.displayTrackID);
        }
        
        // Remove color constant
        NodeMan.unlinkDisposeRemove("colorSynthetic_" + trackID);
        
        // Remove spline editor node
        NodeMan.unlinkDisposeRemove(trackID);
        
        // Remove from manager
        this.remove(trackID);
        
        console.log(`Deleted synthetic track: ${trackID}`);
        
        // Recalculate and render
        NodeMan.recalculateAllRootFirst();
        setRenderOne(true);
    }

    /**
     * Serialize all synthetic tracks
     * This is called during the serialization process to save synthetic track metadata
     * @returns {Array} Array of synthetic track metadata objects
     */
    serialize() {
        const syntheticTracks = [];
        
        this.iterate((key, trackOb) => {
            if (trackOb.isSynthetic) {
                // Get the spline editor node to extract control points
                const splineEditorNode = NodeMan.get(trackOb.trackID);
                
                // Extract positions from the spline editor
                let positions = [];
                if (splineEditorNode && splineEditorNode.splineEditor) {
                    const editor = splineEditorNode.splineEditor;
                    if (editor.positions && editor.frameNumbers) {
                        for (let i = 0; i < editor.positions.length; i++) {
                            const p = editor.positions[i];
                            positions.push([editor.frameNumbers[i], p.x, p.y, p.z]);
                        }
                    }
                }
                
                // If there's an associated object, save its properties
                let objectData = null;
                if (trackOb.objectID) {
                    const objectNode = NodeMan.get(trackOb.objectID);
                    if (objectNode) {
                        objectData = {
                            id: trackOb.objectID,
                            geometry: objectNode.common.geometry, // Get the geometry type string from common
                            radius: objectNode.geometryParams.radius, // Get radius from geometryParams
                            color: objectNode.color, // Color is stored directly
                            material: objectNode.common.material, // Get the material type string from common
                        };
                    }
                }
                
                // Serialize the essential data needed to recreate the track
                const trackData = {
                    trackID: trackOb.trackID,
                    displayTrackID: trackOb.displayTrackID,
                    menuText: trackOb.menuText,
                    shortName: trackOb.trackNode?.shortName || trackOb.menuText,
                    curveType: trackOb.curveType,
                    editMode: trackOb.editMode,
                    constantSpeed: trackOb.constantSpeed,
                    extrapolateTrack: trackOb.extrapolateTrack,
                    // Store color as hex number
                    color: trackOb.trackColor ? 
                        (Math.round(trackOb.trackColor.r * 255) << 16) |
                        (Math.round(trackOb.trackColor.g * 255) << 8) |
                        Math.round(trackOb.trackColor.b * 255) : 0xffff00,
                    lineWidth: trackOb.displayTrack?.width || 2,
                    // Store control points from the spline editor
                    positions: positions,
                    // Store associated object data if any
                    objectData: objectData,
                };
                
                syntheticTracks.push(trackData);
                console.log(`Serialized synthetic track: ${trackOb.trackID}`);
            }
        });
        
        return syntheticTracks;
    }

    /**
     * Deserialize synthetic tracks
     * This is called early in the deserialization process to recreate synthetic tracks
     * BEFORE mods are applied to the nodes
     * @param {Array} syntheticTracksData - Array of synthetic track metadata objects
     */
    deserialize(syntheticTracksData) {
        if (!syntheticTracksData || syntheticTracksData.length === 0) {
            console.log("No synthetic tracks to deserialize");
            return;
        }
        
        console.log(`Deserializing ${syntheticTracksData.length} synthetic track(s)`);
        
        for (const trackData of syntheticTracksData) {
            try {
                // Extract the first position to use as startPoint
                // This ensures the track is created with at least one control point
                let startPoint = null;
                if (trackData.positions && trackData.positions.length > 0) {
                    const firstPos = trackData.positions[0];
                    // positions are in format [frame, x, y, z]
                    startPoint = {
                        x: firstPos[1],
                        y: firstPos[2],
                        z: firstPos[3]
                    };
                }
                
                // Recreate the associated 3D object if it exists
                // This must be done BEFORE creating the track so the object exists
                // when addSyntheticTrack tries to associate them
                if (trackData.objectData) {
                    const objData = trackData.objectData;
                    const objectNode = new CNode3DObject({
                        id: objData.id,
                        geometry: objData.geometry,
                        radius: objData.radius,
                        color: objData.color,
                        material: objData.material,
                        position: startPoint, // Initial position (will be overridden by track)
                    });
                    console.log(`Recreated 3D object: ${objData.id}`);
                }
                
                // Recreate the synthetic track with the saved parameters
                // Note: We pass editMode: false initially, as the actual edit mode
                // will be restored when mods are applied
                const options = {
                    name: trackData.menuText,
                    curveType: trackData.curveType,
                    editMode: false, // Will be restored by mods
                    color: trackData.color,
                    lineWidth: trackData.lineWidth,
                    // Preserve the original IDs so mods can be applied correctly
                    trackID: trackData.trackID,
                    displayTrackID: trackData.displayTrackID,
                    // Pass the first position as startPoint to initialize the track
                    startPoint: startPoint,
                    // Pass the associated object ID if any
                    objectID: trackData.objectData?.id,
                };
                
                // Create the track
                const trackOb = this.addSyntheticTrack(options);
                
                // Verify the nodes were created and registered
                if (trackOb) {
                    console.log(`Created track with ID: ${trackOb.trackID}, exists in NodeMan: ${NodeMan.exists(trackOb.trackID)}`);
                    console.log(`Created display track with ID: ${trackOb.displayTrackID}, exists in NodeMan: ${NodeMan.exists(trackOb.displayTrackID)}`);
                }
                
                // If we recreated an object, add the TrackPosition controller to make it follow the track
                if (trackOb && trackData.objectData) {
                    const objectNode = NodeMan.get(trackData.objectData.id);
                    if (objectNode) {
                        objectNode.addController("TrackPosition", {
                            sourceTrack: trackOb.trackID
                        });
                        console.log(`Added TrackPosition controller to object ${trackData.objectData.id}`);
                    }
                }
                
                if (trackOb && trackData.positions && trackData.positions.length > 1) {
                    // Restore ALL positions using the spline editor's load method
                    // This will replace the initial point we just created
                    const splineEditorNode = NodeMan.get(trackOb.trackID);
                    if (splineEditorNode && splineEditorNode.splineEditor) {
                        // Use the load method which handles the positions array
                        splineEditorNode.splineEditor.load(trackData.positions);
                        splineEditorNode.recalculateCascade();
                    }
                }
                
                // Restore other properties that aren't handled by mods
                if (trackOb) {
                    trackOb.constantSpeed = trackData.constantSpeed ?? false;
                    trackOb.extrapolateTrack = trackData.extrapolateTrack ?? true;
                    
                    // Update the spline editor node with these properties
                    const splineEditorNode = NodeMan.get(trackOb.trackID);
                    if (splineEditorNode) {
                        splineEditorNode.constantSpeed = trackOb.constantSpeed;
                        splineEditorNode.extrapolateTrack = trackOb.extrapolateTrack;
                        
                        // Ensure edit mode is disabled after deserialization
                        // Transform controls should not be visible when loading a saved situation
                        splineEditorNode.enable = false;
                        if (splineEditorNode.splineEditor) {
                            splineEditorNode.splineEditor.setEnable(false);
                        }
                    }
                }
                
                console.log(`Deserialized synthetic track: ${trackData.trackID}`);
            } catch (error) {
                console.error(`Failed to deserialize synthetic track ${trackData.trackID}:`, error);
            }
        }
        
        // Recalculate everything after recreating all tracks
        NodeMan.recalculateAllRootFirst();
    }
}


export function addKMLMarkers(kml) {
    console.log(kml)
}

export const TrackManager = new CTrackManager();