import {CNode} from "./CNode";
import {Globals, guiMenus, NodeMan, Sit} from "../Globals";
import {assert} from "../assert";
import {configParams} from "../login";
import {isLocal, SITREC_APP, SITREC_TERRAIN} from "../configUtils";
import {CNodeSwitch} from "./CNodeSwitch";
import {EUSToLLA} from "../LLA-ECEF-ENU";
import {CNodeTerrain} from "./CNodeTerrain";
import {par} from "../par";
import {addAlignedGlobe} from "../Globe";
import {showHider} from "../KeyBoardHandler";

export class CNodeTerrainUI extends CNode {
    constructor(v) {

        // Hijack the ID as we want to use it for the terain node
        const initialID = v.id
        v.id = "terrainUI"
        super(v);

        console.log("CNodeTerrainUI: constructor with \n" + JSON.stringify(v));

        assert (v.terrain === undefined, "CNodeTerrainUI: terrain node already exists, please remove it from the sit file")

        //this.debugLog = true;

        this.lat = v.lat;
        this.lon = v.lon;
        this.nTiles = v.nTiles;
        this.zoom = v.zoom;
        this.elevationScale = v.elevationScale ?? 1;
        this.textureDetail = v.textureDetail ?? 1;
        this.elevationDetail = v.elevationDetail ?? 1;
        
        // Default subdivision sizes (can be overridden by mapTypes)
        this.elevationSubSize = 4000; // 2000 * 1.414;
        this.textureSubSize = 2000;

        this.adjustable = v.adjustable ?? true;

        this.updateWhilePaused = true;


        this.refresh = false;


        if (configParams.customMapSources !== undefined) {
            // start with the custom map sources
            this.mapSources = configParams.customMapSources;
        } else {
            this.mapSources = {};
        }

        // add the default map sources, wireframe and flat shading
        this.mapSources = {
            ...this.mapSources,
            wireframe: {
                name: "Wireframe",
                mapURL: (z, x, y) => {
                    return null;
                },
                maxZoom: 15,
            },
            FlatShading: {
                name: "Flat Shading",
                mapURL: (z, x, y) => {
                    return SITREC_APP + "data/images/grey-256x256.png?v=1";
                },
                maxZoom: 15,
            },
            OceanSurface: {
                name: "Ocean Surface",
                mapURL: (z, x, y) => {
                    return SITREC_APP + "data/images/28_sea water texture-seamless.jpg";
                },
                maxZoom: 18, // this is the level at which the ocean tile is ideally physically real sized
                generateMipmaps: true,
            },
            ElevationColor: {
                name: "Elevation Pseudo-Color",
                isElevationColor: true,
                maxZoom: 18,   // for ocean tiles to work, this should be the same as for Ocean Surface
                colorBands: [
                    { altitude: 1,      color: { red: 0, green: 0, blue: 255 } }, // Blue for water/low elevation
                    { altitude: 1,      color: { red: 140, green: 176, blue: 130 } }, // Green start
                   // { altitude: 1206*3, color: { red: 140, green: 176, blue: 130 } },
                    { altitude: 1901*3, color: { red: 214, green: 231, blue: 212 } },
                    { altitude: 2182*3, color: { red: 240, green: 241, blue: 181 } },
                    { altitude: 2464*3, color: { red: 251, green: 222, blue: 154} },
                    { altitude: 2808*3, color: { red: 217, green: 181, blue: 105 } },
                    { altitude: 3053*3, color: { red: 209, green: 209, blue: 209 } },
                    { altitude: 3312*3, color: { red: 255, green: 255, blue: 2555 } },
                ]
            }
        }

        // local debugging, add a color test map
        //if (isLocal) {
            this.mapSources = {
                ...this.mapSources,
                RGBTest: {
                    name: "RGB Test",
                    mapURL: (z, x, y) => {
                        return SITREC_APP + "data/images/colour_bars_srgb-255-128-64.png?v=1";
                    },
                    maxZoom: 15,
                },
                // GridTest: {
                //     name: "Grid Test",
                //     mapURL: (z, x, y) => {
                //         return SITREC_APP + "data/images/grid.png?v=1";
                //     },
                //     maxZoom: 15,
                // },
                ElevationBitmap: {
                    name: "Elevation Bitmap",
                    mapURL: (z, x, y) => {
                        return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
                    },
                },

                Debug: {
                    name: "Debug Info",
                    isDebug: true,
                    maxZoom: 20,
                },

                Local: {
                    name: "Local",
                    mapURL: (z,x,y) => {
                        return `${SITREC_TERRAIN}imagery/esri/${z}/${y}/${x}.jpg`
                    },

                    maxZoom: 8,
                    minZoom: 0,
                    tileSize: 256,
                    attribution: "",
                    textureSubSize: 500,
                }



            }
        //}

        // add any mapsources defined in the environment variable
        // this allows Docker builds, etc, to specify different map sources
        // a map source definition should be a JSON string
        // like:
        // env[SITREC_MAPTYPE_MAPBOX] = "{\"name\":\"MapBox\",\"urlTemplate\":\"https://api.mapbox.com/v4/mapbox.{layer}/{z}/{x}/{y}@2x.jpg80?access_token=pk.eyJ1IjoibWlja3dlc3QiLCJhIjoiY21ianEydHIwMGliaTJrcHB4cDgzbGZuaSJ9.J7jU9B_pz4Mo723klYpywQ\",\"layers\":{\"satellite\":{\"type\":\"jpg\"}},\"layer\":\"satellite\",\"minZoom\":0,\"maxZoom\":18,\"supportsOceanSurface\":true}"

        // iterate over all Globals.env keys
        // if the key starts with SITREC_MAPTYPE_, then we parse the value as JSON
        // and add it to the mapSources
        if (Globals.env) {
            for (const envKey in Globals.env) {
                if (envKey.startsWith('SITREC_MAPTYPE_')) {
                    try {
                        const mapConfig = JSON.parse(Globals.env[envKey]);
                        // Extract the map type name from the env key (e.g., SITREC_MAPTYPE_MAPBOX -> MapBox)
                        const mapTypeName = envKey.replace('SITREC_MAPTYPE_', '');
                        
                        // If the config has a urlTemplate, convert it to a mapURL function
                        if (mapConfig.urlTemplate) {
                            const template = mapConfig.urlTemplate;
                            mapConfig.mapURL = (z, x, y) => {
                                let url = template
                                    .replace('{z}', z)
                                    .replace('{x}', x)
                                    .replace('{y}', y);
                                
                                // Replace layer placeholder if specified
                                if (mapConfig.layer) {
                                    url = url.replace('{layer}', mapConfig.layer);
                                }
                                
                                return url;
                            };
                            // Remove the template property as it's no longer needed
                            delete mapConfig.urlTemplate;
                        }
                        
                        // Add to mapSources using the extracted name
                        this.mapSources[mapTypeName] = mapConfig;
                        console.log(`Added map source from environment: ${mapTypeName}`, mapConfig.name);
                    } catch (e) {
                        console.error(`Failed to parse map source from ${envKey}:`, e);
                    }
                }
            }
        }

        // extract a K/V pair from the mapSources
        // for use in the GUI.
        // key is the name, value is the id
        this.mapTypesKV = {}
        for (const mapType in this.mapSources) {
            if (!this.mapSources[mapType].excludeFromMenu) {
                const mapDef = this.mapSources[mapType]
                this.mapTypesKV[mapDef.name] = mapType
            }
        }


        // This is the default map type if none specificed in the Sit file
        // Use DOCKER_MAP_TYPE if building for Docker, otherwise use DEFAULT_MAP_TYPE
        const defaultMapType =  process.env.DOCKER_BUILD
            ? (process.env.DOCKER_MAP_TYPE ?? "Debug")
            : (process.env.DEFAULT_MAP_TYPE ?? "Debug");

        // map type from the terrain object in a a saved sitch, or default to the first one
        this.mapType = v.mapType ?? defaultMapType ?? Object.keys(this.mapSources)[0];

        this.gui = guiMenus.terrain;
        this.mapTypeMenu = this.gui.add(this, "mapType", this.mapTypesKV).listen().name("Map Type")
            .tooltip("Map type for terrain textures (seperate from elevation data)")

//////////////////////////////////////////////////////////////////////////////////////////
        // same for elevation sources
        if (configParams.customElevationSources !== undefined) {
            this.elevationSources = configParams.customElevationSources;
        } else {
            this.elevationSources = {};
        }

        this.elevationSources = {
            ...this.elevationSources,
            // and some defaults
            Flat: {
                name: "Flat",
                url: "",
                maxZoom: 20,
                minZoom: 0,
                tileSize: 256,
                attribution: "",
            },
            Local: {
                name: "Local",
                // Tiles stored in sitrec-terrain/elevation/z/x/y.png
                mapURL: (z,x,y) => {
                    return `${SITREC_TERRAIN}elevation/${z}/${x}/${y}.png`
                },

                maxZoom: 6,
                minZoom: 0,
                tileSize: 256,
                attribution: "",
            }
        }
        // and the KV pair for the GUI
        this.elevationTypesKV = {}
        for (const elevationType in this.elevationSources) {
            const elevationDef = this.elevationSources[elevationType]
            this.elevationTypesKV[elevationDef.name] = elevationType
        }

        const defaultElevationType =  process.env.DOCKER_BUILD
            ? (process.env.DOCKER_ELEVATION_TYPE ?? "Flat")
            : (process.env.DEFAULT_ELEVATION_TYPE ?? "Flat");

        this.elevationType = v.elevationType ?? defaultElevationType ?? Object.keys(this.elevationSources)[0]
        // add the menu
        this.elevationTypeMenu = this.gui.add(this, "elevationType", this.elevationTypesKV).listen().name("Elevation Type")
            .tooltip("Elevation data source for terrain height data")

        this.elevationTypeMenu.onChange(v => {

            // elevation map has changed, so kill the old one
            this.log("Elevation type changed to " + v + " so unloading the elevation map")
            this.terrainNode.reloadMap(this.mapType)
        })


/////////////////////////////////////////////////////

        assert(this.lat !== undefined, "CNodeTerrainUI: lat must be defined")

        this.oldLat = this.lat;
        this.oldLon = this.lon;
        this.oldZoom = this.zoom;
        this.oldNTiles = this.nTiles;
        this.oldElevationScale = this.elevationScale;


        this.mapTypeMenu.onChange(v => {

            // do this async, as we might need to wait for the capabilities to be loaded
            this.setMapType(v).then(() => {
                this.terrainNode.loadMapTexture(v)
            })
        })

        this.debugElevationGrid = false;

       // if (v.fullUI) {

            this.latController = this.gui.add(this, "lat", -85, 85, .001).onChange(v => {
                this.flagForRecalculation()
                this.startLoading = false;
            }).onFinishChange(v => {
                this.startLoading = true
            }).tooltip("Latitude of the center of the terrain")


            this.lonController = this.gui.add(this, "lon", -180, 180, .001).onChange(v => {
                this.flagForRecalculation()
                this.startLoading = false;
            }).onFinishChange(v => {
                this.startLoading = true
            }).tooltip("Longitude of the center of the terrain")

            this.zoomController = this.gui.add(this, "zoom", 2, 15, 1).onChange(v => {
                this.flagForRecalculation()
                this.startLoading = false;
            }).onFinishChange(v => {
                this.startLoading = true
            }).tooltip("Zoom level of the terrain. 2 is the whole world, 15 is few city blocks")

            this.nTilesController = this.gui.add(this, "nTiles", 1, 8, 1).onChange(v => {
                this.flagForRecalculation()
                this.startLoading = false;
            }).onFinishChange(v => {
                this.startLoading = true
            }).tooltip("Number of tiles in the terrain. More tiles means more detail, but slower loading. (NxN)")


            // adds a button to refresh the terrain
            this.gui.add(this, "doRefresh").name("Refresh")
                .tooltip("Refresh the terrain with the current settings. Use for network glitches that might have caused a failed load")



            // a toggle to show or hide the debug elevation grid

            this.gui.add(this, "debugElevationGrid").name("Debug Grids").onChange(v => {
                this.terrainNode.refreshDebugGrids();
            }).tooltip("Show a grid of ground textures (Green) and elevation data (Blue)")


            this.zoomToTrackSwitchObject = new CNodeSwitch({
                id: "zoomToTrack", kind: "Switch",
                inputs: {"-": "null"}, desc: "Zoom to track",
                tip: "Zoom to the extents of the selected track (for the duration of the Sitch frames)",
            }, this.gui).onChange(track => {
                this.zoomToTrack(track)
            })
        // }

        this.elevationScaleController = this.gui.add(this, "elevationScale", 0, 10, 0.1).onFinishChange(v => {
            this.flagForRecalculation()
            this.startLoading = true
        }).elastic(10, 100)
            .tooltip("Scale factor for the elevation data. 1 is normal, 0.5 is half height, 2 is double height")

        // Note: Tile Segments is controlled via the global settings menu in CustomSupport.js
        // No local UI controller needed here

        this.disableDynamicSubdivision = false;
        if (isLocal) {

            this.textureDetailController = this.gui.add(this, "textureDetail", 0.1, 3, 0.1)
                .tooltip("Detail level for texture subdivision. Higher values = more detail. 1 is normal, 0.5 is less detail, 2 is more detail")

            this.elevationDetailController = this.gui.add(this, "elevationDetail", 0.1, 3, 0.1)
                .tooltip("Detail level for elevation subdivision. Higher values = more detail. 1 is normal, 0.5 is less detail, 2 is more detail")

            this.disableDynamicSubdivisionController = this.gui.add(this, "disableDynamicSubdivision").name("Disable Dynamic Subdivision")
                .tooltip("Disable dynamic subdivision of terrain tiles. Freezes the terrain at the current level of detail. Useful for debugging.")
        }


        // terrain serializaton is handled by CustomSupport.js getCustomSitchString()
        // this.addSimpleSerial("debugElevationGrid")
        // this.addSimpleSerial("elevationScale")
        // this.addSimpleSerial("mapType")
        // this.addSimpleSerial("elevationType")

        this.dynamic = v.dynamic ?? false;
        
        // Mirror this.dynamic to Globals.dynamicSubdivision
        Globals.dynamicSubdivision = this.dynamic;
        
        this.dynamicController = this.gui.add(this, "dynamic").name("Dynamic Subdivision").onChange(v => {
            // Update the global mirror
            Globals.dynamicSubdivision = v;
            
            this.updateUIVisibility();
            this.terrainNode.reloadMap(this.mapType);
            
            // Update globe visibility based on new state
            this.updateGlobeVisibility();
            
            // Update black sphere visibility based on new state
            this.terrainNode.updateBlackSphereVisibility();
        });

        // setMapType is async because it loads the capabilities
        this.setMapType(this.mapType).then(() => {
            this.terrainNode = new CNodeTerrain({
                id: initialID,
                UINode: this});
        })

        // Set initial UI visibility
        this.updateUIVisibility();

    }

