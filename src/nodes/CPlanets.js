/**
 * CPlanets - Extracted planet rendering system from CNodeDisplayNightSky
 * 
 * Handles:
 * - Planet sprite creation and management
 * - Day sky sprite rendering (Sun and Moon visible during day)
 * - Planet position calculation using Astronomy Engine
 * - Magnitude-based brightness scaling
 * - Resource cleanup and disposal
 * 
 * Dependencies:
 * - Three.js: Provides rendering primitives (Sprite, SpriteMaterial, TextureLoader, etc.)
 * - Astronomy Engine: Calculates planet positions and illumination
 * - CelestialMath.raDec2Celestial: Converts RA/DEC to 3D coordinates
 * - Sit: Global settings (planetScale)
 * - configUtils.SITREC_APP: Application root path for resources
 */

import {
    Euler,
    Matrix4,
    Mesh,
    ShaderMaterial,
    SphereGeometry,
    Sprite,
    SpriteMaterial,
    TextureLoader,
    Vector3
} from "three";
import {Sit} from "../Globals";
import {raDec2Celestial} from "../CelestialMath";
import {SITREC_APP} from "../configUtils";
import {assert} from "../assert.js";
import {radians} from "../utils";
import * as Astronomy from "astronomy-engine";

export class CPlanets {
    /**
     * Creates a new CPlanets instance
     * @param {Object} config Configuration object
     * @param {number} [config.sphereRadius=100] Radius of celestial sphere in units
     * @param {Array<string>} [config.planets] List of planet names to render
     * @param {Array<string>} [config.planetColors] Hex colors for each planet
     */
    constructor(config = {}) {
        this.sphereRadius = config.sphereRadius ?? 100;
        
        // Planet list and colors
        this.planets = config.planets ?? [
            "Sun", "Moon", "Mercury", "Venus", "Mars", 
            "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
        ];
        
        this.planetColors = config.planetColors ?? [
            "#FFFF40", "#FFFFFF", "#FFFFFF", "#80ff80", "#ff8080",
            "#FFFF80", "#FF80FF", "#FFFFFF", "#FFFFFF", "#FFFFFF"
        ];
        
        // Stores all planet sprite data
        // Structure: { planetName: { sprite, daySkySprite, ra, dec, mag, equatorial, color } }
        this.planetSprites = {};
        
        // Preloaded textures for efficiency
        this.textures = {
            star: null,
            sun: null,
            moon: null,
            moonSurface: null
        };
        
        this.moonMesh = null;
        this.moonDayMesh = null;
        this.moonMaterial = null;
        this.moonDayMaterial = null;
        
        this._loadTextures();
    }

    /**
     * Preload planet sprite textures
     * @private
     */
    _loadTextures() {
        const textureLoader = new TextureLoader();
        this.textures.star = textureLoader.load(SITREC_APP + 'data/images/nightsky/MickStar.png');
        this.textures.sun = textureLoader.load(SITREC_APP + 'data/images/nightsky/MickSun.png');
        this.textures.moon = textureLoader.load(SITREC_APP + 'data/images/nightsky/MickMoon.png');
        this.textures.moonSurface = textureLoader.load(SITREC_APP + 'data/images/nightsky/lroc_color_1k.jpg');
    }
    
