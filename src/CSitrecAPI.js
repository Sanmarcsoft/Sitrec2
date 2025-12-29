// Client-side Sitrec API with callable functions and documentation
import {CustomManager, GlobalDateTimeNode, guiMenus, NodeMan, Sit} from "./Globals";
import {isLocal} from "./configUtils";
import {showError} from "./showError";
import GUI from "./js/lil-gui.esm";
import {ModelFiles} from "./nodes/CNode3DObject";
import {par} from "./par";

class CSitrecAPI {
    constructor() {

        this.debug = isLocal;

        this.docs = {
            gotoLLA: "Move the camera to the location specified by Lat/Lon/Alt (Alt optional, defaults to 0). Parameters: lat (float), lon (float), alt (float, optional).",
            setDateTime: "Set the date and time for the simulation. Parameter: dateTime (ISO 8601 string).",
        };

        this.api = {
            gotoLLA: {
                doc: "Move the camera to the specified latitude, longitude, and altitude.",
                params: {
                    lat: "Latitude in degrees (float)",
                    lon: "Longitude in degrees (float)",
                    alt: "Altitude in meters (float, optional, defaults to 0)"
                },
                fn: (v) => {
                    const camera = NodeMan.get("fixedCameraPosition");
                    camera.gotoLLA(v.lat, v.lon, v.alt)
                }
            },

            setCameraAltitude: {
                doc: "Set the camera altitude while keeping current lat/lon.",
                params: {
                    alt: "Altitude in meters (float)"
                },
                fn: (v) => {
                    const camera = NodeMan.get("fixedCameraPosition");
                    const lla = camera._LLA;
                    camera.setLLA(lla[0], lla[1], v.alt);
                    return { success: true, newAltitude: v.alt };
                }
            },

            getCameraLLA: {
                doc: "Get the current camera latitude, longitude, and altitude.",
                fn: () => {
                    const camera = NodeMan.get("fixedCameraPosition");
                    const lla = camera._LLA;
                    return { lat: lla[0], lon: lla[1], alt: lla[2] };
                }
            },

            setDateTime: {
                doc: "Set the date and time for the simulation.",
                params: {
                    dateTime: "ISO 8601 date-time string with Z or timezone offset (e.g. '2023-10-01T12:00:00+02:00')"
                },
                fn: (v) => {
                    const dateTime = new Date(v.dateTime);
                    if (isNaN(dateTime.getTime())) {
                        showError("Invalid date-time format:", v.dateTime);
                        return;
                    }
                    GlobalDateTimeNode.setStartDateTime(v.dateTime);

                }
            },

            pointCameraAtRaDec: {
                doc: "Set the camera orientation based on Right Ascension and Declination. Use for looking at stars and other fixed sky objects (not planets or the Sun).",
                params: {
                    ra: "Right Ascension in hours (float)",
                    dec: "Declination in degrees (float)",
                },
                fn: (v) => {
                    const camera = NodeMan.get("lookCamera");
                    camera.setFromRaDec(v.ra, v.dec);
                }
            },

            pointCameraAtNamedObject: {
                doc: "Point the camera at a named celestial object (e.g. 'Sun', 'Moon', 'Mars'). Use this for things that are not fixed.",
                params: {
                    object: "Name of the celestial object (string)"
                },
                fn: (v) => {
                    const camera = NodeMan.get("lookCamera");
                    camera.setFromNamedObject(v.object);
                }
            },

            satellitesShowSatellites: {
                doc: "Show satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showSatellites = true;
                        nightSky.satelliteGroup.visible = true;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },
            satellitesHideSatellites: {
                doc: "Hide satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showSatellites = false;
                        nightSky.satelliteGroup.visible = false;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },

            satellitesShowStarlink: {
                doc: "Show Starlink satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showStarlink = true;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },
            satellitesHideStarlink: {
                doc: "Hide Starlink satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showStarlink = false;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },

            satellitesShowISS: {
                doc: "Show ISS satellite.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showISS = true;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },
            satellitesHideISS: {
                doc: "Hide ISS satellite.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showISS = false;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },

            satellitesShowBrightest: {
                doc: "Show Celestrak brightest satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showBrightest = true;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },
            satellitesHideBrightest: {
                doc: "Hide Celestrak brightest satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showBrightest = false;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },

            satelliteLookViewNamesOn: {
                doc: "Switch on satellite names in the look view.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showSatelliteNames = true;
                        nightSky.updateSatelliteNamesVisibility();
                    }
                }
            },

            satelliteLookViewNamesOff: {
                doc: "Switch off satellite names in the look view.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showSatelliteNames = false;
                        nightSky.updateSatelliteNamesVisibility();
                    }
                }
            },

            satelliteLookViewNamesToggle: {
                doc: "Toggle satellite names in the look view.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showSatelliteNames = nightSky.showSatelliteNames === true ? false : true;
                        nightSky.updateSatelliteNamesVisibility();
                    }
                }
            },

            satelliteMainViewNamesOn: {
                doc: "Switch on satellite names in the main view.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showSatelliteNamesMain = true;
                        nightSky.updateSatelliteNamesVisibility();
                    }
                }
            },