    updateUIVisibility() {
        // When Dynamic Subdivision is true, hide lat, lon, zoom, nTiles and zoom to track
        // When Dynamic Subdivision is false, hide Disable Dynamic Subdivision
        if (this.dynamic) {
            // Hide lat, lon, zoom, nTiles and zoom to track controllers
            if (this.latController) {
                this.latController.domElement.style.display = 'none';
            }
            if (this.lonController) {
                this.lonController.domElement.style.display = 'none';
            }
            if (this.zoomController) {
                this.zoomController.domElement.style.display = 'none';
            }
            if (this.nTilesController) {
                this.nTilesController.domElement.style.display = 'none';
            }
            if (this.zoomToTrackSwitchObject && this.zoomToTrackSwitchObject.controller) {
                this.zoomToTrackSwitchObject.controller.domElement.style.display = 'none';
            }
            // Show Disable Dynamic Subdivision controller (if it exists)
            if (this.disableDynamicSubdivisionController) {
                this.disableDynamicSubdivisionController.domElement.style.display = '';
            }
        } else {
            // Show lat, lon, zoom, nTiles and zoom to track controllers
            if (this.latController) {
                this.latController.domElement.style.display = '';
            }
            if (this.lonController) {
                this.lonController.domElement.style.display = '';
            }
            if (this.zoomController) {
                this.zoomController.domElement.style.display = '';
            }
            if (this.nTilesController) {
                this.nTilesController.domElement.style.display = '';
            }
            if (this.zoomToTrackSwitchObject && this.zoomToTrackSwitchObject.controller) {
                this.zoomToTrackSwitchObject.controller.domElement.style.display = '';
            }
            // Hide Disable Dynamic Subdivision controller (if it exists)
            if (this.disableDynamicSubdivisionController) {
                this.disableDynamicSubdivisionController.domElement.style.display = 'none';
            }
        }
    }

