import {BufferAttribute, BufferGeometry, Color, Points, Raycaster, ShaderMaterial, TextureLoader} from "three";
import {intersectSphere2, V3} from "../threeUtils";
import {LLAToEUSRadians} from "../LLA-ECEF-ENU";
import {SITREC_APP, SITREC_SERVER} from "../configUtils";
import {sharedUniforms} from "../js/map33/material/SharedUniforms";
import {FileManager, GlobalDateTimeNode, guiMenus, setRenderOne} from "../Globals";
import {EventManager} from "../CEventManager";
import * as satellite from 'satellite.js';
import {bestSat, CTLEData} from "../TLEUtils";
import {degrees} from "../utils";
import {DebugArrow, DebugArrowAB, getPointBelow, removeDebugArrow} from "../threeExt";
import * as LAYER from "../LayerMasks";
import {assert} from "../assert";
import {saveAs} from "../js/FileSaver";

/**
 * CSatellite handles all satellite-related functionality
 * including TLE data loading, positioning calculations, rendering, and flare detection
 */
export class CSatellite {
    constructor(options = {}) {
        // Visibility flags
        this.showSatellites = true;
        this.showStarlink = true;
        this.showISS = true;
        this.showBrightest = true;
        this.showOtherSatellites = false;
        this.showSatelliteTracks = options.showSatelliteTracks ?? false;
        this.showFlareTracks = options.showFlareTracks ?? false;
        this.showSatelliteGround = options.showSatelliteGround ?? false;
        this.showSatelliteNames = false;
        this.showSatelliteNamesMain = false;
        this.labelFlares = false;
        this.showSatelliteList = "";

        // TLE Data
        this.TLEData = undefined;

        // Rendering properties
        this.satelliteGeometry = null;
        this.satelliteMaterial = null;
        this.satellites = null; // Points object

        // Flare and sun-related
        this.flareAngle = options.flareAngle ?? 5;
        this.penumbraDepth = options.penumbraDepth ?? 5000;
        this.toSun = V3(0, 0, 1);
        this.fromSun = V3(0, 0, -1);

        // Arrow display range in km
        this.arrowRange = 4000;

        // Internal timing for position calculations
        this.timeStep = 2000;
        this.setupBrightestArray();

    }

