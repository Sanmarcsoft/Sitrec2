import {MeshStandardMaterial, Vector3} from "three";
import {sharedUniforms} from "./SharedUniforms";
import {Globals} from "../../../Globals";

const CACHE_KEY = "DayNightStandardMaterial";

// MeshStandardMaterial subclass that uses the PBR pipeline for textures,
// vertex colors, and normal-based shading from the scene's sun directional
// light, then applies a post-lighting pass to darken fragments on the night
// side of the earth's terminator.
//
// flatShading is forced on because tile geometries (e.g. Cesium OSM Buildings)
// often lack a normal attribute. Without normals the PBR directional light
// contribution is zero (dot((0,0,0), lightDir) = 0). flatShading computes
// face normals from screen-space derivatives, which always works and is
// visually correct for architectural geometry.
export class DayNightStandardMaterial extends MeshStandardMaterial {

    constructor(parameters) {
        super(parameters);

        this.flatShading = true;

        this._dayNightUniforms = {
            sunDirection: {value: Globals.sunLight.position},
            earthCenter: {value: new Vector3(0, 0, 0)},
            useDayNight: sharedUniforms.useDayNight,
            sunAmbientIntensity: sharedUniforms.sunAmbientIntensity,
        };

        this.onBeforeCompile = this._onBeforeCompile.bind(this);
    }

    _onBeforeCompile(shader) {
        Object.assign(shader.uniforms, this._dayNightUniforms);

        // --- Vertex shader: pass world position for terminator calculation ---
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
varying vec3 vWorldPositionDN;`
        );

        const vertexInjection =
            `vWorldPositionDN = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

        if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
${vertexInjection}`
            );
        } else {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <project_vertex>',
                `#include <project_vertex>
${vertexInjection}`
            );
        }

        // --- Fragment shader: darken night side ---
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
uniform vec3 sunDirection;
uniform vec3 earthCenter;
uniform bool useDayNight;
uniform float sunAmbientIntensity;
varying vec3 vWorldPositionDN;`
        );

        // After the full PBR pipeline (including dithering), darken fragments
        // that are on the night side of the earth based on global position.
        // The PBR result already has correct local shading from scene lights;
        // we just attenuate toward ambient for the dark hemisphere.
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
if (useDayNight) {
    vec3 globalNormal = normalize(vWorldPositionDN - earthCenter);
    vec3 sunNorm = normalize(sunDirection);
    float globalIntensity = max(dot(globalNormal, sunNorm), -0.1);
    float dayFactor = smoothstep(-0.1, 0.1, globalIntensity);
    gl_FragColor.rgb = mix(gl_FragColor.rgb * sunAmbientIntensity, gl_FragColor.rgb, dayFactor);
}`
        );
    }

    copy(source) {
        super.copy(source);
        this.flatShading = true;
        this.onBeforeCompile = this._onBeforeCompile.bind(this);
        return this;
    }

    customProgramCacheKey() {
        return CACHE_KEY;
    }

    static fromMaterial(source) {
        const mat = new DayNightStandardMaterial();

        if (source.isMeshStandardMaterial) {
            mat.copy(source);
        } else {
            if (source.map) mat.map = source.map;
            if (source.color) mat.color.copy(source.color);
            if (source.transparent !== undefined) mat.transparent = source.transparent;
            if (source.opacity !== undefined) mat.opacity = source.opacity;
            if (source.side !== undefined) mat.side = source.side;
            if (source.alphaTest !== undefined) mat.alphaTest = source.alphaTest;
            if (source.vertexColors !== undefined) mat.vertexColors = source.vertexColors;
            if (source.normalMap) mat.normalMap = source.normalMap;
            if (source.normalScale) mat.normalScale.copy(source.normalScale);
            if (source.aoMap) mat.aoMap = source.aoMap;
            if (source.emissiveMap) mat.emissiveMap = source.emissiveMap;
            if (source.emissive) mat.emissive.copy(source.emissive);
        }

        mat.onBeforeCompile = mat._onBeforeCompile.bind(mat);
        mat.needsUpdate = true;
        return mat;
    }
}