    updateGlobeVisibility() {
        // Globe should only be loaded/displayed when:
        // 1. Sit.useGlobe is true
        // 2. Globals.dynamicSubdivision is false
        const shouldShowGlobe = Sit.useGlobe && !Globals.dynamicSubdivision;
        
        if (shouldShowGlobe && !par.globe) {
            // Need to load the globe
            console.log("Loading globe (useGlobe=true, dynamicSubdivision=false)");
            par.globe = addAlignedGlobe(Sit.globeScale ?? (Sit.terrain !== undefined ? 0.9999 : 1.0));
            showHider(par.globe, "[G]lobe", true, "g");
        } else if (!shouldShowGlobe && par.globe) {
            // Need to hide/remove the globe
            console.log("Hiding globe (useGlobe=" + Sit.useGlobe + ", dynamicSubdivision=" + Globals.dynamicSubdivision + ")");
            par.globe.visible = false;
        } else if (shouldShowGlobe && par.globe) {
            // Globe exists and should be visible
            par.globe.visible = true;
        }
    }

    getSourceDef() {
        // get the mapSource for the current mapType
        const sourceDef = this.mapSources[this.mapType];
        assert(sourceDef !== undefined, "CNodeTerrain: sourceDef for " + this.mapType + " not found in mapSources")
        return sourceDef;
    }