    setupBrightestArray() {
        // Brightest satellites list from Celestrack
        this.brightest = [
            [
                "00694",
                "ATLAS CENTAUR 2"
            ],
            [
                "00733",
                "THOR AGENA D R/B"
            ],
            [
                "00877",
                "SL-3 R/B"
            ],
            [
                "02802",
                "SL-8 R/B"
            ],
            [
                "03230",
                "SL-8 R/B"
            ],
            [
                "03597",
                "OAO 2"
            ],
            [
                "03669",
                "ISIS 1"
            ],
            [
                "04327",
                "SERT 2"
            ],
            [
                "05118",
                "SL-3 R/B"
            ],
            [
                "05560",
                "ASTEX 1"
            ],
            [
                "05730",
                "SL-8 R/B"
            ],
            [
                "06073",
                "COSMOS 482 DESCENT CRAFT"
            ],
            [
                "06153",
                "OAO 3 (COPERNICUS)"
            ],
            [
                "06155",
                "ATLAS CENTAUR R/B"
            ],
            [
                "08459",
                "SL-8 R/B"
            ],
            [
                "10114",
                "SL-3 R/B"
            ],
            [
                "10967",
                "SEASAT 1"
            ],
            [
                "11267",
                "SL-14 R/B"
            ],
            [
                "11574",
                "SL-8 R/B"
            ],
            [
                "11672",
                "SL-14 R/B"
            ],
            [
                "12139",
                "SL-8 R/B"
            ],
            [
                "12465",
                "SL-3 R/B"
            ],
            [
                "12585",
                "METEOR PRIRODA"
            ],
            [
                "12904",
                "SL-3 R/B"
            ],
            [
                "13068",
                "SL-3 R/B"
            ],
            [
                "13154",
                "SL-3 R/B"
            ],
            [
                "13403",
                "SL-3 R/B"
            ],
            [
                "13553",
                "SL-14 R/B"
            ],
            [
                "13819",
                "SL-3 R/B"
            ],
            [
                "14032",
                "COSMOS 1455"
            ],
            [
                "14208",
                "SL-3 R/B"
            ],
            [
                "14372",
                "COSMOS 1500"
            ],
            [
                "14699",
                "COSMOS 1536"
            ],
            [
                "14820",
                "SL-14 R/B"
            ],
            [
                "15483",
                "SL-8 R/B"
            ],
            [
                "15772",
                "SL-12 R/B(2)"
            ],
            [
                "15945",
                "SL-14 R/B"
            ],
            [
                "16182",
                "SL-16 R/B"
            ],
            [
                "16496",
                "SL-14 R/B"
            ],
            [
                "16719",
                "COSMOS 1743"
            ],
            [
                "16792",
                "SL-14 R/B"
            ],
            [
                "16882",
                "SL-14 R/B"
            ],
            [
                "16908",
                "AJISAI (EGS)"
            ],
            [
                "17295",
                "COSMOS 1812"
            ],
            [
                "17567",
                "SL-14 R/B"
            ],
            [
                "17589",
                "COSMOS 1833"
            ],
            [
                "17590",
                "SL-16 R/B"
            ],
            [
                "17912",
                "SL-14 R/B"
            ],
            [
                "17973",
                "COSMOS 1844"
            ],
            [
                "18153",
                "SL-14 R/B"
            ],
            [
                "18187",
                "COSMOS 1867"
            ],
            [
                "18421",
                "COSMOS 1892"
            ],
            [
                "18749",
                "SL-14 R/B"
            ],
            [
                "18958",
                "COSMOS 1933"
            ],
            [
                "19046",
                "SL-3 R/B"
            ],
            [
                "19120",
                "SL-16 R/B"
            ],
            [
                "19210",
                "COSMOS 1953"
            ],
            [
                "19257",
                "SL-8 R/B"
            ],
            [
                "19573",
                "COSMOS 1975"
            ],
            [
                "19574",
                "SL-14 R/B"
            ],
            [
                "19650",
                "SL-16 R/B"
            ],
            [
                "20261",
                "INTERCOSMOS 24"
            ],
            [
                "20262",
                "SL-14 R/B"
            ],
            [
                "20323",
                "DELTA 1 R/B"
            ],
            [
                "20443",
                "ARIANE 40 R/B"
            ],
            [
                "20453",
                "DELTA 2 R/B(1)"
            ],
            [
                "20465",
                "COSMOS 2058"
            ],
            [
                "20466",
                "SL-14 R/B"
            ],
            [
                "20511",
                "SL-14 R/B"
            ],
            [
                "20580",
                "HST"
            ],
            [
                "20625",
                "SL-16 R/B"
            ],
            [
                "20663",
                "COSMOS 2084"
            ],
            [
                "20666",
                "SL-6 R/B(2)"
            ],
            [
                "20775",
                "SL-8 R/B"
            ],
            [
                "21088",
                "SL-8 R/B"
            ],
            [
                "21397",
                "OKEAN-3"
            ],
            [
                "21422",
                "COSMOS 2151"
            ],
            [
                "21423",
                "SL-14 R/B"
            ],
            [
                "21574",
                "ERS-1"
            ],
            [
                "21610",
                "ARIANE 40 R/B"
            ],
            [
                "21819",
                "INTERCOSMOS 25"
            ],
            [
                "21876",
                "SL-8 R/B"
            ],
            [
                "21938",
                "SL-8 R/B"
            ],
            [
                "21949",
                "USA 81"
            ],
            [
                "22219",
                "COSMOS 2219"
            ],
            [
                "22220",
                "SL-16 R/B"
            ],
            [
                "22236",
                "COSMOS 2221"
            ],
            [
                "22285",
                "SL-16 R/B"
            ],
            [
                "22286",
                "COSMOS 2228"
            ],
            [
                "22566",
                "SL-16 R/B"
            ],
            [
                "22626",
                "COSMOS 2242"
            ],
            [
                "22803",
                "SL-16 R/B"
            ],
            [
                "22830",
                "ARIANE 40 R/B"
            ],
            [
                "23087",
                "COSMOS 2278"
            ],
            [
                "23088",
                "SL-16 R/B"
            ],
            [
                "23343",
                "SL-16 R/B"
            ],
            [
                "23405",
                "SL-16 R/B"
            ],
            [
                "23561",
                "ARIANE 40+ R/B"
            ],
            [
                "23705",
                "SL-16 R/B"
            ],
            [
                "24298",
                "SL-16 R/B"
            ],
            [
                "24883",
                "ORBVIEW 2 (SEASTAR)"
            ],
            [
                "25400",
                "SL-16 R/B"
            ],
            [
                "25407",
                "SL-16 R/B"
            ],
            [
                "25544",
                "ISS (ZARYA)"
            ],
            [
                "25732",
                "CZ-4B R/B"
            ],
            [
                "25860",
                "OKEAN-O"
            ],
            [
                "25861",
                "SL-16 R/B"
            ],
            [
                "25876",
                "DELTA 2 R/B"
            ],
            [
                "25977",
                "HELIOS 1B"
            ],
            [
                "25994",
                "TERRA"
            ],
            [
                "26070",
                "SL-16 R/B"
            ],
            [
                "26474",
                "TITAN 4B R/B"
            ],
            [
                "27386",
                "ENVISAT"
            ],
            [
                "27422",
                "IDEFIX & ARIANE 42P R/B"
            ],
            [
                "27424",
                "AQUA"
            ],
            [
                "27432",
                "CZ-4B R/B"
            ],
            [
                "27597",
                "MIDORI II (ADEOS-II)"
            ],
            [
                "27601",
                "H-2A R/B"
            ],
            [
                "28059",
                "CZ-4B R/B"
            ],
            [
                "28222",
                "CZ-2C R/B"
            ],
            [
                "28353",
                "SL-16 R/B"
            ],
            [
                "28415",
                "CZ-4B R/B"
            ],
            [
                "28480",
                "CZ-2C R/B"
            ],
            [
                "28499",
                "ARIANE 5 R/B"
            ],
            [
                "28738",
                "CZ-2D R/B"
            ],
            [
                "28931",
                "ALOS (DAICHI)"
            ],
            [
                "28932",
                "H-2A R/B"
            ],
            [
                "29228",
                "RESURS-DK 1"
            ],
            [
                "29252",
                "GENESIS 1"
            ],
            [
                "29507",
                "CZ-4B R/B"
            ],
            [
                "31114",
                "CZ-2C R/B"
            ],
            [
                "31598",
                "COSMO-SKYMED 1"
            ],
            [
                "31789",
                "GENESIS 2"
            ],
            [
                "31792",
                "COSMOS 2428"
            ],
            [
                "31793",
                "SL-16 R/B"
            ],
            [
                "33504",
                "KORONAS-FOTON"
            ],
            [
                "37731",
                "CZ-2C R/B"
            ],
            [
                "38341",
                "H-2A R/B"
            ],
            [
                "39358",
                "SHIJIAN-16 (SJ-16)"
            ],
            [
                "39679",
                "SL-4 R/B"
            ],
            [
                "39766",
                "ALOS-2"
            ],
            [
                "41038",
                "YAOGAN-29"
            ],
            [
                "41337",
                "ASTRO-H (HITOMI)"
            ],
            [
                "42758",
                "HXMT (HUIYAN)"
            ],
            [
                "43521",
                "CZ-2C R/B"
            ],
            [
                "43641",
                "SAOCOM 1A"
            ],
            [
                "43682",
                "H-2A R/B"
            ],
            [
                "46265",
                "SAOCOM 1B"
            ],
            [
                "48274",
                "CSS (TIANHE)"
            ],
            [
                "48865",
                "COSMOS 2550"
            ],
            [
                "52794",
                "CZ-2C R/B"
            ],
            [
                "54149",
                "GSLV R/B"
            ],
            [
                "57800",
                "XRISM"
            ],
            [
                "59588",
                "ACS3"
            ]
        ];
    }

