import {NodeMan, Sit} from "./Globals";
import {ECEFToLLAVD_radii} from "./LLA-ECEF-ENU";


export function resetGlobalOrigin() {
    // Reset the Sit.lat and Sit.lon origin used for LLA-to-ECEF precomputed constants

    const lookCamera = NodeMan.get("lookCamera").camera;
    const pos = lookCamera.position;

    const LLA = ECEFToLLAVD_radii(pos);
    console.log("Resetting Origin to " + LLA.x + ", " + LLA.y + ", " + LLA.z);
    Sit.lat = LLA.x;
    Sit.lon = LLA.y;

    // Note: Origin adjustment now handled by CFileManager.resetOrigin() which performs
    // a full serialize/deserialize cycle to properly reload all nodes with new coordinates
    // This ensures all LLA to ECEF transformations are recalculated correctly

}