    async setMapType(v) {
        const mapType = v;
        assert(this.mapSources, "CNodeTerrainUI: mapSources not defined");
        const mapDef = this.mapSources[mapType];

        assert(mapDef !== undefined, "CNodeTerrainUI: mapDef for " + mapType + " not found in mapSources");

        // does it have pre-listed layers in the mapDef?
        if (mapDef.layers !== undefined) {
            // nothing needed here
        } else {
            // no layers, so we check for WMS capabilities
            // if there's one, then we load it
            // and extract the layers from it

            // also, if we have a capabilities URL, then start loading it
            if (mapDef.capabilities !== undefined) {

                let response;
                try {
                     response = await fetch(mapDef.capabilities);
                } catch (e) {
                    // if it returns an error, then we should fall back on the "Debug" maptype
                    console.log("Error fetching capabilities for " + mapType + " from " + mapDef.capabilities + ": " + e.message);
                    console.log("Falling back to Debug map type");
                    this.mapType = "Debug";
                    return this.setMapType(this.mapType);
                }


                const data = await response.text();
                console.log("Capabilities for " + mapType)
                //console.log(data)
                // convert XML to object
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(data, "text/xml");

                // two different types of WMS capabilities
                // WMS uses "Layer" and WMTS uses "Contents"
                // so we need to check for both
                const contents = xmlDoc.getElementsByTagName("Contents");
                mapDef.layers = {}

                if (contents.length > 0) {
                    console.log("Contents:")
                    const layers = xmlDoc.getElementsByTagName("Layer");
                    for (let layer of layers) {
                        const layerName = layer.getElementsByTagName("ows:Identifier")[0].textContent;
                        mapDef.layers[layerName] = {
                            // nothing yet, extract more later
                        }
                    }
                } else {
                    const layers = xmlDoc.getElementsByTagName("Layer");
                    for (let layer of layers) {
                        const layerName = layer.getElementsByTagName("Name")[0].childNodes[0].nodeValue;
                        mapDef.layers[layerName] = {}
                    }
                }
            }
        }

        // use either the passed in mapDef, or the one we just extracted from the capabilities
        this.mapDef = mapDef;
        this.layer = this.mapDef.layer;
        // Remove any layer menu now, as this might not have on
        this.layersMenu?.destroy()
        this.layersMenu = null;
        this.updateLayersMenu(mapDef.layers);
    }

