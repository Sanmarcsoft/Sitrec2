import fs from "fs";
import path from "path";
import {expect, test} from "@playwright/test";

const CUSTOM_URL = "?custom=99999999/splat%20test/20260316_231613.js&ignoreunload=1&regression=1";
const OUTPUT_DIR = "/Users/mick/Dropbox/sitrec-dev/sitrec/test-results/gaussian-splat";

function ensureOutputDir() {
    fs.mkdirSync(OUTPUT_DIR, {recursive: true});
}

async function waitForGaussianSplatScene(page) {
    await page.goto(CUSTOM_URL, {
        waitUntil: "load",
        timeout: 120000,
    });

    await page.waitForFunction(() => {
        return !!window.NodeMan?.get?.("mainView");
    }, null, {timeout: 30000});

    await page.waitForFunction(() => {
        return Object.values(window.NodeMan?.list ?? {}).some((entry) => {
            let found = false;
            entry?.data?.model?.traverse?.((child) => {
                if (child?.userData?.sitrecGaussianSplat) {
                    found = true;
                }
            });
            return found;
        });
    }, null, {timeout: 30000});

    await page.evaluate(() => {
        window.setRenderOne?.(true);
    });
    await page.waitForTimeout(10000);
}

async function collectDiagnostics(page) {
    return page.evaluate(() => {
        const mainView = window.NodeMan.get("mainView");
        const camera = mainView.camera;
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix?.();

        const gaussianMeshes = [];
        for (const entry of Object.values(window.NodeMan.list ?? {})) {
            const node = entry?.data;
            node?.model?.traverse?.((child) => {
                if (!child?.userData?.sitrecGaussianSplat) {
                    return;
                }

                gaussianMeshes.push({
                    name: child.name ?? "",
                    instanceCount: child.geometry?.instanceCount ?? 0,
                    renderOrder: child.renderOrder ?? 0,
                    material: {
                        transparent: child.material?.transparent ?? null,
                        depthTest: child.material?.depthTest ?? null,
                        depthWrite: child.material?.depthWrite ?? null,
                        blending: child.material?.blending ?? null,
                        side: child.material?.side ?? null,
                    },
                    matrixWorld: child.matrixWorld.elements.slice(),
                    depthOrder: (() => {
                        const centers = child.geometry?.getAttribute?.("splatCenter")?.array;
                        if (!centers) {
                            return null;
                        }

                        const cameraInverse = camera.matrixWorldInverse.clone();
                        const modelView = cameraInverse.multiply(child.matrixWorld);
                        const e = modelView.elements;
                        const m8 = e[2], m9 = e[6], m10 = e[10], m11 = e[14];

                        let previousDepth = -Infinity;
                        let inversions = 0;
                        let maxBacktrack = 0;
                        const firstDepths = [];

                        for (let i = 0; i < centers.length; i += 3) {
                            const depth = m8 * centers[i] + m9 * centers[i + 1] + m10 * centers[i + 2] + m11;
                            if (firstDepths.length < 12) {
                                firstDepths.push(depth);
                            }
                            if (depth < previousDepth) {
                                inversions++;
                                maxBacktrack = Math.max(maxBacktrack, previousDepth - depth);
                            }
                            previousDepth = depth;
                        }

                        return {
                            inversions,
                            maxBacktrack,
                            firstDepths,
                        };
                    })(),
                    attributeStats: (() => {
                        const opacities = child.geometry?.getAttribute?.("splatOpacity")?.array;
                        const scales = child.geometry?.getAttribute?.("splatScale")?.array;
                        const rotations = child.geometry?.getAttribute?.("splatRotation")?.array;
                        const centers = child.geometry?.getAttribute?.("splatCenter")?.array;
                        if (!opacities || !scales) {
                            return null;
                        }

                        let minOpacity = Infinity;
                        let maxOpacity = -Infinity;
                        let sumOpacity = 0;
                        let lowOpacityCount = 0;
                        let veryLowOpacityCount = 0;

                        for (let i = 0; i < opacities.length; i++) {
                            const opacity = opacities[i];
                            minOpacity = Math.min(minOpacity, opacity);
                            maxOpacity = Math.max(maxOpacity, opacity);
                            sumOpacity += opacity;
                            if (opacity < 0.2) lowOpacityCount++;
                            if (opacity < 0.05) veryLowOpacityCount++;
                        }

                        let minScale = Infinity;
                        let maxScale = -Infinity;
                        let sumScale = 0;
                        for (let i = 0; i < scales.length; i++) {
                            const scale = scales[i];
                            minScale = Math.min(minScale, scale);
                            maxScale = Math.max(maxScale, scale);
                            sumScale += scale;
                        }

                        return {
                            opacity: {
                                min: minOpacity,
                                max: maxOpacity,
                                avg: sumOpacity / opacities.length,
                                lowOpacityCount,
                                veryLowOpacityCount,
                            },
                            scale: {
                                min: minScale,
                                max: maxScale,
                                avg: sumScale / scales.length,
                            },
                            projection: (() => {
                                if (!rotations || !centers) {
                                    return null;
                                }

                                const viewWidth = window.innerWidth;
                                const viewHeight = window.innerHeight;
                                const focalX = camera.projectionMatrix.elements[0] * viewWidth * 0.5;
                                const focalY = camera.projectionMatrix.elements[5] * viewHeight * 0.5;
                                const modelView = camera.matrixWorldInverse.clone().multiply(child.matrixWorld);
                                const modelViewLinear = [
                                    [modelView.elements[0], modelView.elements[4], modelView.elements[8]],
                                    [modelView.elements[1], modelView.elements[5], modelView.elements[9]],
                                    [modelView.elements[2], modelView.elements[6], modelView.elements[10]],
                                ];

                                const mulMat3 = (a, b) => {
                                    const out = Array.from({length: 3}, () => [0, 0, 0]);
                                    for (let row = 0; row < 3; row++) {
                                        for (let col = 0; col < 3; col++) {
                                            out[row][col] = a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col];
                                        }
                                    }
                                    return out;
                                };

                                const quatToMat3 = (qw, qx, qy, qz) => {
                                    const x2 = qx + qx;
                                    const y2 = qy + qy;
                                    const z2 = qz + qz;
                                    const xx = qx * x2;
                                    const xy = qx * y2;
                                    const xz = qx * z2;
                                    const yy = qy * y2;
                                    const yz = qy * z2;
                                    const zz = qz * z2;
                                    const wx = qw * x2;
                                    const wy = qw * y2;
                                    const wz = qw * z2;
                                    return [
                                        [1 - (yy + zz), xy - wz, xz + wy],
                                        [xy + wz, 1 - (xx + zz), yz - wx],
                                        [xz - wy, yz + wx, 1 - (xx + yy)],
                                    ];
                                };

                                let minRadius = Infinity;
                                let maxRadius = -Infinity;
                                let sumRadius = 0;
                                let subPixelCount = 0;
                                let smallCount = 0;

                                for (let i = 0; i < opacities.length; i++) {
                                    const i3 = i * 3;
                                    const i4 = i * 4;
                                    const x = centers[i3];
                                    const y = centers[i3 + 1];
                                    const z = centers[i3 + 2];

                                    const tx = modelView.elements[0] * x + modelView.elements[4] * y + modelView.elements[8] * z + modelView.elements[12];
                                    const ty = modelView.elements[1] * x + modelView.elements[5] * y + modelView.elements[9] * z + modelView.elements[13];
                                    const tz = modelView.elements[2] * x + modelView.elements[6] * y + modelView.elements[10] * z + modelView.elements[14];
                                    if (tz >= -1e-5) {
                                        continue;
                                    }

                                    const rotation = quatToMat3(
                                        rotations[i4],
                                        rotations[i4 + 1],
                                        rotations[i4 + 2],
                                        rotations[i4 + 3],
                                    );
                                    const scaleMatrix = [
                                        [scales[i3], 0, 0],
                                        [0, scales[i3 + 1], 0],
                                        [0, 0, scales[i3 + 2]],
                                    ];
                                    const mView = mulMat3(mulMat3(modelViewLinear, rotation), scaleMatrix);

                                    const tz2 = tz * tz;
                                    const j00 = focalX / tz;
                                    const j02 = -focalX * tx / tz2;
                                    const j11 = focalY / tz;
                                    const j12 = -focalY * ty / tz2;

                                    const t0 = [
                                        j00 * mView[0][0] + j02 * mView[2][0],
                                        j00 * mView[0][1] + j02 * mView[2][1],
                                        j00 * mView[0][2] + j02 * mView[2][2],
                                    ];
                                    const t1 = [
                                        j11 * mView[1][0] + j12 * mView[2][0],
                                        j11 * mView[1][1] + j12 * mView[2][1],
                                        j11 * mView[1][2] + j12 * mView[2][2],
                                    ];

                                    const cov00 = t0[0] * t0[0] + t0[1] * t0[1] + t0[2] * t0[2] + 0.3;
                                    const cov01 = t0[0] * t1[0] + t0[1] * t1[1] + t0[2] * t1[2];
                                    const cov11 = t1[0] * t1[0] + t1[1] * t1[1] + t1[2] * t1[2] + 0.3;

                                    const tr = cov00 + cov11;
                                    const det = cov00 * cov11 - cov01 * cov01;
                                    const disc = Math.sqrt(Math.max(0.25 * tr * tr - det, 0));
                                    const lambda1 = Math.max(0.5 * tr + disc, 0.1);
                                    const radius = 3 * Math.sqrt(lambda1);

                                    minRadius = Math.min(minRadius, radius);
                                    maxRadius = Math.max(maxRadius, radius);
                                    sumRadius += radius;
                                    if (radius < 1) subPixelCount++;
                                    if (radius < 2) smallCount++;
                                }

                                return {
                                    minRadius,
                                    maxRadius,
                                    avgRadius: sumRadius / opacities.length,
                                    subPixelCount,
                                    smallCount,
                                };
                            })(),
                        };
                    })(),
                });
            });
        }

        return {
            camera: {
                position: camera.position.toArray(),
                quaternion: camera.quaternion.toArray(),
            },
            gaussianMeshes,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
            },
        };
    });
}

test("captures gaussian splat aircraft regression scene", async ({page}) => {
    ensureOutputDir();

    await waitForGaussianSplatScene(page);

    const diagnostics = await collectDiagnostics(page);
    expect(diagnostics.gaussianMeshes.length).toBeGreaterThan(0);

    fs.writeFileSync(
        path.join(OUTPUT_DIR, "diagnostics.json"),
        `${JSON.stringify(diagnostics, null, 2)}\n`,
        "utf8",
    );

    await page.screenshot({
        path: path.join(OUTPUT_DIR, "gaussian-splat-scene.png"),
        fullPage: true,
    });
});