    /**
     * Replace/load TLE data
     */
    replaceTLE(tle) {
        this.removeSatellites();
        this.TLEData = new CTLEData(tle);
        this.TLEData.satData.forEach(sat => {
            sat.eus = V3();
        });
        EventManager.dispatchEvent("tleLoaded", {});
        setRenderOne(2); // force a render update after loading the TLE data


        // if there's no export button, add one
        if (!this.exportTLEButton) {
            const obj = {
                exportTLE: () => {
                    const tleText = tle;
                    saveAs(new Blob([tleText]), "satellites.tle");
                }
            };
            this.exportTLEButton = guiMenus.file.add(obj, 'exportTLE').name('Export TLE');
        }

    }

    /**
     * Remove all satellites from scene
     */
    removeSatellites() {
        if (this.TLEData !== undefined) {

            if (this.satelliteGeometry) {
                this.satelliteGeometry.dispose();
                this.satelliteGeometry = null;
            }
            if (this.satelliteMaterial) {
                if (this.satelliteMaterial.uniforms.starTexture.value) {
                    this.satelliteMaterial.uniforms.starTexture.value.dispose();
                }
                this.satelliteMaterial.dispose();
                this.satelliteMaterial = null;
            }

            if (this.satellites) {
                if (this.satellites.parent) {
                    this.satellites.parent.remove(this.satellites);
                }
                this.satellites = null;
            }

            for (const [index, satData] of Object.entries(this.TLEData.satData)) {
                if (satData.spriteText) {
                    if (satData.spriteText.parent) {
                        satData.spriteText.parent.remove(satData.spriteText);
                        satData.spriteText.parent = null;
                    }
                    satData.spriteText.dispose();
                    satData.spriteText = null;
                }

                this.removeSatSunArrows(satData);
                this.removeSatelliteArrows(satData);
            }
            this.satData = undefined;
        }
    }