    updateLayersMenu(layers) {
        // layers is an array of layer names
        // we want a KV pair for the GUI
        // where both K and V are the layer name
        this.localLayers = {}

        // iterate over keys (layer names) to make the identicak KV pair for the GUI
        for (let layer in layers) {
            this.localLayers[layer] = layer
        }

        // set the layer to the specified default, or the first one in the capabilities
        if (this.mapDef.layer !== undefined) {
            this.layer = this.mapDef.layer;
        } else {
            this.layer = Object.keys(this.localLayers)[0]
        }
        this.layersMenu = this.gui.add(this, "layer", this.localLayers).listen().name("Layer")
            .tooltip("Layer for the current map type's terrain textures")

        // if the layer has changed, then unload the map and reload it
        // new layer will be handled by the mapDef.layer
        this.layersMenu.onChange(v => {

            this.terrainNode.unloadMap(this.mapType)
            this.terrainNode.loadMap(this.mapType)
        })

    }

    // note this is not the most elegant way to do this
    // but if the terrain is being removed, then we assume the GUI is too
    // this might not be the case, in the future
    dispose() {
        super.dispose();
    }


    zoomToTrack(v) {
        if (Globals.dontAutoZoom) return;
        const trackNode = NodeMan.get(v);
        assert(trackNode.getLLAExtents !== undefined, "Track does not have getLLAExtents")
        const {minLat, maxLat, minLon, maxLon, minAlt, maxAlt} = trackNode.getLLAExtents();

        this.zoomToLLABox(minLat, maxLat, minLon, maxLon)

    }

