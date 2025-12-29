import {sitrecAPI} from "./CSitrecAPI";
import {guiMenus} from "./Globals";
import GUI from "./js/lil-gui.esm";
import {ModelFiles} from "./nodes/CNode3DObject";
import * as math from 'mathjs';

const GEOMETRY_TYPES = ["sphere", "ellipsoid", "box", "capsule", "circle", "cone", "cylinder",
    "dodecahedron", "icosahedron", "octahedron", "ring", "tictac",
    "tetrahedron", "torus", "torusknot", "superegg"];

const ALIASES = {
    fov: ["fov", "vfov", "hfov", "field of view", "fieldofview"],
    satellites: ["sats", "satellites", "satellite", "sat"],
    starlink: ["starlink", "starlinks"],
    helicopter: ["helicopter", "heli", "chopper"],
    jet: ["jet", "fighter", "f-15", "f15", "f-18", "f18"],
    drone: ["drone", "uav", "mq-9", "mq9", "predator", "reaper"],
    ambient: ["ambient", "ambient only", "ambientonly"],
    stars: ["stars", "star"],
    grid: ["grid", "grids"],
    labels: ["labels", "label", "names"],
    terrain: ["terrain", "ground", "earth"],
    play: ["play", "start", "unpause", "resume"],
    pause: ["pause", "stop"],
};

const BOOLEAN_TRUE = ["on", "true", "yes", "show", "enable", "enabled", "visible", "1"];
const BOOLEAN_FALSE = ["off", "false", "no", "hide", "disable", "disabled", "invisible", "hidden", "0"];

class CClientNLU {
    constructor() {
        this.patterns = this._buildPatterns();
    }

