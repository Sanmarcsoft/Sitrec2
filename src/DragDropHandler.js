//////////////////////////////////////////////////////
///  DRAG AND DROP FILES?
import {FileManager, Globals, NodeMan, Sit} from "./Globals";
import {cos, isSubdomain, radians} from "./utils";
import {LLAToEUS} from "./LLA-ECEF-ENU";
import {getLocalSouthVector, getLocalUpVector} from "./SphericalMath";
import {SITREC_DEV_DOMAIN, SITREC_DOMAIN} from "./configUtils";

import {EventManager} from "./CEventManager";
import {MP4_DEMUXER_EXTENSIONS, WEBAUDIO_SUPPORTED_EXTENSIONS} from "./AudioFormats";

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
        const allAudioExtensions = [...WEBAUDIO_SUPPORTED_EXTENSIONS, ...MP4_DEMUXER_EXTENSIONS];
        const audioExtPattern = new RegExp(`\\.(${allAudioExtensions.join('|')})$`, 'i');
        const isAudioFile = audioExtPattern.test(file.name) || file.type.startsWith("audio");

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
        console.log("queueResult: Queuing " + filename + " for parsing")
        this.dropQueue.push({filename: filename, result: result, newStaticURL: newStaticURL});
    }

    // If there are loaded files in the queue, then parse them
    // this is called from the main loop
    // to allow for debugging
    checkDropQueue() {
        while (this.dropQueue.length > 0) {
            const drop = this.dropQueue.shift();
            console.log("checkDropQueue: Parsing queued file " + drop.filename)
            FileManager.parseResult(drop.filename, drop.result, drop.newStaticURL);
        }
    }
}

export const DragDropHandler = new CDragDropHandler();