    // given two Vector3s, zoom to the box they define
    zoomToBox(min, max) {
        // min and max are in EUS, so convert to LLA
        const minLLA = EUSToLLA(min);
        const maxLLA = EUSToLLA(max);
        this.zoomToLLABox(minLLA.x, maxLLA.x, minLLA.y, maxLLA.y)
    }

    zoomToLLABox(minLat, maxLat, minLon, maxLon) {
        this.lat = (minLat + maxLat) / 2;
        this.lon = (minLon + maxLon) / 2;

        const maxZoom = 15;
        const minZoom = 3;

        // find the zoom level that fits the track, ignore altitude
        // clamp to maxZoom
        // NOTE THIS IS NOT ACCOUNTING FOR WEB MERCATOR PROJECTION
        const latDiff = maxLat - minLat;
        const lonDiff = maxLon - minLon;
        if (latDiff < 0.0001 || lonDiff < 0.0001) {
            this.zoom = maxZoom;
        } else {
            const latZoom = Math.log2(360 / latDiff);
            const lonZoom = Math.log2(180 / lonDiff);
            this.zoom = Math.min(maxZoom, Math.floor(Math.min(latZoom, lonZoom) - 1));
            this.zoom = Math.max(minZoom, this.zoom);
        }
        this.latController.updateDisplay();
        this.lonController.updateDisplay();
        this.zoomController.updateDisplay();
        this.nTilesController.updateDisplay();

        // reset the switch
        this.zoomToTrackSwitchObject.selectFirstOptionQuietly();


        this.doRefresh();
    }


    doRefresh() {
        this.log("Refreshing terrain")
        assert(this.terrainNode.maps[this.mapType].map !== undefined, "Terrain map not defined when trying the set startLoading")

        if (!this.dynamic) {
            // old way, defer loading
            this.startLoading = true;
            this.flagForRecalculation();
        } else {
            // for dynamic maps, they are async anyway
            this.terrainNode.reloadMap(this.mapType)
        }
    }

    flagForRecalculation() {
        this.recalculateSoon = true;
    }

