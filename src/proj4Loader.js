let proj4 = null;
let loadPromise = null;

export function loadProj4() {
    if (proj4) return Promise.resolve(proj4);
    if (loadPromise) return loadPromise;

    loadPromise = import(/* webpackChunkName: "proj4" */ 'proj4-fully-loaded')
        .then(module => {
            proj4 = module.default || module;
            console.log("proj4-fully-loaded loaded successfully");
            return proj4;
        })
        .catch(err => {
            loadPromise = null;
            console.error("Failed to load proj4:", err);
            throw err;
        });

    return loadPromise;
}

export function getProj4() {
    return proj4;
}

export async function transformCoords(fromEPSG, toEPSG, coords) {
    const p4 = await loadProj4();
    const fromCode = `EPSG:${fromEPSG}`;
    const toCode = `EPSG:${toEPSG}`;
    return p4(fromCode, toCode, coords);
}

export async function projectedBoundsToWGS84(epsgCode, west, south, east, north) {
    const p4 = await loadProj4();
    const fromCode = `EPSG:${epsgCode}`;
    const toCode = "EPSG:4326";
    
    const sw = p4(fromCode, toCode, [west, south]);
    const ne = p4(fromCode, toCode, [east, north]);
    
    return {
        west: sw[0],
        south: sw[1],
        east: ne[0],
        north: ne[1]
    };
}
