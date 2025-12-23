// Client-side Sitrec API with callable functions and documentation
import {GlobalDateTimeNode, guiMenus, NodeMan} from "./Globals";
import {isLocal} from "./configUtils";
import {showError} from "./showError";
import GUI from "./js/lil-gui.esm";

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
                doc: "Set the camera orientation based on Right Ascension and Declination. Use for looking at stars and other fixed sky object (not planets or the sun",
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

            //{ key: "showFlareRegion", name: "Flare Region", object: this, action: () => this.flareRegionGroup.visible = this.showFlareRegion},
            satellitesFlareRegionOn: {
                doc: "Loads current Starlink satellites.",
                fn: () => {
                    const nightSky = NodeMan.get("NightSkyNode");
                    if(nightSky) {
                        nightSky.satellites.updateStarlink();
                    }
                }
            },


            //{ key: "showFlareBand", name: "Flare Band", object: this, action: () => this.flareBandGroup.visible = this.showFlareBand},

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
            controller.setValue(value);
            this.invalidateMenuDocCache();
            return { success: true, oldValue: controller.initialValue, newValue: value };
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

}

export const sitrecAPI = new CSitrecAPI();