    _buildPatterns() {
        return [
            {
                name: "set_fov_variants",
                regex: /^(?:set\s+)?(?:v?fov|h?fov|field\s*of\s*view)\s*(?:to\s+)?(\d+(?:\.\d+)?)$/i,
                extract: (match) => ({intent: "SET_VALUE", slots: {path: "vFOV", value: parseFloat(match[1])}}),
                confidence: 0.95
            },
            {
                name: "set_value_equals",
                regex: /^(?:set\s+)?(\S+)=(\S+)$/i,
                extract: (match) => ({intent: "SET_VALUE", slots: {path: match[1], value: this._parseValue(match[2])}}),
                confidence: 0.95
            },
            {
                name: "set_frame",
                regex: /^(?:go\s+to\s+)?frame\s+(\d+)$/i,
                extract: (match) => ({intent: "SET_FRAME", slots: {frame: parseInt(match[1])}}),
                confidence: 0.95
            },
            {
                name: "set_datetime_iso",
                regex: /^(?:set\s+)?(?:date\s*(?:time)?|time)\s+(?:to\s+)?(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?)?)$/i,
                extract: (match) => ({intent: "SET_DATETIME", slots: {dateTime: match[1]}}),
                confidence: 0.95
            },
            {
                name: "set_value_explicit",
                regex: /^set\s+(\S+)\s+(?:to\s+)?(\S+)$/i,
                extract: (match) => ({intent: "SET_VALUE", slots: {path: match[1], value: this._parseValue(match[2])}}),
                confidence: 0.95
            },
            {
                name: "set_value_implicit",
                regex: /^(\S+)\s+(\d+(?:\.\d+)?)$/i,
                extract: (match) => ({intent: "SET_VALUE", slots: {path: match[1], value: parseFloat(match[2])}}),
                confidence: 0.9
            },
            {
                name: "zoom_in",
                regex: /^zoom\s+in(?:\s+(?:the\s+)?(\w+)(?:\s+camera)?)?$/i,
                extract: (match) => {
                    const camera = match[1] ? this._resolveCameraName(match[1]) : "lookCamera";
                    return {intent: "ZOOM_IN", slots: {camera}};
                },
                confidence: 0.9
            },
            {
                name: "zoom_out",
                regex: /^zoom\s+out(?:\s+(?:the\s+)?(\w+)(?:\s+camera)?)?$/i,
                extract: (match) => {
                    const camera = match[1] ? this._resolveCameraName(match[1]) : "lookCamera";
                    return {intent: "ZOOM_OUT", slots: {camera}};
                },
                confidence: 0.9
            },
            {
                name: "toggle_on",
                regex: /^(?:show|enable|turn\s+on)\s+(.+)$/i,
                extract: (match) => ({intent: "TOGGLE_ON", slots: {target: match[1].trim()}}),
                confidence: 0.85
            },
            {
                name: "toggle_off",
                regex: /^(?:hide|disable|turn\s+off)\s+(.+)$/i,
                extract: (match) => ({intent: "TOGGLE_OFF", slots: {target: match[1].trim()}}),
                confidence: 0.85
            },
            {
                name: "toggle_suffix_on",
                regex: /^(.+)\s+(?:on|visible|enabled)$/i,
                extract: (match) => ({intent: "TOGGLE_ON", slots: {target: match[1].trim()}}),
                confidence: 0.8
            },
            {
                name: "toggle_suffix_off",
                regex: /^(.+)\s+(?:off|hidden|disabled)$/i,
                extract: (match) => ({intent: "TOGGLE_OFF", slots: {target: match[1].trim()}}),
                confidence: 0.8
            },
            {
                name: "load_satellites",
                regex: /^(?:load|get|fetch)\s+(?:the\s+)?(?:leo\s+)?(?:satellites?|sats?)$/i,
                extract: () => ({intent: "LOAD_SATELLITES", slots: {type: "leo"}}),
                confidence: 0.95
            },
            {
                name: "load_starlink",
                regex: /^(?:load|get|fetch)\s+(?:current\s+)?starlinks?$/i,
                extract: () => ({intent: "LOAD_SATELLITES", slots: {type: "starlink"}}),
                confidence: 0.95
            },
            {
                name: "ambient_only",
                regex: /^ambient\s*(?:only)?$/i,
                extract: () => ({intent: "AMBIENT_ONLY", slots: {}}),
                confidence: 0.95
            },
            {
                name: "set_all_geometry",
                regex: /^(?:make|set|change)\s+(?:it|them|all(?:\s+objects)?)\s+(?:to\s+)?(?:a\s+)?(\w+)s?$/i,
                extract: (match) => {
                    const geoName = this._resolveGeometryName(match[1]);
                    if (geoName) {
                        return {intent: "SET_ALL_GEOMETRY", slots: {geometry: geoName}};
                    }
                    return null;
                },
                confidence: 0.85
            },
            {
                name: "set_model",
                regex: /^(?:set|use|change(?:\s+to)?|make\s+(?:it|the\s+\w+)\s+(?:a\s+)?)\s*(\w+)$/i,
                extract: (match) => {
                    const modelName = this._resolveModelName(match[1]);
                    if (modelName) {
                        return {intent: "SET_MODEL", slots: {model: modelName}};
                    }
                    return null;
                },
                confidence: 0.7
            },
            {
                name: "set_object_model",
                regex: /^(?:set|make|change)\s+(?:the\s+)?(\w+)\s+(?:object\s+)?(?:to\s+)?(?:a\s+)?(\w+)$/i,
                extract: (match) => {
                    const modelName = this._resolveModelName(match[2]);
                    if (modelName) {
                        return {intent: "SET_OBJECT_MODEL", slots: {object: match[1], model: modelName}};
                    }
                    const geoName = this._resolveGeometryName(match[2]);
                    if (geoName) {
                        return {intent: "SET_OBJECT_GEOMETRY", slots: {object: match[1], geometry: geoName}};
                    }
                    return null;
                },
                confidence: 0.8
            },
            {
                name: "math_expression",
                test: (text) => {
                    const cleaned = text.replace(/^(?:what\s+is\s+|calculate\s+|eval(?:uate)?\s+)/i, '').replace(/\?$/, '').trim();
                    if (!cleaned || /^[a-z]+$/i.test(cleaned)) return null;
                    try {
                        const result = math.evaluate(cleaned);
                        if (typeof result === 'number' && isFinite(result)) {
                            return {expression: cleaned, result};
                        }
                    } catch (e) {}
                    return null;
                },
                extract: (match, testResult) => ({
                    intent: "MATH",
                    slots: {expression: testResult.expression, result: testResult.result}
                }),
                confidence: 0.95
            },
            {
                name: "play",
                regex: /^(?:play|start|unpause|resume)$/i,
                extract: () => ({intent: "PLAY", slots: {}}),
                confidence: 0.95
            },
            {
                name: "pause",
                regex: /^(?:pause|stop)$/i,
                extract: () => ({intent: "PAUSE", slots: {}}),
                confidence: 0.95
            },
            {
                name: "set_time_simple",
                regex: /^(?:set\s+)?(?:time\s+(?:to\s+)?)?(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i,
                extract: (match) => {
                    let hours = parseInt(match[1]);
                    const minutes = match[2] ? parseInt(match[2]) : 0;
                    const seconds = match[3] ? parseInt(match[3]) : 0;
                    const ampm = match[4]?.toLowerCase();
                    if (ampm === "pm" && hours < 12) hours += 12;
                    if (ampm === "am" && hours === 12) hours = 0;
                    return {intent: "SET_TIME_RELATIVE", slots: {hours, minutes, seconds}};
                },
                confidence: 0.85
            },
            {
                name: "goto_location_simple",
                regex: /^(?:go\s+to|move\s+to|set\s+location(?:\s+to)?)\s+(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)(?:\s*[,\s]\s*(-?\d+(?:\.\d+)?))?$/i,
                extract: (match) => ({
                    intent: "GOTO_LLA",
                    slots: {
                        lat: parseFloat(match[1]),
                        lon: parseFloat(match[2]),
                        alt: match[3] ? parseFloat(match[3]) : 0
                    }
                }),
                confidence: 0.95
            },
            {
                name: "goto_location_named",
                regex: /^(?:go\s+to|move\s+to|set\s+location(?:\s+to)?)\s+(.+)$/i,
                extract: (match) => ({intent: "GOTO_NAMED_LOCATION", slots: {location: match[1].trim()}}),
                confidence: 0.6
            },
            {
                name: "point_at_object",
                regex: /^(?:point|look)\s+(?:at|towards?)\s+(?:the\s+)?(.+)$/i,
                extract: (match) => ({intent: "POINT_AT", slots: {target: match[1].trim()}}),
                confidence: 0.8
            },
        ];
    }