    update() {
        if (this.recalculateSoon) {
            console.log("Recalculating terrain as recalculatedSoon is true. startLoading=" + this.startLoading)

            // something of a patch with terrain, as it's often treated as a global
            // by other nodes (like the track node, when using accurate terrain for KML polygons)
            // so we recalculate it first, and then recalculate all the other nodes
            this.recalculate();

            this.recalculateSoon = false;
        }

        // we need to wait for this.terrainNode.maps[this.mapType].map to be defined
        // because it's set async in setMapType
        // setMapType can be waiting for the capabilities to be loaded
        // if (this.startLoading && this.terrainNode.maps[this.mapType].map !== undefined) {
        //     console.log("Starting to load terrain as startLoading is true, recalulateSoon=" + this.recalculateSoon)
        //     this.startLoading = false;
        //     assert(this.terrainNode.maps[this.mapType].map !== undefined, "Terrain map not defined")
        //     this.terrainNode.maps[this.mapType].map.startLoadingTiles();
        //     assert(this.terrainNode.elevationMap !== undefined, "Elevation map not defined")
        //     this.terrainNode.elevationMap.startLoadingTiles();
        // }


        if (this.dynamic & !this.disableDynamicSubdivision) {

            const views = [
                NodeMan.get("lookView"),
                NodeMan.get("mainView")
            ];

            // Call view-independent operations once per frame for elevation map
            if (this.terrainNode.elevationMap !== undefined) {
                this.terrainNode.elevationMap.subdivideTilesGeneral();
            }

            // Call view-independent operations once per frame for texture map
            if (this.terrainNode.maps[this.mapType].map !== undefined) {
                this.terrainNode.maps[this.mapType].map.subdivideTilesGeneral();
            }

            // subdivide the elevation first so elevation requests will come before textures
            // this makes it more likely that the elevation will be ready when the texture is ready to make a tile.
            if (this.terrainNode.elevationMap !== undefined) {
                // For elevation, call with all views so both cameras are applied for subdivision decisions
                // not sure about this. elevation is used at a lower resolution than the textures
                // as the tiles are configurable (default: tileSegments x tileSegments)
                for (const view of views) {
                    if (view && view.visible) {
                        this.terrainNode.elevationMap.subdivideTilesViewSpecific(view, this.elevationSubSize / this.elevationDetail);
                    }
                }
            }

            // For texture maps, call subdivideTilesViewSpecific separately for each view
            if (this.terrainNode.maps[this.mapType].map !== undefined) {
                // Get the current map definition to check for textureSubSize override
                const mapDef = this.mapSources[this.mapType];
                const textureSubSize = mapDef?.textureSubSize ?? this.textureSubSize;
                
                for (const view of views) {
                    if (view && view.visible) {
                        this.terrainNode.maps[this.mapType].map.subdivideTilesViewSpecific(view, textureSubSize / this.textureDetail);
                    }
                }
            }

        }

    }

    recalculate() {
        // if the values have changed, then we need to make a new terrain node
        if (this.lat === this.oldLat && this.lon === this.oldLon && this.zoom === this.oldZoom
            && this.nTiles === this.oldNTiles
            && !this.refresh) {

            if (this.elevationScale === this.oldElevationScale)
                return;

            // // so JUST the elevation scale has changed, so we can just update the elevation map
            // // and recalculate the curves for the tiles in the current map

            const map = this.terrainNode.maps[this.mapType].map;
            map.options.zScale = this.elevationScale;

            //also set the elevation scale on the elevation map
            // (probably only need to do this)
            if (this.terrainNode.elevationMap) {
                this.terrainNode.elevationMap.options.zScale = this.elevationScale;
            }

            map.recalculateCurveMap(this.radius, true)

            return;

        }
        this.oldLat = this.lat;
        this.oldLon = this.lon;
        this.oldZoom = this.zoom;
        this.oldNTiles = this.nTiles;
        this.oldElevationScale = this.elevationScale;
        this.refresh = false;


        let terrainID = "TerrainModel"
        // remove the old terrain
        if (this.terrainNode) {
            terrainID = this.terrainNode.id;
            NodeMan.disposeRemove(this.terrainNode)
        }
        // and make a new one
        this.terrainNode = new CNodeTerrain({
            id: terrainID,
            deferLoad: true,
            UINode: this,
            }
        )
    }

    // one time button to add a terrain node
    addTerrain() {
        this.recalculate();
        this.gui.remove(this.addTerrain)
    }


}