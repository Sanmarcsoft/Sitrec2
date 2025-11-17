//////////////////////////////////////////////////////
///  DRAG AND DROP FILES?
import {TrackManager} from "./TrackManager";
import {FileManager, Globals, NodeMan, setNewSitchObject, setRenderOne, Sit} from "./Globals";
import {cos, ExpandKeyframes, getFileExtension, isSubdomain, radians} from "./utils";
import {textSitchToObject} from "./RegisterSitches";
import {ModelFiles} from "./nodes/CNode3DObject";
import {LLAToEUS} from "./LLA-ECEF-ENU";
import {getLocalSouthVector, getLocalUpVector} from "./SphericalMath";
import {SITREC_DEV_DOMAIN, SITREC_DOMAIN} from "./configUtils";
import {doesKMLContainTrack, extractKMLObjects} from "./KMLUtils";
import {findColumn} from "./ParseUtils";
import {EventManager} from "./CEventManager";
import {CNodeArray} from "./nodes/CNodeArray";
import {FeatureManager} from "./CFeatureManager";

// The DragDropHandler is more like the local client file handler, with rehosting, and parsing
class CDragDropHandler {

    constructor() {
        this.dropAreas = [];
        this.dropQueue = []; // Queue for dropped files that need parsing
    }

    addDropArea() {

        if (Globals.isMobile) {
            console.log("Mobile device detected, skipping drag-and-drop zone");
            return;
        }
        
        if (this.dropZone !== undefined) {
            console.warn("DropZone already exists");
            return;
        }
        this.dropZone = document.createElement('div');
        const dropZone = this.dropZone;
        dropZone.style.position = 'fixed';
        dropZone.style.top = '0';
        dropZone.style.left = '0';
        dropZone.style.width = '100vw';
        dropZone.style.height = '100vh';
        dropZone.style.display = 'flex';
        dropZone.style.justifyContent = 'center';
        dropZone.style.alignItems = 'center';
        dropZone.style.fontSize = '48px';
        dropZone.style.color = '#fff';
        dropZone.style.transition = 'background-color 0.2s, opacity 5s';
        dropZone.style.pointerEvents = 'none';
        dropZone.style.zIndex = '9999'; // High z-index to overlay other elements
        dropZone.innerHTML = 'DROP FILES <br>OR URLS<br>HERE';

        if (!Sit.initialDropZoneAnimation || Globals.fixedFrame !== undefined) {
            dropZone.style.visibility = 'hidden'; // Initially hidden
        }
        // 10px red border
        dropZone.style.border = '2px solid red';
        dropZone.style.boxSizing = 'border-box';


        document.body.appendChild(dropZone);

        // make it transition over 2 seconds from visible to invisible
        requestAnimationFrame(() => {
            dropZone.style.opacity = '0';
        })

        function handleDragOver(event) {
            event.preventDefault(); // Necessary to allow a drop
        }

        document.body.addEventListener('dragenter', (event) => {
            this.showDropZone();
        });

        document.body.addEventListener('dragover', handleDragOver);

        document.body.addEventListener('dragleave', (event) => {
            // Hide only if the cursor leaves the document
            if (event.relatedTarget === null) {
                this.hideDropZone();
            }
        });

        document.body.addEventListener('drop', this.onDrop.bind(this));
    }

    showDropZone(message) {
        if (message !== undefined) {
            this.dropZone.innerHTML = message;
        }
        this.dropZone.style.opacity = '1';
        this.dropZone.style.transition = 'background-color 0.2s, opacity 0.2s';
        this.dropZone.style.visibility = 'visible';
        this.dropZone.style.backgroundColor = 'rgba(0,0,0,0.5)';
        this.dropZone.style.pointerEvents = 'all'; // Enable pointer events when showing
    }

    hideDropZone() {
        this.dropZone.style.visibility = 'hidden';
        this.dropZone.style.backgroundColor = 'transparent';
        this.dropZone.style.pointerEvents = 'none'; // Disable pointer events when hidden
    }

    handlerFunction(event) {
        event.preventDefault()
    }