    _parseValue(str) {
        const num = parseFloat(str);
        if (!isNaN(num) && String(num) === str) return num;
        const lower = str.toLowerCase();
        if (BOOLEAN_TRUE.includes(lower)) return true;
        if (BOOLEAN_FALSE.includes(lower)) return false;
        if (!isNaN(num)) return num;
        return str;
    }

    _resolveCameraName(name) {
        const lower = name.toLowerCase();
        if (lower === "look" || lower === "lookview") return "lookCamera";
        if (lower === "main" || lower === "mainview") return "mainCamera";
        return lower + "Camera";
    }

    _resolveModelName(name) {
        const lower = name.toLowerCase();
        const modelKeys = Object.keys(ModelFiles);
        let modelName = modelKeys.find(m => m.toLowerCase() === lower);
        if (!modelName) {
            modelName = modelKeys.find(m => m.toLowerCase().includes(lower));
        }
        if (!modelName) {
            modelName = modelKeys.find(m => lower.includes(m.toLowerCase()));
        }
        for (const [alias, variants] of Object.entries(ALIASES)) {
            if (variants.includes(lower)) {
                const aliasModel = modelKeys.find(m => m.toLowerCase().includes(alias));
                if (aliasModel) return aliasModel;
            }
        }
        return modelName || null;
    }

    _resolveGeometryName(name) {
        const lower = name.toLowerCase();
        let geoName = GEOMETRY_TYPES.find(g => g.toLowerCase() === lower);
        if (!geoName) {
            geoName = GEOMETRY_TYPES.find(g => g.toLowerCase().includes(lower));
        }
        if (!geoName) {
            geoName = GEOMETRY_TYPES.find(g => lower.includes(g.toLowerCase()));
        }
        return geoName || null;
    }