    _createMoonMaterial(isDay = false) {
        return new ShaderMaterial({
            uniforms: {
                moonTexture: { value: this.textures.moonSurface },
                sunDirection: { value: new Vector3(1, 0, 0) },
                skyColor: { value: new Vector3(0, 0, 0) },
                skyBrightness: { value: 0.0 },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    vNormal = normalize(normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D moonTexture;
                uniform vec3 sunDirection;
                uniform vec3 skyColor;
                uniform float skyBrightness;
                varying vec3 vNormal;
                varying vec2 vUv;
                
                void main() {
                    vec3 sunDir = normalize(sunDirection);
                    float intensity = dot(vNormal, sunDir);
                    float blendFactor = smoothstep(-0.1, 0.1, intensity);
                    
                    vec2 uv = vUv;
                    uv.x = fract(uv.x + 0.25);
                    vec4 textureColor = texture2D(moonTexture, uv);
                    vec4 dayColor = textureColor;
                    vec4 nightColor = textureColor * 0.02;
                    
                    vec4 moonColor = mix(nightColor, dayColor, blendFactor);
                    float moonAtten = 1.0 - 0.7 * skyBrightness;
                    vec3 finalColor = moonColor.rgb * moonAtten + skyColor;
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            depthWrite: true,
            depthTest: true,
        });
    }

    /**
     * Removes all planet sprites from scenes
     * Safely disposes of materials and textures
     * 
     * @param {Scene} scene Main night sky scene
     * @param {Scene} [dayScene] Optional day sky scene for Sun/Moon rendering
     */
    removePlanets(scene, dayScene = null) {
        if (this.planetSprites) {
            for (const [planet, planetData] of Object.entries(this.planetSprites)) {
                if (planetData.sprite) {
                    if (scene) scene.remove(planetData.sprite);
                    if (planetData.sprite.material) {
                        if (planetData.sprite.material.map) {
                            planetData.sprite.material.map.dispose();
                        }
                        planetData.sprite.material.dispose();
                    }
                }
                if (planetData.daySkySprite && dayScene) {
                    dayScene.remove(planetData.daySkySprite);
                    if (planetData.daySkySprite.material) {
                        if (planetData.daySkySprite.material.map) {
                            planetData.daySkySprite.material.map.dispose();
                        }
                        planetData.daySkySprite.material.dispose();
                    }
                }
            }
        }
        
        if (this.moonMesh && scene) {
            scene.remove(this.moonMesh);
            if (this.moonMesh.geometry) this.moonMesh.geometry.dispose();
        }
        if (this.moonDayMesh && dayScene) {
            dayScene.remove(this.moonDayMesh);
            if (this.moonDayMesh.geometry) this.moonDayMesh.geometry.dispose();
        }
        if (this.moonMaterial) {
            this.moonMaterial.dispose();
            this.moonMaterial = null;
        }
        if (this.moonDayMaterial) {
            this.moonDayMaterial.dispose();
            this.moonDayMaterial = null;
        }
        this.moonMesh = null;
        this.moonDayMesh = null;
        
        this.planetSprites = {};
    }

    /**
     * Adds planet sprites to the scenes
     * Creates sprites for all planets and positions them based on observer location
     * 
     * @param {Scene} scene Main night sky scene
     * @param {Scene} [dayScene] Optional day sky scene for Sun/Moon during daylight
     * @param {Object} params Configuration object
     * @param {Date} params.date Current simulation date/time
     * @param {Vector3} params.cameraPos Camera position in ECEF coordinates
     * @param {Function} params.ecefToLla Function to convert ECEF to LLA coordinates
     */
    addPlanets(scene, dayScene = null, params = {}) {
        assert(params.date, "CPlanets.addPlanets: date required");
        assert(params.cameraPos, "CPlanets.addPlanets: cameraPos required");
        assert(params.ecefToLla, "CPlanets.addPlanets: ecefToLla function required");

        this.removePlanets(scene, dayScene);

        if (this.planetSprites && Object.keys(this.planetSprites).length > 0) {
            console.warn("CPlanets: planetSprites not empty after removePlanets, forcing cleanup");
            this.planetSprites = {};
        }

        const cameraLLA = params.ecefToLla(params.cameraPos);
        const observer = new Astronomy.Observer(cameraLLA.x, cameraLLA.y, cameraLLA.z);

        let n = 0;
        for (const planet of this.planets) {
            const color = this.planetColors[n++];
            
            if (planet === "Moon") {
                this.moonMaterial = this._createMoonMaterial();
                const moonGeometry = new SphereGeometry(1, 32, 32);
                this.moonMesh = new Mesh(moonGeometry, this.moonMaterial);
                this.moonMesh.renderOrder = 2;
                scene.add(this.moonMesh);
                
                if (dayScene) {
                    this.moonDayMaterial = this._createMoonMaterial();
                    const moonDayGeometry = new SphereGeometry(1, 32, 32);
                    this.moonDayMesh = new Mesh(moonDayGeometry, this.moonDayMaterial);
                    this.moonDayMesh.renderOrder = 2;
                    dayScene.add(this.moonDayMesh);
                }
                
                this.updateMoonMesh(params.date, observer);
                this.planetSprites[planet] = {
                    ra: 0, dec: 0, mag: 0, equatorial: new Vector3(),
                    sprite: this.moonMesh, color: color,
                    daySkySprite: this.moonDayMesh, isMesh: true
                };
            } else {
                const texture = this._getTextureForPlanet(planet);
                const spriteMaterial = new SpriteMaterial({map: texture, color: color, depthWrite: false});
                const sprite = new Sprite(spriteMaterial);

                let daySkySprite = null;
                if (planet === "Sun" && dayScene) {
                    const daySkyMaterial = new SpriteMaterial({map: texture, color: color, depthWrite: false});
                    daySkySprite = new Sprite(daySkyMaterial);
                    dayScene.add(daySkySprite);
                }

                this.updatePlanetSprite(planet, sprite, params.date, observer, daySkySprite);
                this.planetSprites[planet].color = color;
                scene.add(sprite);
            }
        }
    }

    updateMoonMesh(date, observer) {
        if (!this.moonMesh) return;
        
        const celestialInfo = Astronomy.Equator("Moon", date, observer, false, false);
        const geocentricObserver = new Astronomy.Observer(0, 0, 0);
        const geocentricInfo = Astronomy.Equator("Moon", date, geocentricObserver, false, false);
        const libration = Astronomy.Libration(date);
        const axisInfo = Astronomy.RotationAxis("Moon", date);
        
        const ra = (celestialInfo.ra) / 24 * 2 * Math.PI;
        const dec = radians(celestialInfo.dec);
        const equatorial = raDec2Celestial(ra, dec, this.sphereRadius);
        
        const moonRadius = Math.tan(radians(libration.diam_deg / 2)) * this.sphereRadius;
        
        const sunInfo = Astronomy.Equator("Sun", date, observer, false, false);
        const sunRa = (sunInfo.ra) / 24 * 2 * Math.PI;
        const sunDec = radians(sunInfo.dec);
        const sunEquatorial = raDec2Celestial(sunRa, sunDec, this.sphereRadius);
        
        const sunDir = new Vector3(sunEquatorial.x, sunEquatorial.y, sunEquatorial.z).normalize();
        
        const toMoonTopo = new Vector3(equatorial.x, equatorial.y, equatorial.z).normalize();
        const toEarth = toMoonTopo.clone().negate();
        
        const geoRa = (geocentricInfo.ra) / 24 * 2 * Math.PI;
        const geoDec = radians(geocentricInfo.dec);
        const geoEquatorial = raDec2Celestial(geoRa, geoDec, this.sphereRadius);
        const toMoonGeo = new Vector3(geoEquatorial.x, geoEquatorial.y, geoEquatorial.z).normalize();
        
        const moonNorthPole = new Vector3(axisInfo.north.x, axisInfo.north.y, axisInfo.north.z).normalize();
        const moonNorth = moonNorthPole.clone().sub(toEarth.clone().multiplyScalar(moonNorthPole.dot(toEarth))).normalize();
        const moonEast = new Vector3().crossVectors(moonNorth, toEarth).normalize();
        
        const parallax = toMoonTopo.clone().sub(toMoonGeo);
        const parallaxEast = parallax.dot(moonEast);
        const parallaxNorth = parallax.dot(moonNorth);
        
        const rotMatrix = new Matrix4();
        rotMatrix.makeBasis(moonEast, moonNorth, toEarth);
        
        const elonRad = radians(-libration.elon) + parallaxEast;
        const elatRad = radians(-libration.elat) + parallaxNorth;
        
        const librationMatrix = new Matrix4();
        librationMatrix.makeRotationFromEuler(new Euler(elatRad, elonRad, 0, 'YXZ'));
        
        const finalRotation = rotMatrix.clone().multiply(librationMatrix);
        
        this.moonMesh.position.set(equatorial.x, equatorial.y, equatorial.z);
        this.moonMesh.scale.set(moonRadius, moonRadius, moonRadius);
        this.moonMesh.setRotationFromMatrix(finalRotation);
        
        const invRotMatrix = finalRotation.clone().invert();
        const sunInMoonLocal = sunDir.clone().applyMatrix4(invRotMatrix);
        
        this.moonMaterial.uniforms.sunDirection.value.copy(sunInMoonLocal);
        
        if (this.moonDayMesh && this.moonDayMaterial) {
            this.moonDayMesh.position.copy(this.moonMesh.position);
            this.moonDayMesh.scale.copy(this.moonMesh.scale);
            this.moonDayMesh.setRotationFromMatrix(finalRotation);
            this.moonDayMaterial.uniforms.sunDirection.value.copy(sunInMoonLocal);
        }
        
        if (this.planetSprites["Moon"]) {
            this.planetSprites["Moon"].ra = ra;
            this.planetSprites["Moon"].dec = dec;
            this.planetSprites["Moon"].equatorial = equatorial;
        }
    }

    updateMoonSkyUniforms(skyColor, skyBrightness) {
        if (this.moonDayMaterial) {
            this.moonDayMaterial.uniforms.skyColor.value.set(skyColor.r, skyColor.g, skyColor.b);
            this.moonDayMaterial.uniforms.skyBrightness.value = skyBrightness;
        }
    }

    /**
     * Updates a planet sprite's position and scale for the current time
     * Calculates RA/DEC from astronomy library and converts to 3D position
     * 
     * @param {string} planet Planet name
     * @param {Sprite} sprite Three.js Sprite object
     * @param {Date} date Current simulation date/time
     * @param {Astronomy.Observer} observer Observer location
     * @param {Sprite} [daySkySprite] Optional day sky sprite to update in parallel
     */
    updatePlanetSprite(planet, sprite, date, observer, daySkySprite = undefined) {
        if (planet === "Moon") {
            this.updateMoonMesh(date, observer);
            return;
        }
        
        const celestialInfo = Astronomy.Equator(planet, date, observer, false, false);
        const illumination = Astronomy.Illumination(planet, date);
        
        const ra = (celestialInfo.ra) / 24 * 2 * Math.PI;
        const dec = radians(celestialInfo.dec);
        const mag = illumination.mag;
        const equatorial = raDec2Celestial(ra, dec, this.sphereRadius);

        let color = "#FFFFFF";
        if (this.planetSprites[planet] !== undefined) {
            color = this.planetSprites[planet].color;
        }

        sprite.position.set(equatorial.x, equatorial.y, equatorial.z);

        var scale = 10 * Math.pow(10, -0.4 * (mag - -5));
        if (scale > 1) scale = 1;
        
        if (planet === "Sun") scale = 1.9;
        
        if (planet !== "Sun") {
            scale *= Math.pow(10, 0.4 * Math.log10(Sit.planetScale));
        }

        sprite.scale.set(scale, scale, 1);

        if (planet === "Sun") {
            sprite.renderOrder = 1;
        }

        if (daySkySprite) {
            daySkySprite.position.set(equatorial.x, equatorial.y, equatorial.z);
            daySkySprite.scale.set(scale, scale, 1);
            if (planet === "Sun") {
                daySkySprite.renderOrder = 1;
            }
        }

        if (!this.planetSprites[planet]) {
            this.planetSprites[planet] = {
                ra: ra,
                dec: dec,
                mag: mag,
                equatorial: equatorial,
                sprite: sprite,
                color: color,
                daySkySprite: daySkySprite,
            };
        } else {
            this.planetSprites[planet].ra = ra;
            this.planetSprites[planet].dec = dec;
            this.planetSprites[planet].mag = mag;
            this.planetSprites[planet].equatorial = equatorial;
            this.planetSprites[planet].color = color;
            if (daySkySprite) {
                this.planetSprites[planet].daySkySprite = daySkySprite;
            }
        }
    }

    /**
     * Get appropriate texture for a planet sprite
     * @private
     * @param {string} planet Planet name
     * @returns {Texture} Three.js texture object
     */
    _getTextureForPlanet(planet) {
        if (planet === "Sun") return this.textures.sun;
        if (planet === "Moon") return this.textures.moon;
        return this.textures.star;
    }

    /**
     * Get planet data by name
     * @param {string} planet Planet name
     * @returns {Object|null} Planet sprite data or null if not found
     */
    getPlanetData(planet) {
        return this.planetSprites[planet] || null;
    }

    /**
     * Cleanup and dispose of all resources
     * Call this when the night sky is being destroyed
     */
    dispose() {
        this.removePlanets(null, null);
        
        if (this.textures.star) this.textures.star.dispose();
        if (this.textures.sun) this.textures.sun.dispose();
        if (this.textures.moon) this.textures.moon.dispose();
        if (this.textures.moonSurface) this.textures.moonSurface.dispose();
    }
}