    onDrop(e) {
        this.dropQueue = [];
        e.preventDefault();
        this.hideDropZone();
        // we defer the checkDrop to a check in the main loop
        // to simplify debugging.
        const dt = e.dataTransfer;

        // If files were dragged and dropped
        if (dt.files && dt.files.length > 0) {
            console.log("LOADING DROPPED FILE:" + dt.files[0].name);
            for (const file of dt.files) {
                this.uploadDroppedFile(file, file.name);
            }
        }
// If a plain text snippet or URL was dragged and dropped
        else {
            let url = dt.getData('text/plain');
            if (url) {
                console.log("LOADING DROPPED text:" + url);
                // check if it's not a valid URL
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    this.uploadText(url);
                } else {

                    this.uploadURL(url);
                }
            }
        }

    }


    uploadDroppedFile(file) {

        EventManager.dispatchEvent("fileDropped", {})


        // if it's a video or audio file, that's handled differently
        // as we might (in the future) want to stream it
        // NOTE: .ts files (MPEG Transport Stream) are NOT treated as video here
        // because they need special parsing in FileManager to extract multiple streams
        const isTSFile = /\.(ts|m2ts|mts)$/i.test(file.name);
        const isAudioFile = /\.(mp3|m4a|wav)$/i.test(file.name) || file.type.startsWith("audio");

        if (!isTSFile && (file.type.startsWith("video") || isAudioFile)) {
            console.log("Loading dropped " + (isAudioFile ? "audio" : "video") + " file: " + file.name);
            if (!NodeMan.exists("video")) {
                console.warn("No video node found to load " + (isAudioFile ? "audio" : "video") + " file");
                return;
            }
            NodeMan.get("video").uploadFile(file);
            return;
        }

        console.log("")
        console.log("##############################################################")
        console.log("### Uploading dropped file: " + file.name)

        // otherwise we load and then parse the file with the FileManager
        // and then decide what to do with it based on the file extension

        let promise = new Promise((resolve, reject) => {
            let reader = new FileReader();
            reader.readAsArrayBuffer(file);
            reader.onloadend = () => {
                this.queueResult(file.name, reader.result, null);
            };
        });

        return promise;
    }



    async uploadURL(url) {
        // Check if the URL is from the same domain we are hosting on
        // later we might support other domains, and load them via proxy
        const urlObject = new URL(url);
        if (!isSubdomain(urlObject.hostname, SITREC_DOMAIN)
            && !isSubdomain(urlObject.hostname, SITREC_DEV_DOMAIN)
            && !isSubdomain(urlObject.hostname, "amazonaws.com")
        ) {
            // console.warn('The provided URL ' + urlObject.hostname +' is not from ' + SITREC_DOMAIN + " or " + SITREC_DEV_DOMAIN + "or amazonaws.com");

            // for non-local URLS, we check for info in the URL itself, like a lat, lon, alt location

            let lat, lon;
            let alt = 30000;    // default altitude (meters)

            const mainCamera = NodeMan.get("mainCamera").camera;

            // check from Google Maps URLs, and extract the location
            if (urlObject.hostname === "www.google.com" && urlObject.pathname.startsWith("/maps")) {

                // example URL from Google Maps
                // https://www.google.com/maps/place/Santa+Monica,+CA/@33.9948301,-118.4615695,67a,35y,116.89h,8.32t/data

                // first get the string after the @ from the string url, and split it by the comma
                const afterAt = url.split("@")[1].split("/data")[0];
                const parts = afterAt.split(",");
                if (parts.length > 1) {
                    const lat = parseFloat(parts[0]);
                    const lon = parseFloat(parts[1]);


                    // if part[2] ends in "m" or "a" then it's the vertical span of the map
                    // from that we can work out the altitude
                    if (parts[2].endsWith("m") || parts[2].endsWith("a")) {
                        const span = parseFloat(parts[2].slice(0, -1));
                        // given the camera Vertical FOV, we can work out the altitude
                        const vFOV = mainCamera.fov * Math.PI / 180;
                        alt = span / 2 / Math.tan(vFOV / 2);
                    }

                    console.log("Google Maps URL detected, extracting location: " + lat + ", " + lon, " Altitude: " + alt);

                }
            }


            // ADSBx example URL
            // https://globe.adsbexchange.com/?replay=2024-12-30-23:54&lat=39.948&lon=-73.938&zoom=11.8
            if (urlObject.hostname === "globe.adsbexchange.com") {
                lat = parseFloat(urlObject.searchParams.get("lat"));
                lon = parseFloat(urlObject.searchParams.get("lon"));
                let zoom = parseFloat(urlObject.searchParams.get("zoom"));

                // convert zoom to altitude
                // by first converting it to a tile size in meters
                let circumference = 40075000*cos(radians(lat));
                let span = circumference/Math.pow(2,zoom-1)
                const vFOV = mainCamera.fov * Math.PI / 180;
                alt = span / 2 / Math.tan(vFOV / 2);

            }

            // FR24 example URL
            // https://www.flightradar24.com/38.73,-120.56/9
            if (urlObject.hostname === "www.flightradar24.com") {
                let latlon = urlObject.pathname.split("/")[1];
                lat = parseFloat(latlon.split(",")[0]);
                lon = parseFloat(latlon.split(",")[1]);
                let zoom = parseFloat(urlObject.pathname.split("/")[2]);

                // convert zoom to altitude
                // by first converting it to a tile size in meters
                let circumference = 40075000*cos(radians(lat));
                let span = circumference/Math.pow(2,zoom-1)
                const vFOV = mainCamera.fov * Math.PI / 180;
                alt = span / 2 / Math.tan(vFOV / 2);
            }




            if (lat !== undefined && lon !== undefined) {
                this.droppedLLA(lat, lon, alt)
            }

            return;
        }

        return fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.arrayBuffer();
            })
            .then(buffer => {
                console.log(`Fetched ${url} successfully, queueing result for parsing`)
                this.queueResult(url, buffer, url)
            })
            .catch(error => {
                console.log('There was a problem with the fetch operation:', error.message);
            });
    }

    // dragged in a text snippet
    // check if it's a lat, lon, alt or just a lat, lon
    // 38.73,-120.56,100000 , or 38.73,-120.56
    uploadText(text) {
        // most likely LL or LLA
        const numbers = text.split(/[\s,]+/).map(parseFloat);
        if (numbers.length === 2) {
            // it's a lat, lon
            this.droppedLLA(numbers[0], numbers[1], 0);
        } else
        if (numbers.length === 3) {
            // it's a lat, lon, alt
            this.droppedLLA(numbers[0], numbers[1], numbers[2]);
        } else {
            console.log("Unhandled text snippet: " + text);
        }
    }


    droppedLLA(lat, lon, alt) {
        const mainCamera = NodeMan.get("mainCamera").camera;
        const camPos = LLAToEUS(lat, lon, alt);

        const target = LLAToEUS(lat, lon, 0);

        const up = getLocalUpVector(camPos);
        const south = getLocalSouthVector(camPos);
        camPos.add(south.clone().multiplyScalar(100)); // move camera 100 meter south, just so we orient norht

        // set the position to the target
        mainCamera.position.copy(camPos);
        // Set up to local up
        mainCamera.up.copy(up);
        // and look at the track point
        mainCamera.lookAt(target);
    }

    // Add a loaded file to the drop queue for later parsing
    // we do this from within the dragDropHandler event handler,
    // so we can control when the parsing happens in the event loop
    // and make it easier to debug (PHPStorm tends to break on debugging async event calls)
    // @param {string} filename - The name of the file
    // @param {ArrayBuffer} result - The raw file data
    // @param {string|null} newStaticURL - The static URL for the file, if applicable
    queueResult(filename, result, newStaticURL) {
        this.dropQueue.push({filename: filename, result: result, newStaticURL: newStaticURL});
    }

    // If there are loaded files in the queue, then parse them
    // this is called from the main loop
    // to allow for debugging
    checkDropQueue() {
        while (this.dropQueue.length > 0) {
            const drop = this.dropQueue.shift();
            this.parseResult(drop.filename, drop.result, drop.newStaticURL);
        }
    }


    // a raw arraybuffer (result) has been loaded
    // parse the asset
    // and then handle the parsed file
    // @param {string} filename - The name of the file
    // @param {ArrayBuffer} result - The raw file data
    // @param {string|null} newStaticURL - The static URL for the file, if applicable
    parseResult(filename, result, newStaticURL) {
        FileManager.parseAsset(filename, filename, result)
            .then(parsedResult => {

                // Rehosting would be complicated with multiple results. Ignored for now.
                // Maybe we need a FILE manager and an ASSET manager
                // we'll rehost files, not assets

                // parsing an asset file can return a single result,
                // or an array of one or more results (like with a zip file)
                // for simplicity, if it's a single result we wrap it in an array
                if (!Array.isArray(parsedResult))
                    parsedResult = [parsedResult]

                for (const x of parsedResult) {
                    FileManager.remove(x.filename); // allow reloading.
                    FileManager.add(x.filename, x.parsed, result)
                    const fileManagerEntry = FileManager.list[x.filename];
                    fileManagerEntry.dynamicLink = true;
                    fileManagerEntry.filename = x.filename;
                    fileManagerEntry.staticURL = newStaticURL;
                    fileManagerEntry.dataType = x.dataType;

                    const parsedFile = x.parsed;
                    const filename = x.filename;

                    NodeMan.suspendRecalculate()
                    this.handleParsedFile(filename, parsedFile);
                    NodeMan.unsuspendRecalculate();

                }
                console.log("parseResult: DONE Parse " + filename)
                setRenderOne(true);
            })
    }

    // handle the parsed file
    // this is where we decide what to do with the file
    // based on the file extension and the data type
    // @param {string} filename - The name of the file
    // @param {ArrayBuffer} parsedFile - The parsed file data (from parseResult)
    handleParsedFile(filename, parsedFile) {

        setRenderOne(2)

        const fileManagerEntry = FileManager.list[filename];

        const fileExt = getFileExtension(filename);

        if (filename.split('.').length === 1) {
//            console.log("Skipping handleParseFile, as no file extension for " + filename+" assuming it's an ID");
            return;
        }

        // first we check for special files that need special handling
        if (fileManagerEntry.dataType === "FEATURES") {
            // Extract features and mark the file to not be saved
            extractFeaturesFromFile(parsedFile);
            // Mark this file as transient - don't save it during serialization
            fileManagerEntry.skipSerialization = true;
            return;
        }


        // if it's a CSV, the first check if it contails AZ and EL
        // if it does, then we want to send it to the customAzElController node
        if (fileExt === "csv") {

            // bit of patch, if the type has not been set
            // check if it contains az, el, zoom, fov, heading columns
            if ( fileManagerEntry.dataType === "AZIMUTH" || fileManagerEntry.dataType === "ELEVATION" || fileManagerEntry.dataType === "HEADING" || fileManagerEntry.dataType === "FOV" || fileManagerEntry.dataType === "Unknown" || fileManagerEntry.dataType === undefined) {
                const azCol = findColumn(parsedFile, "Az", true);
                const elCol = findColumn(parsedFile, "El", true);
                const zoomCol = findColumn(parsedFile, "Zoom", true);
                const fovCol = findColumn(parsedFile, "FOV", true);
                const headingCol = findColumn(parsedFile, "Heading", true);


                if (azCol !== -1 || elCol !== -1 || zoomCol !== -1 || fovCol !== -1 || headingCol !== -1) {

                    // get the firs col header before we slice them off
                    const firstColumnHeader = parsedFile[0][0].toLowerCase();
                    // remove the first row (headers)
                    parsedFile = parsedFile.slice(1);

                    // we expect frame numbers in the first column
                    // if the head is "time" then we expect time in seconds
                    // so convert it to frame numbers
                    if (firstColumnHeader === "time") {
                        // convert the time to frame numbers
                        const fps = Sit.fps;
                        parsedFile.forEach(row => {
                            if (row[0] !== undefined) {
                                row[0] = Math.round(row[0] * fps);
                            }
                        });
                    }


                    // it's a CSV with az, el, zoom, and/or fov
                    // so we want to send it to the customAzElController node

                    const azElController = NodeMan.get("customAzElController", false)
                    if (azElController) {
                        if (azCol !== -1) {
                            azElController.setAzFile(parsedFile, azCol);
                        }

                        if (elCol !== -1) {
                            azElController.setElFile(parsedFile, elCol);
                        }


                    }

                    // handle FOV/Zoom columns if present - create CNodeArray and add to fovSwitch
                    if (fovCol !== -1 || zoomCol !== -1) {
                        const fovSwitch = NodeMan.get("fovSwitch", false);
                        if (fovSwitch) {
                            // Use FOV column if present, otherwise use Zoom column
                            const dataCol = fovCol !== -1 ? fovCol : zoomCol;
                            const columnName = fovCol !== -1 ? "FOV" : "Zoom";

                            // Create expanded keyframes array (step-wise, not smoothed)
                            const fovArray = ExpandKeyframes(parsedFile, Sit.frames, 0, dataCol, true);


                            // TODO: modify filemanager to get original filenames from static links
                            // like https://sitrec.s3.us-west-2.amazonaws.com/99999999/fov-727f880234d0cc8281a09e75c2b3f5aa.csv


                            // Create CNodeArray with filename as ID
                            const fovNodeId = fileManagerEntry.filename.replace(/\.[^/.]+$/, "") + "_" + columnName;

                            // this will leave the old ref in fovSwitch
                            // but we will immediately replace it with the new one (same id)
                            NodeMan.unlinkDisposeRemove(fovNodeId);

                            const fovNode = new CNodeArray({id: fovNodeId, array: fovArray});

                            // Add or replace the option in the fovSwitch
                            fovSwitch.replaceOption(fovNodeId, fovNode);

                            // Select this new FOV source
                            fovSwitch.selectOption(fovNodeId);
                        }
                    }

                    // handle heading column if present
                    if (headingCol !== -1) {
                        const headingController = NodeMan.get("customHeadingController", false)
                        if (headingController) {
                            headingController.setHeadingFile(parsedFile, headingCol);
                            headingController.recalculate();
                        }
                    }

                    // handled the AZ, EL, ZOOM, FOV, and/or HEADING CSV file, so
                    return;
                }
                // if we get here, then we don't have az and el columns

            } else {
                // for known CSV files, we assume they are in the right format
                // strip the first row
                // as it's the header
                // and we don't want to send it to the customAzElController
                parsedFile = parsedFile.slice(1);

            }
        }


        // very rough figuring out what to do with it
        // TODO: multiple TLEs, Videos, images.
        if (FileManager.detectTLE(filename)) {

            // remove any existing TLE (most likely the current Starlink, bout could be the last drag and drop file)
            FileManager.deleteIf(file => file.isTLE);

            fileManagerEntry.isTLE = true;
            NodeMan.get("NightSkyNode").replaceTLE(parsedFile)
        } else {
            let isATrack = false;
            let isASitch = false;
            if (fileManagerEntry.dataType === "json"
                || fileExt === "kml"
                || fileExt === "srt"
                || ( fileExt === "csv" && fileManagerEntry.dataType !== "Unknown")
                || fileExt === "klv") {
                isATrack = true;
            }

            // kml files might not contain a track
            if (fileExt === "kml") {
                isATrack = doesKMLContainTrack(parsedFile)
            }


            if (fileManagerEntry.dataType === "sitch") {
                isASitch = true;
            }

            if (isATrack) {
                TrackManager.addTracks([filename], true)
                if (fileExt === "kml") {
                    console.log("KML file detected, adding anything else in the file")
                    extractKMLObjects(parsedFile)
                }
                return
            } else if (isASitch) {
                // parsedFile is a sitch text def
                // make a copy of the string (as we might be removing all the files)
                // and set it as the new sitch text
                let copy = parsedFile.slice();
                // if it's an arraybuffer, convert it to a sitch object
                if (copy instanceof ArrayBuffer) {
                    const decoder = new TextDecoder('utf-8');
                    const decodedString = decoder.decode(copy);
                    copy = textSitchToObject(decodedString);
                }
                setNewSitchObject(copy)
                return;
            } else if (fileExt === "glb") {
                // it's a model, so we can replace the model used in targetModel
                // we have filename, and we can just set
                ModelFiles[filename] = {file: filename};
                if (NodeMan.exists("targetObject")) {
                    const target = NodeMan.get("targetObject");
                    target.modelOrGeometry = "model"
                    target.selectModel = filename;
                    target.rebuild();
                    // woudl also need to add it to the gui
                }
                return;


            }

            if (fileExt === "kml") {
                console.log("KML file detected, adding anything else in the file")
                extractKMLObjects(parsedFile)
                return;
            }

            // is it a video file (like H.264 streams from TS files)?
            if (fileManagerEntry.dataType === "video") {
                console.log("Video data detected: " + filename);
                if (!NodeMan.exists("video")) {
                    console.warn("No video node found to load video data");
                    return;
                }

                // Check if it's an H.264 stream
                if (fileExt === "h264") {
                    console.log("H.264 stream detected, attempting to load with specialized handler");
                    // Create a File-like object from the buffer for the video node
                    const blob = new Blob([parsedFile], { type: 'video/h264' });
                    const file = new File([blob], filename, { type: 'video/h264' });
                    NodeMan.get("video").uploadFile(file);
                } 
                // Check if it's an audio file (M4A, MP3, etc.)
                else if (fileExt === "m4a" || fileExt === "mp3") {
                    console.log("Audio file detected: " + filename);
                    // Create a File-like object from the buffer for the video node
                    const mimeType = fileExt === "mp3" ? 'audio/mpeg' : 'audio/mp4';
                    const blob = new Blob([parsedFile], { type: mimeType });
                    const file = new File([blob], filename, { type: mimeType });
                    NodeMan.get("video").uploadFile(file);
                }
                // Check if it's a regular video file (MP4, MOV, WEBM, AVI)
                else if (fileExt === "mp4" || fileExt === "mov" || fileExt === "webm" || fileExt === "avi") {
                    console.log("Video file detected: " + filename);
                    // Create a File-like object from the buffer for the video node
                    const mimeType = `video/${fileExt === "mov" ? "quicktime" : fileExt}`;
                    const blob = new Blob([parsedFile], { type: mimeType });
                    const file = new File([blob], filename, { type: mimeType });
                    NodeMan.get("video").uploadFile(file);
                }
                else {
                    console.warn("Unknown video format for: " + filename);
                }
                return;
            }

            // is it an image?
            if (fileExt === "jpg" || fileExt === "jpeg" || fileExt === "png" || fileExt === "gif") {
                // it's an image, so we want to make a video that's a single frame
                if (!NodeMan.exists("video")) {
                    console.warn("No video node found to load video file");
                    return;
                }
                NodeMan.get("video").makeImageVideo(filename, parsedFile, true);
                return;
            }

            console.warn("Unhandled file type: " + fileExt + " for " + filename);


        }
    }



}