    _resolveMenuPath(target) {
        const lower = target.toLowerCase();
        for (const [menuId, gui] of Object.entries(guiMenus)) {
            const result = this._searchControllers(gui, lower, "");
            if (result) {
                return {menu: menuId, path: result.path, controller: result.controller};
            }
        }
        return null;
    }

    _searchControllers(gui, searchTerm, prefix) {
        for (const child of gui.children) {
            if (child instanceof GUI) {
                const result = this._searchControllers(child, searchTerm, prefix + child._title + "/");
                if (result) return result;
            } else {
                const nameLower = child._name.toLowerCase();
                const propLower = child.property?.toLowerCase() || "";
                if (nameLower === searchTerm || propLower === searchTerm ||
                    nameLower.includes(searchTerm) || propLower.includes(searchTerm) ||
                    searchTerm.includes(nameLower) || searchTerm.includes(propLower)) {
                    return {path: prefix + child._name, controller: child};
                }
            }
        }
        return null;
    }

    parse(text) {
        const trimmed = text.trim();
        for (const pattern of this.patterns) {
            let match = null;
            let testResult = null;
            if (pattern.regex) {
                match = trimmed.match(pattern.regex);
            } else if (pattern.test) {
                testResult = pattern.test(trimmed);
                match = testResult ? true : null;
            }
            if (match) {
                const extracted = pattern.extract(match, testResult);
                if (extracted) {
                    return {
                        ...extracted,
                        confidence: pattern.confidence,
                        patternName: pattern.name,
                        originalText: trimmed
                    };
                }
            }
        }
        return {intent: null, slots: {}, confidence: 0, originalText: trimmed};
    }

    async execute(parseResult) {
        const {intent, slots} = parseResult;

        switch (intent) {
            case "SET_VALUE": {
                const resolved = this._resolveMenuPath(slots.path);
                if (resolved) {
                    return sitrecAPI.call("setMenuValue", {
                        menu: resolved.menu,
                        path: resolved.path,
                        value: slots.value
                    });
                }
                return {success: false, error: `Could not find control: ${slots.path}`};
            }

            case "TOGGLE_ON":
            case "TOGGLE_OFF": {
                const resolved = this._resolveMenuPath(slots.target);
                if (resolved) {
                    return sitrecAPI.call("setMenuValue", {
                        menu: resolved.menu,
                        path: resolved.path,
                        value: intent === "TOGGLE_ON"
                    });
                }
                return {success: false, error: `Could not find control: ${slots.target}`};
            }

            case "ZOOM_IN": {
                const fovPath = this._resolveMenuPath("vfov");
                if (fovPath) {
                    const current = sitrecAPI.call("getMenuValue", {menu: fovPath.menu, path: fovPath.path});
                    if (current.result?.value) {
                        const newFov = Math.max(1, current.result.value * 0.7);
                        return sitrecAPI.call("setMenuValue", {menu: fovPath.menu, path: fovPath.path, value: newFov});
                    }
                }
                return {success: false, error: "Could not find FOV control"};
            }

            case "ZOOM_OUT": {
                const fovPath = this._resolveMenuPath("vfov");
                if (fovPath) {
                    const current = sitrecAPI.call("getMenuValue", {menu: fovPath.menu, path: fovPath.path});
                    if (current.result?.value) {
                        const newFov = Math.min(120, current.result.value * 1.4);
                        return sitrecAPI.call("setMenuValue", {menu: fovPath.menu, path: fovPath.path, value: newFov});
                    }
                }
                return {success: false, error: "Could not find FOV control"};
            }

            case "LOAD_SATELLITES":
                if (slots.type === "starlink") {
                    return sitrecAPI.call("satellitesLoadCurrentStarlink", {});
                }
                return sitrecAPI.call("satellitesLoadLEO", {});

            case "AMBIENT_ONLY": {
                const resolved = this._resolveMenuPath("ambient only");
                if (resolved) {
                    return sitrecAPI.call("setMenuValue", {menu: resolved.menu, path: resolved.path, value: true});
                }
                return {success: false, error: "Could not find ambient only control"};
            }

            case "SET_MODEL":
                return sitrecAPI.call("setObjectModel", {object: "camera", model: slots.model});

            case "SET_OBJECT_MODEL":
                return sitrecAPI.call("setObjectModel", {object: slots.object, model: slots.model});

            case "SET_OBJECT_GEOMETRY":
                return sitrecAPI.call("setObjectGeometry", {object: slots.object, geometry: slots.geometry});

            case "SET_ALL_GEOMETRY":
                return sitrecAPI.call("setAllObjectsGeometry", {geometry: slots.geometry});

            case "MATH": {
                return {success: true, result: {answer: slots.result, expression: slots.expression}};
            }

            case "PLAY":
                return sitrecAPI.call("play", {});

            case "PAUSE":
                return sitrecAPI.call("pause", {});

            case "SET_FRAME":
                return sitrecAPI.call("setFrame", {frame: slots.frame});

            case "SET_TIME_RELATIVE": {
                const now = new Date();
                now.setHours(slots.hours, slots.minutes, slots.seconds, 0);
                return sitrecAPI.call("setDateTime", {dateTime: now.toISOString()});
            }

            case "SET_DATETIME":
                return sitrecAPI.call("setDateTime", {dateTime: slots.dateTime});

            case "GOTO_LLA":
                return sitrecAPI.call("gotoLLA", {lat: slots.lat, lon: slots.lon, alt: slots.alt});

            case "GOTO_NAMED_LOCATION":
                return this._geocodeAndGoto(slots.location);

            case "POINT_AT":
                return sitrecAPI.call("pointCameraAtNamedObject", {object: slots.target});

            default:
                return {success: false, error: `Unknown intent: ${intent}`};
        }
    }

