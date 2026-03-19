// SitPhenomApp — Standalone sitch for viewing Phenom App events and drops.
// Designed to run inside the NEST iframe (embed=nest) but also works standalone.
// NEST sends markers via postMessage; each marker's sensorsData provides
// magnetometer + accelerometer readings used to compute camera heading and tilt,
// recreating the phone's viewpoint at capture time.

sitch = {
    name: "phenomapp",
    menuName: "Phenom App",
    isCustom: true,
    canMod: false,
    isRoot: false,
    tooltip: "Phenom App events and drops — camera positions reconstructed from device sensors.",

    useEllipsoid: true,
    centerOnLoadedTracks: false,

    // Scene defaults
    ambientLight: 0.0,
    noCityLights: true,
    useGlobe: true,
    useDayNightGlobe: true,
    globeScale: 1.0,
    dragDropHandler: true,

    // Video (receives blobs from NEST via postMessage)
    framesFromVideo: true,
    frames: 900,
    bFrame: 899,
    fps: 30,

    // Default camera — continental US overview; overridden when markers arrive
    lat: 37.0, lon: -98.0,
    mainCamera: {
        fov: 30, near: 1, far: 6000000000,
        startCameraPositionLLA: [37.0, -98.0, 5000000],
        startCameraTargetLLA:   [37.0, -98.0, 0],
    },
    lookCamera: {fov: 5, near: 1, far: 800000000},

    // Terrain — dynamic, loads tiles around the current view
    TerrainModel: {kind: "Terrain", lat: 37, lon: -98, zoom: 5, nTiles: 3, fullUI: true, dynamic: true},

    // Views
    videoView: {left: 0.5, top: 0, width: -1.7927, height: 0.5, autoClear: false, visible: false},
    mainView:  {left: 0.0, top: 0, width: 0.5, height: 1, background: '#132040'},
    lookView:  {
        left: 0.5, top: 0, width: 0.5, height: 1,
        draggable: true, resizable: true, freeAspect: true,
        canvasWidth: "canvasResolution", canvasHeight: "canvasHeight",
        syncPixelZoomWithVideo: true,
    },

    canvasResolution: {kind: "GUIValue", value: 1600, start: 10, end: 2000, step: 1, desc: "Resolution", gui: "effects"},
    canvasHeight: {kind: "Scale", in: "canvasResolution", scale: 0.57813},

    nightSky: {
        showEquatorialGrid: false,
        showConstellations: false,
        useDayNight: true,
    },

    // Fixed camera position (movable with C key)
    fixedCameraPosition: {
        kind: "PositionLLA",
        LLA: [37.0, -98.0, 10000],
        desc: "Cam",
        gui: "camera",
        tipName: "Camera",
        key: "C"
    },

    // Camera track switch — NEST markers will be added here dynamically
    cameraTrackSwitch: {kind: "Switch",
        inputs: {
            "fixedCamera": "fixedCameraPosition",
        },
        desc: "Camera Track",
        gui: "camera",
    },

    cameraTrackSwitchSmooth: {
        kind: "SmoothedPositionTrack",
        method: "savgol",
        source: "cameraTrackSwitch",
        window: {kind: "GUIValue", value: 0, start: 0, end: 1000, step: 1, desc: "Camera Smooth Window", gui: "camera"},
    },

    cameraDisplayTrack: {
        kind: "DisplayTrack",
        track: "cameraTrackSwitchSmooth",
        color: "#FFFFFF",
        width: 2,
    },

    // Fixed target position (movable with X key)
    fixedTargetPositionWind: {kind: "PositionLLA", LLA: [37.5, -98.0, 5000],
        desc: "Target", gui: "target", tipName: "Target", key: "X"},
    fixedTargetPosition: {kind: "SpecificFrame", frame: 0, node: "fixedTargetPositionWind"},

    targetTrackSwitch: {
        kind: "Switch",
        inputs: {
            "fixedTarget": "fixedTargetPosition",
        },
        desc: "Target Track",
        gui: "target",
    },

    targetTrackSwitchSmooth: {
        kind: "SmoothedPositionTrack",
        method: "moving",
        source: "targetTrackSwitch",
        window: {kind: "GUIValue", value: 0, start: 0, end: 1000, step: 1, desc: "Target Smooth Window", gui: "traverse"},
    },

    // Camera controllers
    trackPositionController: {kind: "TrackPosition", sourceTrack: "cameraTrackSwitchSmooth"},
    CameraPositionController: {
        kind: "Switch",
        inputs: {"Follow Track": "trackPositionController"},
        desc: "Camera Position",
        gui: "camera"
    },

    orientCameraController: {kind: "ObjectTilt", track: "cameraTrackSwitchSmooth", gui: "camera"},

    ptzAngles: {kind: "PTZUI", az: 0, el: 0, roll: 0, fov: 30, showGUI: true, gui: "camera"},

    trackToTrackController: {
        kind: "TrackToTrack",
        sourceTrack: "cameraTrackSwitchSmooth",
        targetTrack: "targetTrackSwitchSmooth",
        roll: "ptzAngles",
    },

    fovUI: {kind: "GUIValue", value: 30, start: 0, end: 180, step: 0.001, desc: "vFOV", gui: "camera", hidden: true},
    fovSwitch: {
        kind: "Switch",
        inputs: {"userFOV": "fovUI"},
        desc: "Camera FOV",
        gui: "camera",
    },
    fovController: {kind: "fovController", object: "lookCamera", source: "fovSwitch"},

    CameraLOSController: {kind: "Switch",
        inputs: {
            "To Target": "trackToTrackController",
            "Use Angles": "ptzAngles",
        },
        default: "Use Angles",
        desc: "Camera Heading",
        gui: "camera"
    },

    JetLOSCameraCenter: {kind: "LOSFromCamera", cameraNode: "lookCamera", useRecorded: false, exportable: true, force: true},

    // Frustum and measurements
    DisplayCameraFrustum: {radius: 500000, lineWeight: 1.0, color: "#00FFFF"},
    altitudeLabel: {kind: "MeasureAltitude", position: "lookCamera"},

    // Mirror video overlay
    mirrorVideo: {transparency: 0.0, autoClear: false},

    include_Compasses: true,
    labelView: {dateTimeY: 93},

    // Drop targets for NEST-driven file injection
    dropTargets: {
        "track": ["cameraTrackSwitch-1", "targetTrackSwitch-2"],
        "fov": ["fovSwitch"],
    },

    focusTracks: {
        "Ground (no track)": "default",
        "Sensor (camera) track": "cameraTrackSwitchSmooth",
    },
}