    /**
     * Add satellites to scene - must be called after replaceTLE
     */
    addSatellites(scene, textGroup, globeRadius = 1) {
        assert(this.TLEData !== undefined, "addSatellites needs TLEData to be set");

        // Define geometry for satellites
        this.satelliteGeometry = new BufferGeometry();

        const len = this.TLEData.satData.length;

        // Allocate arrays for positions and colors
        let positions = new Float32Array(len * 3); // x, y, z for each satellite
        let colors = new Float32Array(len * 3); // r, g, b for each satellite
        let magnitudes = new Float32Array(len); // magnitude for each satellite

        // Custom shaders
        const customVertexShader = `
    varying vec3 vColor;
    uniform float minSize;
    uniform float maxSize;
    uniform float cameraFOV;
    uniform float satScale;
    attribute float magnitude;
    attribute vec3 color;
    varying float vDepth;

    void main() {
        vColor = color;
        
        // if magnitude is 0 then do not draw it
        if (magnitude == 0.0) {
            gl_Position = vec4(0,0,0,0);
            gl_PointSize = 0.0;
            return;
        }

        float size = mix(minSize, maxSize, magnitude);
        size *= satScale;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size;
        vDepth = gl_Position.w;
    }`;

        const customFragmentShader = `
    varying vec3 vColor;
    uniform float nearPlane;
    uniform float farPlane;
    varying float vDepth;
    uniform sampler2D starTexture;

    void main() {
        vec2 uv = gl_PointCoord.xy * 2.0 - 1.0;
        float alpha = 1.0 - dot(uv, uv);
        if (alpha < 0.0) discard;

        vec4 textureColor = texture2D(starTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, 1.0) * textureColor * alpha;

        float z = (log2(max(nearPlane, 1.0 + vDepth)) / log2(1.0 + farPlane)) * 2.0 - 1.0;
        gl_FragDepthEXT = z * 0.5 + 0.5;
    }`;

        // Custom material for satellites
        this.satelliteMaterial = new ShaderMaterial({
            vertexShader: customVertexShader,
            fragmentShader: customFragmentShader,
            uniforms: {
                minSize: { value: 0.0 },
                maxSize: { value: 20.0 },
                starTexture: { value: new TextureLoader().load(SITREC_APP + 'data/images/nightsky/MickStar.png') },
                cameraFOV: { value: 30 },
                satScale: { value: 1.0 },
                ...sharedUniforms,
            },
            transparent: true,
            depthTest: true,
        });

        // update colors and add the satellite text sprites
        for (let i = 0; i < this.TLEData.satData.length; i++) {
            const sat = this.TLEData.satData[i];

            // Calculate satellite position
            const position = V3();

            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

            magnitudes[i] = 0.1;

            sat.eus = V3();

            // color of the sprite is based on the name length
            var name = sat.name.replace("0 STARLINK", "SL").replace("STARLINK", "SL");
            name = name.replace(/\s+$/, '');

            let color = new Color(0xF0F0FF); // default blueish white
            let length = name.length;
            if (sat.name.includes("STARLINK")) {
                color = new Color(0xFFFFC0);
                if (length > 7) {
                    color = new Color(0xFFA080);
                }
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        // Attach data to geometry
        this.satelliteGeometry.setAttribute('position', new BufferAttribute(positions, 3));
        this.satelliteGeometry.setAttribute('color', new BufferAttribute(colors, 3));
        this.satelliteGeometry.setAttribute('magnitude', new BufferAttribute(magnitudes, 1));

        // Create point cloud for satellites
        this.satellites = new Points(this.satelliteGeometry, this.satelliteMaterial);

        // Disable frustum culling for satellites
        this.satellites.frustumCulled = false;

        // Add to scene
        scene.add(this.satellites);
    }

    /**
     * Filter which satellites are visible based on user settings
     */
    filterSatellites() {
        if (this.TLEData === undefined) return;

        // first get the satellite list into an array of NORAD numbers
        const satList = this.showSatelliteList.split(",").map(x => x.trim());
        const list = [];
        // this can be names or numbers, convert to numbers
        for (let i = 0; i < satList.length; i++) {
            const num = parseInt(satList[i]);
            if (isNaN(num)) {
                const matching = this.TLEData.getMatchingRecords(satList[i]);
                // add the "matching" array to the list
                if (matching.length > 0) {
                    for (const number of matching) {
                        // if the number is not already in the list, add it
                        if (!list.includes(number)) {
                            list.push(number);
                        }
                    }
                }
            } else {
                list.push(num);
            }
        }

        // iterate over the satellites and flag visibility
        // based on the name and the GUI flags
        for (const satData of this.TLEData.satData) {

            // this is just a clean time to remove the debug arrows
            // they will get recreated for all visible satellites
            this.removeSatelliteArrows(satData);

            satData.visible = false;
            satData.userFiltered = false;
            let filterHit = false;

            if (!this.showSatellites)
                continue;

            if (satData.name.startsWith("STARLINK")) {
                filterHit = true;
                if (this.showStarlink) {
                    satData.visible = true;
                    continue;
                }
            }

            if (satData.name.startsWith("ISS (ZARYA)")) {
                filterHit = true;
                if (this.showISS) {
                    satData.visible = true;
                    satData.userFiltered = true;
                    continue;
                }
            }

            // check the number against the brightest list
            if (this.showBrightest) {
                for (const [num, name] of this.brightest) {
                    if (satData.number === parseInt(num)) {
                        filterHit = true;
                        satData.visible = true;
                        satData.userFiltered = true;
                        continue;
                    }
                }
            }

            // check the number against the user supplied list
            // comma separated list of names or NORAD numbers
            if (this.showSatelliteList) {
                for (const number of list) {
                    if (satData.number === parseInt(number)) {
                        filterHit = true;
                        satData.visible = true;
                        satData.userFiltered = true;
                        continue;
                    }
                }
            }

            if (!filterHit && this.showOtherSatellites) {
                satData.visible = true;
                continue;
            }
        }
    }

    /**
     * Calculate satellite EUS position for a given date
     */
    calcSatEUS(sat, date) {
        const positionAndVelocity = satellite.propagate(sat, date);
        if (positionAndVelocity && positionAndVelocity.position) {
            const gmst = satellite.gstime(date);
            // get geodetic (LLA) coordinates directly from satellite.js
            const GD = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
            const altitude = GD.height * 1000; // convert from km to meters

            // if the altitude is less than 100km, then it's in the atmosphere so we don't show it
            if (altitude < 100000) {
                return null;
            }

            // if it's significantly (10%) greater than geostationary orbit (35,786 km), then it's probably an error
            // so we don't show it
            if (altitude > 40000000) {
                return null;
            }

            const EUS = LLAToEUSRadians(GD.latitude, GD.longitude, altitude);
            return EUS;
        } else {
            return null;
        }
    }

    /**
     * Update all satellite positions for a given date
     */
    updateAllSatellites(date, options = {}) {
        if (!this.TLEData || !this.satelliteGeometry) {
            return;
        }

        const timeMS = date.getTime();
        const numSats = this.TLEData.satData.length;

        // if there's only a few satellites, use a smaller time step
        if (numSats < 100) {
            this.timeStep = 100;
        } else {
            this.timeStep = numSats; // scale it by the number of satellites
        }

        // Get the position attribute from the geometry
        const positions = this.satelliteGeometry.attributes.position.array;
        const magnitudes = this.satelliteGeometry.attributes.magnitude.array;

        const lookPos = options.lookCameraPos || V3(0, 0, 0);

        let validCount = 0;
        let visibleCount = 0;
        for (let i = 0; i < numSats; i++) {
            const satData = this.TLEData.satData[i];
            const satrec = bestSat(satData.satrecs, date);

            // Satellites move in nearly straight lines
            // so interpolate every few seconds
            if (satData.timeA === undefined || timeMS < satData.timeA || timeMS > satData.timeB) {

                satData.timeA = timeMS;
                if (satData.timeB === undefined) {
                    // for the first one we spread it out
                    // so we end up updating about the same number of satellites per frame
                    satData.timeB = timeMS + Math.floor(1 + this.timeStep * (i / numSats));
                } else {
                    satData.timeB = timeMS + this.timeStep;
                }
                const dateB = new Date(satData.timeB);
                satData.eusA = this.calcSatEUS(satrec, date);
                satData.eusB = this.calcSatEUS(satrec, dateB);
            }

            // if the position can't be calculated then A and/or B will be null
            // so just skip over this
            if (satData.eusA !== null && satData.eusB !== null) {

                // calculate the velocity from A to B in m/s
                const velocity = satData.eusB.clone().sub(satData.eusA).multiplyScalar(1000 / (satData.timeB - satData.timeA)).length();

                // Starlink is typically 7.5 km/s, so if it's much higher than that, then it's probably an error
                // I use 11,000 as an upper limit to include highly elliptical orbits
                // Geostationary satellites are around 3 km/s, so we can use that as a lower limit
                if (velocity < 2500 || velocity > 11000) {
                    // if the velocity is too high, then we assume it's an error and skip it
                    satData.invalidPosition = true;
                } else {

                    // Otherwise, we have a valid A and B, so do a linear interpolation
                    var t = (timeMS - satData.timeA) / (satData.timeB - satData.timeA);

                    // Perform the linear interpolation (lerp)
                    satData.eus.lerpVectors(satData.eusA, satData.eusB, t);

                    // Update the position in the geometry's attribute
                    positions[i * 3] = satData.eus.x;
                    positions[i * 3 + 1] = satData.eus.y;
                    positions[i * 3 + 2] = satData.eus.z;
                    satData.invalidPosition = false;

                    satData.currentPosition = satData.eus.clone();

                    if (satData.spriteText) {
                        satData.spriteText.position.set(satData.eus.x, satData.eus.y, satData.eus.z);
                    }

                    let arrowsDrawn = false;
                    if (satData.visible && satData.eusA.distanceTo(lookPos) < this.arrowRange * 1000) {
                        // draw an arrow from the satellite in the direction of its velocity (yellow)
                        if (this.showSatelliteTracks && options.satelliteTrackGroup) {
                            let A = satData.eusA.clone();
                            let dir = satData.eusB.clone().sub(satData.eusA).normalize();
                            DebugArrow(satData.name + "_t", dir, satData.eus, 500000, "#FFFF00", true, options.satelliteTrackGroup, 20, LAYER.MASK_LOOKRENDER);
                            arrowsDrawn = true;
                            satData.hasArrowsNeedingCleanup = true;
                        }

                        // Arrow from satellite to ground (green)
                        if (this.showSatelliteGround && options.satelliteGroundGroup) {
                            let A = satData.eusA.clone();
                            let B = getPointBelow(A);
                            DebugArrowAB(satData.name + "_g", A, B, "#00FF00", true, options.satelliteGroundGroup, 20, LAYER.MASK_LOOKRENDER);
                            arrowsDrawn = true;
                            satData.hasArrowsNeedingCleanup = true;
                        }
                    }

                    if (!arrowsDrawn) {
                        this.removeSatelliteArrows(satData);
                    }
                }
            } else {
                // if the new position is invalid, then we make it invisible
                satData.invalidPosition = true;
            }

            if (satData.invalidPosition || !satData.visible) {
                this.removeSatSunArrows(satData);
                // to make it invisible, we set the magnitude to 0 and position to a million km away
                magnitudes[i] = 0;
                positions[i * 3] = 1000000000;
            } else {
                validCount++;
            }

            if (satData.visible) {
                visibleCount++;
            }
        }

        // Notify THREE.js that the positions have changed
        this.satelliteGeometry.attributes.position.needsUpdate = true;

        return { validCount, visibleCount };
    }

    /**
     * Remove satellite track arrows
     */
    removeSatelliteArrows(satData) {
        if (satData.hasArrowsNeedingCleanup) {
            removeDebugArrow(satData.name + "_t");
            removeDebugArrow(satData.name + "_g");
            satData.hasArrowsNeedingCleanup = false;
        }
    }

    /**
     * Remove satellite sun/flare arrows
     */
    removeSatSunArrows(satData) {
        if (satData.hasSunArrow) {
            removeDebugArrow(satData.name);
            removeDebugArrow(satData.name + "sun");
            removeDebugArrow(satData.name + "reflected");
            removeDebugArrow(satData.name + "flare");
            satData.hasSunArrow = false;
        }
    }


    updateCustomSats() {
        this.updateSats("CUSTOM");
    }

    /**
     * Update Starlink constellation (current, not historical)
     */
    updateStarlink() {
        const url = SITREC_SERVER + "proxy.php?request=CURRENT_STARLINK";
        console.log("Getting starlink from " + url);
        const id = "starLink_current.tle";
        this.loadSatellites(url, id);
    }

    updateActive() {
        const url = SITREC_SERVER + "proxy.php?request=CURRENT_ACTIVE";
        console.log("Getting active from " + url);
        const id = "active_current.tle";
        this.loadSatellites(url, id);
    }



    /**
     * Update LEO satellites for the current simulation date
     */
    updateLEOSats() {
        this.updateSats("LEO");
    }

    /**
     * Update SLOW satellites (experimental)
     */
    updateSLOWSats() {
        this.updateSats("SLOW");
    }

    /**
     * Update ALL satellites (experimental)
     */
    updateALLSats() {
        this.updateSats("ALL");
    }

    /**
     * Internal method to update satellites of a specific type
     */
    updateSats(satType) {
        // get a copy of the the start time object
        // (as we need to change it, but don't want to change the global one)
        let startTime = new Date(GlobalDateTimeNode.dateStart);

        // if the startTime is greater than 48 hours ago, set it to that
        const now = new Date();
        const someTimeAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
        if (startTime > someTimeAgo) {
            startTime = someTimeAgo;
        }


        // go back one day so the TLE's are all before the current time
        // server will add one day to the date to cover things.
        // Say this is day D, we request D-1
        // the server will ask for that +2, so we get
        // D-1 to D+1
        // but this essentiall gives us D-1 to all of D, which is what we want
        // this still gives us some times in D that are in the future,
        // but those are handled by the bestSat function
        startTime.setDate(startTime.getDate() - 1);

        // convert to YYYY-MM-DD
        const dateStr = startTime.toISOString().split('T')[0];
        // get the file from the proxyStarlink URL
        // note this is NOT a dynamic file
        // it fixed based on the date
        // so we don't need to rehost it
        const url = SITREC_SERVER + "proxyStarlink.php?request=" + dateStr + "&type=" + satType;

        // TODO: (check if needed) remove the old starlink from the file manager.


        console.log("Getting satellites from " + url);
        const id = "starLink_" + dateStr + ".tle";
        this.loadSatellites(url, id);
    }

    /**
     * Load satellites from a URL
     */
    loadSatellites(url, id) {
        FileManager.loadAsset(url, id).then((data) => {
            const fileInfo = FileManager.list[id];

            // give it a proper filename so when it's re-loaded
            // it can be parsed correctly
            fileInfo.filename = id;

            // kill the static URL to force a rehost with this name
            fileInfo.staticURL = null;

            fileInfo.dynamicLink = true;

            FileManager.handleParsedFile(id, fileInfo.data);
        });
    }

    /**
     * Perform flare detection and return flare info for a satellite
     * Called from CNodeDisplayNightSky for rendering
     */
    detectFlare(satData, camera, globe, toSun, showFlareTracks, satelliteFlareTracksGroup, sunArrowGroup) {
        if (!satData.visible || !satData.currentPosition) {
            return null;
        }

        const satPosition = satData.currentPosition;
        const camToSat = satPosition.clone().sub(camera.position);

        // check if it's visible
        const raycaster = new Raycaster(camera.position, camToSat);
        const hitPoint = V3();
        const hitPoint2 = V3();
        var belowHorizon = intersectSphere2(raycaster.ray, globe, hitPoint, hitPoint2);
        
        if (!belowHorizon) {
            const globeToSat = satPosition.clone().sub(globe.center).normalize();
            const reflected = camToSat.clone().reflect(globeToSat).normalize();
            const dot = reflected.dot(toSun);
            const glintAngle = Math.abs(degrees(Math.acos(Math.max(-1, Math.min(1, dot)))));

            const spread = this.flareAngle;
            const ramp = spread * 0.25;
            const middle = spread - ramp;

            if (glintAngle < spread) {
                let glintScale;
                let d = Math.abs(glintAngle);
                if (d < middle) {
                    glintScale = 1.0; // maximum
                } else {
                    d = d - middle;
                    glintScale = (ramp - d) * (ramp - d) / (ramp * ramp);
                }

                return {
                    angle: glintAngle,
                    scale: glintScale,
                    belowHorizon: belowHorizon,
                    satPosition: satPosition,
                    camToSat: camToSat,
                    reflected: reflected
                };
            }
        }

        return null;
    }
}