    async _geocodeAndGoto(locationName) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1`,
                {headers: {"User-Agent": "Sitrec/1.0"}}
            );
            const data = await response.json();
            if (data && data.length > 0) {
                const {lat, lon} = data[0];
                return sitrecAPI.call("gotoLLA", {lat: parseFloat(lat), lon: parseFloat(lon), alt: 0});
            }
            return {success: false, error: `Location not found: ${locationName}`, needsLLM: true};
        } catch (e) {
            return {success: false, error: `Geocoding failed: ${e.message}`, needsLLM: true};
        }
    }

    generateResponse(parseResult, executeResult) {
        const {intent, slots} = parseResult;

        if (!executeResult.success) {
            return executeResult.error || "Command failed";
        }

        switch (intent) {
            case "SET_VALUE":
                return `Set ${slots.path} to ${slots.value}`;
            case "TOGGLE_ON":
                return `Enabled ${slots.target}`;
            case "TOGGLE_OFF":
                return `Disabled ${slots.target}`;
            case "ZOOM_IN":
                return "Zoomed in";
            case "ZOOM_OUT":
                return "Zoomed out";
            case "LOAD_SATELLITES":
                return slots.type === "starlink" ? "Loading Starlink satellites..." : "Loading LEO satellites...";
            case "AMBIENT_ONLY":
                return "Switched to ambient only lighting";
            case "SET_MODEL":
            case "SET_OBJECT_MODEL":
                return `Set model to ${slots.model}`;
            case "SET_OBJECT_GEOMETRY":
            case "SET_ALL_GEOMETRY":
                return `Set geometry to ${slots.geometry}`;
            case "MATH":
                return `${executeResult.result.expression} = ${executeResult.result.answer}`;
            case "PLAY":
                return "Playing";
            case "PAUSE":
                return "Paused";
            case "SET_FRAME":
                return `Jumped to frame ${slots.frame}`;
            case "SET_TIME_RELATIVE":
            case "SET_DATETIME":
                return "Time updated";
            case "GOTO_LLA":
                return `Moved to ${slots.lat}, ${slots.lon}`;
            case "GOTO_NAMED_LOCATION":
                return `Moved to ${slots.location}`;
            case "POINT_AT":
                return `Pointing at ${slots.target}`;
            default:
                return "Done";
        }
    }
}

export const clientNLU = new CClientNLU();