            satelliteMainViewNamesOff: {
                doc: "Switch off satellite names/lables in the main view.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showSatelliteNamesMain = false;
                        nightSky.updateSatelliteNamesVisibility();
                    }
                }
            },

            satelliteNamesMainViewToggle: {
                doc: "Toggle the display of satellite names in the main view.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showSatelliteNamesMain = nightSky.showSatelliteNamesMain === true ? false : true ;
                        nightSky.updateSatelliteNamesVisibility();
                    }
                }
            },

            satelliteLabelsOn: {
                doc: "Switches on satellite labels.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showAllLabels = true;
                        nightSky.updateSatelliteNamesVisibility();
                    }
                }
            },

            satelliteLabelsOff: {
                doc: "Switches off satellite labels.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showAllLabels = false;
                        nightSky.updateSatelliteNamesVisibility();
                    }
                }
            },

            satellitesLoadLEO: {
                doc: "Loads LEO low-earth orbit satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.satellites.updateLEOSats();
                    }
                }
            },

            satellitesLoadCurrentStarlink: {
                doc: "Loads current Starlink satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.satellites.updateStarlink();
                    }
                }
            },

            satellitesFlareRegionOn: {
                doc: "Show the satellite flare region visualization.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showFlareRegion = true;
                        nightSky.flareRegionGroup.visible = true;
                    }
                }
            },

            satellitesFlareRegionOff: {
                doc: "Hide the satellite flare region visualization.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.showFlareRegion = false;
                        nightSky.flareRegionGroup.visible = false;
                    }
                }
            },


            satellitesShowOther: {
                doc: "Show other (non-Starlink, non-ISS, non-Brightest) satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.satellites.showOtherSatellites = true;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },

            satellitesHideOther: {
                doc: "Hide other (non-Starlink, non-ISS, non-Brightest) satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.satellites.showOtherSatellites = false;
                        nightSky.satellites.filterSatellites();
                    }
                }
            },

            getFrame: {
                doc: "Get the current frame number and total frames.",
                fn: () => {
                    return { 
                        frame: par.frame, 
                        totalFrames: Sit.frames,
                        time: par.time,
                        paused: par.paused
                    };
                }
            },

            setFrame: {
                doc: "Set the current frame number (0-indexed).",
                params: {
                    frame: "Frame number (integer, 0-indexed)"
                },
                fn: (v) => {
                    let frame = parseInt(v.frame);
                    if (isNaN(frame)) return { success: false, error: "Invalid frame number" };
                    if (frame < 0) frame = 0;
                    if (frame > Sit.frames - 1) frame = Sit.frames - 1;
                    par.frame = frame;
                    return { success: true, frame: par.frame, totalFrames: Sit.frames };
                }
            },

            play: {
                doc: "Start playing the simulation (unpause).",
                fn: () => {
                    par.paused = false;
                    return { success: true, paused: false };
                }
            },

            pause: {
                doc: "Pause the simulation.",
                fn: () => {
                    par.paused = true;
                    return { success: true, paused: true };
                }
            },

            togglePlayPause: {
                doc: "Toggle between play and pause states.",
                fn: () => {
                    par.paused = !par.paused;
                    return { success: true, paused: par.paused };
                }
            },

            getCurrentSimTime: {
                doc: "Get the current simulation date/time as an ISO string.",
                fn: () => {
                    if (GlobalDateTimeNode && GlobalDateTimeNode.dateNow) {
                        return { 
                            isoString: GlobalDateTimeNode.dateNow.toISOString(),
                            localString: GlobalDateTimeNode.dateNow.toLocaleString()
                        };
                    }
                    return { error: "No simulation time available" };
                }
            },

            getRealTime: {
                doc: "Get the current real-world date/time.",
                fn: () => {
                    const now = new Date();
                    return { 
                        isoString: now.toISOString(),
                        localString: now.toLocaleString()
                    };
                }
            },

            listCelestialObjects: {
                doc: "List celestial objects that can be pointed at with pointCameraAtNamedObject.",
                fn: () => {
                    return {
                        planets: ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"],
                        other: ["Sun", "Moon"],
                        note: "For stars and constellations, use pointCameraAtRaDec with RA/Dec coordinates."
                    };
                }
            },

            addObjectAtLLA: {
                doc: "Create a new 3D object at the specified latitude, longitude, and altitude.",
                params: {
                    lat: "Latitude in degrees (float)",
                    lon: "Longitude in degrees (float)",
                    alt: "Altitude in meters (float, optional, defaults to 0)",
                    name: "Object name (string, optional)"
                },
                fn: (v) => {
                    try {
                        const name = v.name || CustomManager.getNextObjectName();
                        const alt = v.alt ?? 0;
                        const { objectNode, trackOb } = CustomManager.createObjectFromInput(
                            name, v.lat, v.lon, alt, v.alt !== undefined
                        );
                        if (objectNode) {
                            return { 
                                success: true, 
                                name: name, 
                                lat: v.lat, 
                                lon: v.lon, 
                                alt: alt 
                            };
                        }
                        return { success: false, error: "Failed to create object" };
                    } catch (e) {
                        return { success: false, error: e.message };
                    }
                }
            },

            findSatellite: {
                doc: "Search for satellites by name. Returns matching satellite names. Use this to find the correct name before filtering.",
                params: {
                    name: "Partial or full satellite name to search for (string)"
                },
                fn: (v) => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if (!nightSky || !nightSky.satellites || !nightSky.satellites.TLEData) {
                        return { success: false, error: "No satellite data loaded. Load satellites first with satellitesLoadLEO." };
                    }
                    const searchTerm = String(v.name).toUpperCase();
                    const matches = [];
                    for (const satData of nightSky.satellites.TLEData.satData) {
                        if (satData.name && satData.name.toUpperCase().includes(searchTerm)) {
                            matches.push(satData.name);
                            if (matches.length >= 20) break;
                        }
                    }
                    return { 
                        success: true, 
                        count: matches.length, 
                        matches: matches,
                        note: matches.length >= 20 ? "Results limited to 20. Refine your search." : undefined
                    };
                }
            },

            debug: {
                doc: "Toggle debug mode",
                params: {
                },
                fn: (v) => {
                    this.debug = !this.debug;
                }
            },

            setMenuValue: {
                doc: "Set a menu control value by menu ID and control name path.",
                params: {
                    menu: "Menu ID (e.g. 'view', 'satellites', 'terrain')",
                    path: "Control name or path with '/' for nested folders (e.g. 'showStarlink' or 'Views/showVideo')",
                    value: "New value (type depends on control: number, boolean, string, or color hex)"
                },
                fn: (v) => {
                    const result = this._setMenuValue(v.menu, v.path, v.value);
                    if (!result.success) {
                        showError("setMenuValue failed:", result.error);
                    }
                    return result;
                }
            },

            getMenuValue: {
                doc: "Get current value of a menu control by menu ID and control name path.",
                params: {
                    menu: "Menu ID (e.g. 'view', 'satellites', 'terrain')",
                    path: "Control name or path with '/' for nested folders (e.g. 'showStarlink' or 'Views/showVideo')"
                },
                fn: (v) => {
                    return this._getMenuValue(v.menu, v.path);
                }
            },

            listMenus: {
                doc: "List all available menu IDs.",
                fn: () => {
                    return Object.keys(guiMenus);
                }
            },

            listMenuControls: {
                doc: "List all controls in a specific menu.",
                params: {
                    menu: "Menu ID (e.g. 'view', 'satellites')"
                },
                fn: (v) => {
                    const gui = guiMenus[v.menu];
                    if (!gui) return { error: `Menu '${v.menu}' not found` };
                    return this._extractGUIDoc(gui);
                }
            },

            executeMenuButton: {
                doc: "Execute a button/function control in a menu (e.g. 'Add Object').",
                params: {
                    menu: "Menu ID (e.g. 'objects', 'view')",
                    path: "Button name or path with '/' for nested folders"
                },
                fn: (v) => {
                    return this._executeMenuButton(v.menu, v.path);
                }
            },

            listObjectFolders: {
                doc: "List all 3D object folder names in the objects menu. Use this to find the correct object name when user refers to an object (e.g. 'camera' might match 'cameraObject').",
                fn: () => {
                    const gui = guiMenus.objects;
                    if (!gui) return { error: "Objects menu not found" };
                    const folders = gui.children
                        .filter(c => c instanceof GUI)
                        .map(c => c._title);
                    return folders;
                }
            },

            listAvailableModels: {
                doc: "List all available 3D model names that can be used with setObjectModel.",
                fn: () => {
                    return Object.keys(ModelFiles);
                }
            },

            setObjectModel: {
                doc: "Set the 3D model for an object. Call listAvailableModels first to see available options, then pick the best match for the user's request (e.g. if they ask for 'plane' or 'jet', pick an appropriate aircraft model).",
                params: {
                    object: "Object name or partial name (e.g. 'camera' will match 'cameraObject')",
                    model: "Exact model name from listAvailableModels"
                },
                fn: (v) => {
                    const gui = guiMenus.objects;
                    if (!gui) return { success: false, error: "Objects menu not found" };
                    
                    const objectLower = String(v.object).toLowerCase();
                    const folders = gui.children.filter(c => c instanceof GUI);
                    
                    // Find best matching folder
                    let folder = folders.find(c => c._title.toLowerCase() === objectLower);
                    if (!folder) {
                        folder = folders.find(c => c._title.toLowerCase().includes(objectLower));
                    }
                    if (!folder) {
                        folder = folders.find(c => objectLower.includes(c._title.toLowerCase()));
                    }
                    if (!folder) {
                        const available = folders.map(c => c._title).join(', ');
                        return { success: false, error: `Object '${v.object}' not found. Available: ${available}` };
                    }
                    
                    // Find best matching model name
                    const modelLower = String(v.model).toLowerCase();
                    const modelKeys = Object.keys(ModelFiles);
                    let modelName = modelKeys.find(m => m.toLowerCase() === modelLower);
                    if (!modelName) {
                        modelName = modelKeys.find(m => m.toLowerCase().includes(modelLower));
                    }
                    if (!modelName) {
                        modelName = modelKeys.find(m => modelLower.includes(m.toLowerCase()));
                    }
                    if (!modelName) {
                        return { success: false, error: `Model '${v.model}' not found. Available: ${modelKeys.join(', ')}` };
                    }
                    
                    // Setting Model automatically switches to model mode and triggers rebuild
                    const modelResult = this._setMenuValue('objects', folder._title + '/Model', modelName);
                    if (!modelResult.success) return modelResult;
                    
                    return { success: true, object: folder._title, model: modelResult.newValue };
                }
            },

            listAvailableGeometries: {
                doc: "List all available geometry types with their specific dimension parameters. Use setAllObjectsDimensions for geometry-agnostic dimension changes, or setMenuValue with the specific parameters listed here for precise control.",
                fn: () => {
                    return {
                        geometries: ["sphere", "ellipsoid", "box", "capsule", "circle", "cone", "cylinder", 
                                "dodecahedron", "icosahedron", "octahedron", "ring", "tictac", 
                                "tetrahedron", "torus", "torusknot", "superegg"],
                        parameters: {
                            box: ["width", "height", "depth"],
                            cylinder: ["radiusTop", "radiusBottom", "height"],
                            cone: ["radius", "height"],
                            capsule: ["radius", "totalLength"],
                            sphere: ["radius"],
                            ellipsoid: ["radiusX", "radiusY", "radiusZ"],
                            torus: ["radius", "tube"],
                            superegg: ["radius", "length", "sharpness"],
                            tictac: ["radius", "length"],
                            circle: ["radius"],
                            ring: ["innerRadius", "outerRadius"],
                            icosahedron: ["radius"],
                            dodecahedron: ["radius"],
                            octahedron: ["radius"],
                            tetrahedron: ["radius"],
                            torusknot: ["radius", "tube"]
                        },
                        tip: "Use setAllObjectsDimensions(width, height, depth) for automatic parameter mapping, or setMenuValue for direct parameter control."
                    };
                }
            },

            setObjectGeometry: {
                doc: "Set an object to use a procedural geometry type (instead of a 3D model). After setting geometry, use setObjectDimensions to adjust size. Call listAvailableGeometries to see geometry types and their specific parameters.",
                params: {
                    object: "Object name or partial name (e.g. 'camera' will match 'cameraObject')",
                    geometry: "Geometry type name from listAvailableGeometries (e.g. 'sphere', 'superegg', 'box')"
                },
                fn: (v) => {
                    const gui = guiMenus.objects;
                    if (!gui) return { success: false, error: "Objects menu not found" };
                    
                    const objectLower = String(v.object).toLowerCase();
                    const folders = gui.children.filter(c => c instanceof GUI);
                    
                    // Find best matching folder
                    let folder = folders.find(c => c._title.toLowerCase() === objectLower);
                    if (!folder) {
                        folder = folders.find(c => c._title.toLowerCase().includes(objectLower));
                    }
                    if (!folder) {
                        folder = folders.find(c => objectLower.includes(c._title.toLowerCase()));
                    }
                    if (!folder) {
                        const available = folders.map(c => c._title).join(', ');
                        return { success: false, error: `Object '${v.object}' not found. Available: ${available}` };
                    }
                    
                    // Find best matching geometry type
                    const geometryTypes = ["sphere", "ellipsoid", "box", "capsule", "circle", "cone", "cylinder", 
                                           "dodecahedron", "icosahedron", "octahedron", "ring", "tictac", 
                                           "tetrahedron", "torus", "torusknot", "superegg"];
                    const geoLower = String(v.geometry).toLowerCase();
                    let geoName = geometryTypes.find(g => g.toLowerCase() === geoLower);
                    if (!geoName) {
                        geoName = geometryTypes.find(g => g.toLowerCase().includes(geoLower));
                    }
                    if (!geoName) {
                        geoName = geometryTypes.find(g => geoLower.includes(g.toLowerCase()));
                    }
                    if (!geoName) {
                        return { success: false, error: `Geometry '${v.geometry}' not found. Available: ${geometryTypes.join(', ')}` };
                    }
                    
                    // First switch to geometry mode
                    const modeResult = this._setMenuValue('objects', folder._title + '/Model or Geometry', 'geometry');
                    if (!modeResult.success) return modeResult;
                    
                    // Then set the geometry type
                    const geoResult = this._setMenuValue('objects', folder._title + '/geometry', geoName);
                    if (!geoResult.success) return geoResult;
                    
                    return { success: true, object: folder._title, geometry: geoResult.newValue };
                }
            },

            setAllObjectsGeometry: {
                doc: "Set all 3D objects to use a specific geometry type. Useful for commands like 'make all objects spheres'. After setting geometry, use setAllObjectsDimensions to adjust size, or call listAvailableGeometries to see specific parameters for each geometry type.",
                params: {
                    geometry: "Geometry type name from listAvailableGeometries (e.g. 'sphere', 'superegg', 'box')"
                },
                fn: (v) => {
                    const gui = guiMenus.objects;
                    if (!gui) return { success: false, error: "Objects menu not found" };
                    
                    const geometryTypes = ["sphere", "ellipsoid", "box", "capsule", "circle", "cone", "cylinder", 
                                           "dodecahedron", "icosahedron", "octahedron", "ring", "tictac", 
                                           "tetrahedron", "torus", "torusknot", "superegg"];
                    const geoLower = String(v.geometry).toLowerCase();
                    let geoName = geometryTypes.find(g => g.toLowerCase() === geoLower);
                    if (!geoName) {
                        geoName = geometryTypes.find(g => g.toLowerCase().includes(geoLower));
                    }
                    if (!geoName) {
                        geoName = geometryTypes.find(g => geoLower.includes(g.toLowerCase()));
                    }
                    if (!geoName) {
                        return { success: false, error: `Geometry '${v.geometry}' not found. Available: ${geometryTypes.join(', ')}` };
                    }
                    
                    const folders = gui.children.filter(c => c instanceof GUI);
                    const results = [];
                    
                    for (const folder of folders) {
                        // Switch to geometry mode
                        const modeResult = this._setMenuValue('objects', folder._title + '/Model or Geometry', 'geometry');
                        if (modeResult.success) {
                            // Set the geometry type
                            const geoResult = this._setMenuValue('objects', folder._title + '/geometry', geoName);
                            results.push({ object: folder._title, success: geoResult.success, geometry: geoName });
                        }
                    }
                    
                    return { success: true, geometry: geoName, objects: results };
                }
            },

            setAllObjectsModel: {
                doc: "Set all 3D objects to use a specific 3D model. Useful for commands like 'make all objects 737s' or 'change everything to helicopters'. Call listAvailableModels first to see available options.",
                params: {
                    model: "Exact model name from listAvailableModels"
                },
                fn: (v) => {
                    const gui = guiMenus.objects;
                    if (!gui) return { success: false, error: "Objects menu not found" };
                    
                    const modelLower = String(v.model).toLowerCase();
                    const modelKeys = Object.keys(ModelFiles);
                    let modelName = modelKeys.find(m => m.toLowerCase() === modelLower);
                    if (!modelName) {
                        modelName = modelKeys.find(m => m.toLowerCase().includes(modelLower));
                    }
                    if (!modelName) {
                        modelName = modelKeys.find(m => modelLower.includes(m.toLowerCase()));
                    }
                    if (!modelName) {
                        return { success: false, error: `Model '${v.model}' not found. Available: ${modelKeys.join(', ')}` };
                    }
                    
                    const folders = gui.children.filter(c => c instanceof GUI);
                    const results = [];
                    
                    for (const folder of folders) {
                        // Setting Model automatically switches to model mode and triggers rebuild
                        const modelResult = this._setMenuValue('objects', folder._title + '/Model', modelName);
                        results.push({ object: folder._title, success: modelResult.success, model: modelName });
                    }
                    
                    return { success: true, model: modelName, objects: results };
                }
            },

            setObjectDimensions: {
                doc: "Set the dimensions of an object's geometry using standardized width/height/depth values. Maps to appropriate parameters based on geometry type: box uses width/height/depth directly; cylinder uses width as radiusTop and radiusBottom, height as height; sphere uses width as radius; capsule uses width as radius and height as totalLength.",
                params: {
                    object: "Object name or partial name",
                    width: "Width dimension (maps to radius for round objects)",
                    height: "Height dimension (optional)",
                    depth: "Depth dimension (optional, for box geometry)"
                },
                fn: (v) => {
                    const gui = guiMenus.objects;
                    if (!gui) return { success: false, error: "Objects menu not found" };
                    
                    const objectLower = String(v.object).toLowerCase();
                    const folders = gui.children.filter(c => c instanceof GUI);
                    
                    let folder = folders.find(c => c._title.toLowerCase() === objectLower);
                    if (!folder) {
                        folder = folders.find(c => c._title.toLowerCase().includes(objectLower));
                    }
                    if (!folder) {
                        folder = folders.find(c => objectLower.includes(c._title.toLowerCase()));
                    }
                    if (!folder) {
                        const available = folders.map(c => c._title).join(', ');
                        return { success: false, error: `Object '${v.object}' not found. Available: ${available}` };
                    }
                    
                    const geoResult = this._getMenuValue('objects', folder._title + '/geometry');
                    const geometry = geoResult.success ? geoResult.value : 'sphere';
                    
                    const results = [];
                    const width = v.width;
                    const height = v.height ?? v.width;
                    const depth = v.depth ?? v.width;
                    
                    switch (geometry) {
                        case 'box':
                            results.push(this._setMenuValue('objects', folder._title + '/width', width));
                            results.push(this._setMenuValue('objects', folder._title + '/height', height));
                            results.push(this._setMenuValue('objects', folder._title + '/depth', depth));
                            break;
                        case 'cylinder':
                            results.push(this._setMenuValue('objects', folder._title + '/radiusTop', width / 2));
                            results.push(this._setMenuValue('objects', folder._title + '/radiusBottom', width / 2));
                            results.push(this._setMenuValue('objects', folder._title + '/height', height));
                            break;
                        case 'cone':
                            results.push(this._setMenuValue('objects', folder._title + '/radius', width / 2));
                            results.push(this._setMenuValue('objects', folder._title + '/height', height));
                            break;
                        case 'capsule':
                            results.push(this._setMenuValue('objects', folder._title + '/radius', width / 2));
                            results.push(this._setMenuValue('objects', folder._title + '/totalLength', height));
                            break;
                        case 'sphere':
                        case 'icosahedron':
                        case 'dodecahedron':
                        case 'octahedron':
                        case 'tetrahedron':
                            results.push(this._setMenuValue('objects', folder._title + '/radius', width / 2));
                            break;
                        case 'ellipsoid':
                            results.push(this._setMenuValue('objects', folder._title + '/radiusX', width / 2));
                            results.push(this._setMenuValue('objects', folder._title + '/radiusY', height / 2));
                            results.push(this._setMenuValue('objects', folder._title + '/radiusZ', depth / 2));
                            break;
                        case 'torus':
                            results.push(this._setMenuValue('objects', folder._title + '/radius', width / 2));
                            results.push(this._setMenuValue('objects', folder._title + '/tube', height / 4));
                            break;
                        case 'superegg':
                        case 'tictac':
                            results.push(this._setMenuValue('objects', folder._title + '/radius', width / 2));
                            results.push(this._setMenuValue('objects', folder._title + '/length', height / 2));
                            break;
                        default:
                            return { success: false, error: `Unknown geometry type: ${geometry}` };
                    }
                    
                    const allSuccess = results.every(r => r.success);
                    return { success: allSuccess, object: folder._title, geometry, dimensions: { width, height, depth } };
                }
            },

            setAllObjectsDimensions: {
                doc: "Set the dimensions of all objects' geometries using standardized width/height/depth values. Automatically maps to the correct parameters based on each object's geometry type.",
                params: {
                    width: "Width dimension (maps to radius for round objects)",
                    height: "Height dimension (optional)",
                    depth: "Depth dimension (optional, for box geometry)"
                },
                fn: (v) => {
                    const gui = guiMenus.objects;
                    if (!gui) return { success: false, error: "Objects menu not found" };
                    
                    const folders = gui.children.filter(c => c instanceof GUI);
                    const results = [];
                    
                    for (const folder of folders) {
                        const dimResult = this.api.setObjectDimensions.fn.call(this, {
                            object: folder._title,
                            width: v.width,
                            height: v.height,
                            depth: v.depth
                        });
                        results.push({ object: folder._title, ...dimResult });
                    }
                    
                    return { success: true, objects: results };
                }
            }

        }

        this._menuDocCache = null;
    }

    _extractControllerDoc(controller) {
        const doc = {
            name: controller._name,
            property: controller.property,
            type: controller.constructor.name.replace('Controller', '').toLowerCase(),
            tooltip: controller.domElement?.title || null,
            currentValue: controller.getValue()
        };

        if (controller._min !== undefined) doc.min = controller._min;
        if (controller._max !== undefined) doc.max = controller._max;
        if (controller._step !== undefined) doc.step = controller._step;
        if (controller._values) doc.options = controller._values;

        return doc;
    }

    _extractGUIDoc(gui) {
        const result = {
            name: gui._title,
            tooltip: gui.domElement?.title || null,
            controls: [],
            folders: []
        };

        for (const child of gui.children) {
            if (child instanceof GUI) {
                result.folders.push(this._extractGUIDoc(child));
            } else {
                result.controls.push(this._extractControllerDoc(child));
            }
        }
        return result;
    }

    getMenuDocumentation() {
        if (this._menuDocCache) return this._menuDocCache;

        const docs = {};
        for (const [menuId, gui] of Object.entries(guiMenus)) {
            docs[menuId] = this._extractGUIDoc(gui);
        }
        this._menuDocCache = docs;
        return docs;
    }

    _getControlSummary(gui, prefix = '') {
        const controls = [];
        for (const child of gui.children) {
            if (child instanceof GUI) {
                controls.push(...this._getControlSummary(child, prefix + child._title + '/'));
            } else {
                const type = child.constructor.name.replace('Controller', '').toLowerCase();
                let info = `${prefix}${child._name} (${type})`;
                if (child._min !== undefined && child._max !== undefined) {
                    info += ` [${child._min}-${child._max}]`;
                }
                if (child._values && child._values.length <= 5) {
                    info += ` options: ${child._values.join('|')}`;
                }
                controls.push(info);
            }
        }
        return controls;
    }

    getMenuSummary() {
        const summary = {};
        for (const [menuId, gui] of Object.entries(guiMenus)) {
            const controls = this._getControlSummary(gui);
            if (controls.length > 0) {
                summary[menuId] = controls;
            }
        }
        return summary;
    }

    invalidateMenuDocCache() {
        this._menuDocCache = null;
    }

    _findController(gui, path) {
        const parts = path.split('/');
        let current = gui;

        for (let i = 0; i < parts.length; i++) {
            const name = parts[i];
            const nameLower = name.toLowerCase();
            const isLast = i === parts.length - 1;

            if (isLast) {
                // Try exact match first
                let controller = current.controllers.find(c => c._name === name);
                if (controller) return { success: true, controller };
                
                // Try case-insensitive match on display name
                controller = current.controllers.find(c => c._name.toLowerCase() === nameLower);
                if (controller) return { success: true, controller };
                
                // Try match on property name
                controller = current.controllers.find(c => c.property === name);
                if (controller) return { success: true, controller };
                
                // Try case-insensitive match on property
                controller = current.controllers.find(c => c.property && c.property.toLowerCase() === nameLower);
                if (controller) return { success: true, controller };
                
                // Try partial match (name contains search term)
                controller = current.controllers.find(c => 
                    c._name.toLowerCase().includes(nameLower) || 
                    (c.property && c.property.toLowerCase().includes(nameLower))
                );
                if (controller) return { success: true, controller };
                
                // List available controls in error
                const available = current.controllers.map(c => c._name).join(', ');
                return { success: false, error: `Control '${name}' not found. Available: ${available}` };
            } else {
                // Try exact match first
                let folder = current.children.find(c => c instanceof GUI && c._title === name);
                if (!folder) {
                    // Try case-insensitive
                    folder = current.children.find(c => c instanceof GUI && c._title.toLowerCase() === nameLower);
                }
                if (!folder) {
                    // Try partial match (folder name contains search term)
                    folder = current.children.find(c => c instanceof GUI && c._title.toLowerCase().includes(nameLower));
                }
                if (!folder) {
                    const available = current.children.filter(c => c instanceof GUI).map(c => c._title).join(', ');
                    return { success: false, error: `Folder '${name}' not found. Available: ${available}` };
                }
                current = folder;
            }
        }
        return { success: false, error: 'Empty path' };
    }

    _setMenuValue(menuId, path, value) {
        const gui = guiMenus[menuId];
        if (!gui) return { success: false, error: `Menu '${menuId}' not found` };

        const result = this._findController(gui, path);
        if (!result.success) return result;

        const controller = result.controller;
        try {
            let finalValue = value;
            
            // For dropdown controllers, match option values
            if (controller._values && Array.isArray(controller._values)) {
                const valueLower = String(value).toLowerCase();
                // Try exact match first
                if (!controller._values.includes(value)) {
                    // Try case-insensitive match
                    let matched = controller._values.find(v => String(v).toLowerCase() === valueLower);
                    if (!matched) {
                        return { success: false, error: `Value '${value}' not found. Options: ${controller._values.join(', ')}` };
                    }
                    finalValue = matched;
                }
            }
            
            controller.setValue(finalValue);
            this.invalidateMenuDocCache();
            return { success: true, oldValue: controller.initialValue, newValue: finalValue };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    _getMenuValue(menuId, path) {
        const gui = guiMenus[menuId];
        if (!gui) return { success: false, error: `Menu '${menuId}' not found` };

        const result = this._findController(gui, path);
        if (!result.success) return result;

        return { success: true, value: result.controller.getValue() };
    }

    _executeMenuButton(menuId, path) {
        const gui = guiMenus[menuId];
        if (!gui) return { success: false, error: `Menu '${menuId}' not found` };

        const result = this._findController(gui, path);
        if (!result.success) return result;

        const controller = result.controller;
        if (controller.constructor.name !== 'FunctionController') {
            return { success: false, error: `Control '${path}' is not a button (it's a ${controller.constructor.name})` };
        }

        try {
            controller.getValue().call(controller.object);
            controller._callOnChange();
            return { success: true, executed: path };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    getDocumentation() {
        return Object.entries(this.api).reduce((acc, [key, value]) => {
            let paramsString = Object.entries(value.params || {})
                .map(([param, desc]) => `${param} (${desc})`)
                .join(", ");
            let docString = value.doc || "No documentation available.";
            acc[key] = `${docString} Parameters: ${paramsString}`;
            return acc;
        }, {});
    }

    getFullDocumentation() {
        return {
            api: this.getDocumentation(),
            menus: this.getMenuDocumentation(),
            menuIds: Object.keys(guiMenus)
        };
    }

    handleAPICall(call) {
        console.log("Handling API call:", call);
        const apiFn = this.api[call.fn];
        if (!apiFn) {
            return { success: false, error: `Unknown API function: ${call.fn}` };
        }
        try {
            const result = apiFn.fn(call.args);
            return { success: true, fn: call.fn, result };
        } catch (e) {
            return { success: false, fn: call.fn, error: e.message };
        }
    }

    call(fn, args = {}) {
        return this.handleAPICall({fn, args});
    }

}

export const sitrecAPI = new CSitrecAPI();