// a features CSV has lat, lon, alt, and label columns
// iterate over it and make markers with labels at those locations
function extractFeaturesFromFile(csv) {
    console.log("Extracting FEATURES from CSV file");
    
    // Find column indices once before the loop
    const latCol = findColumn(csv, "lat", true);
    const lonCol = findColumn(csv, "lon", true);
    const altCol = findColumn(csv, "alt", true);
    const labelCol = findColumn(csv, "label", true);

    if (latCol === -1 || lonCol === -1 || altCol === -1 || labelCol === -1) {
        console.warn("FEATURES CSV missing required columns (lat, lon, alt, label)");
        return;
    }

    // Iterate over rows (skip header row at index 0)
    for (let i = 1; i < csv.length; i++) {
        const row = csv[i];

        const lat = parseFloat(row[latCol]);
        const lon = parseFloat(row[lonCol]);
        let alt = parseFloat(row[altCol]);
        if (isNaN(alt)) alt = 0;
        const label = row[labelCol] ?? "";

        // Skip rows with invalid coordinates
        if (isNaN(lat) || isNaN(lon)) {
            continue;
        }

        // Create a feature marker using FeatureManager
        FeatureManager.addFeature({
            id: `feature_${i}_${label.replace(/\s+/g, '_')}`,
            text: label,
            positionLLA: {lat: lat, lon: lon, alt: alt},
        });
    }
    
    console.log(`Extracted ${FeatureManager.size()} feature markers`);
}


export const DragDropHandler = new CDragDropHandler();
