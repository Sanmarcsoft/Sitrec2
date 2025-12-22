// A variety of functions for converting between LLA (lat, lon, alt) and ECEF (earth centered earth fixed) and ENU (east, north, up)
// as well as some other useful related functions

import {Matrix3, Vector3} from "three";
// Removed import of cos, degrees, radians, sin - using direct Math functions instead
import {Sit} from "./Globals";
import {assert} from "./assert.js";

// Earth radius in kilometers (average)
const earthRadiusKM = 6371;

// This is the distance in KM between two lat/long locations
// assumes a sphere of average radius
export function haversineDistanceKM(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const rLat1 = lat1 * Math.PI / 180;
    const rLat2 = lat2 * Math.PI / 180;
    const sin_dLat = Math.sin(dLat / 2);
    const sin_dLon = Math.sin(dLon / 2);
    const a = sin_dLat * sin_dLat +
        sin_dLon * sin_dLon * Math.cos(rLat1) * Math.cos(rLat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKM * c;
}

export function haversineDistanceABKM(a, b) {
    return haversineDistanceKM(a.y, a.x, b.y, b.x);
}


/////////////////
// https://github.com/lakowske/ecef-projector/blob/master/index.js

// wgs84 defines the ellipse. It's the standard earth shape used by Google Earth.
// it's very similar to GRS 80
// see https://en.wikipedia.org/wiki/World_Geodetic_System
export const wgs84 = {
    RADIUS: 6378137,                            // exact, and same as in GRS 80
    FLATTENING_DENOM: 298.257223563,
    radiusMiles: 3963.190592


};           // vs 298.257222100882711 for GRS 80

wgs84.FLATTENING = 1/wgs84.FLATTENING_DENOM;
wgs84.POLAR_RADIUS = wgs84.RADIUS*(1-wgs84.FLATTENING);
wgs84.CIRC = 2*Math.PI*wgs84.RADIUS


// Other elipsoids I've seen:
//
// This is the default valued for "Other" in the NGS NCAT tool
//
// https://apa.ny.gov/gis/GisData/Wetlands/regulatorywetlands.html
// Horizontal Datum Name: North American Datum of 1983
// Ellipsoid Name: GRS 1980
// Semi-Major Axis: 6378206.40
// Denominator of Flattening Ratio: 294.98

///////////////////////////////////////////////////////////////////////////
// Source of the ECEF->LLA algorithm was given as
// * Datum Transformations of GPS Positions
// * Application Note
// NAL Research
// * 5th July 1999
//
// But it's actually B. R. Bowring, “Transformation from Spatial to Geographical Coordinates,”
//                   Survey Review, 23:181 (1976) 323-327


/*
 * Convert GPS coordinates (degrees) to Cartesian coordinates (meters)
 */
export function project(latitude, longitude, altitude) {
    return RLLAToECEF(latitude * Math.PI / 180, longitude * Math.PI / 180, altitude);
}

/*
 * Convert Cartesian coordinates (meters) to GPS coordinates (degrees)
 */
export function unproject(x, y, z) {
    const gps = ECEFToLLA(x, y, z);

    gps[0] = gps[0] * 180 / Math.PI;
    gps[1] = gps[1] * 180 / Math.PI;

    return gps;
}


export function RLLAToECEF(latitude, longitude, altitude) {


    const a    = wgs84.RADIUS;
    const f    = wgs84.FLATTENING;
    const b    = wgs84.POLAR_RADIUS;
    const asqr = a*a;
    const bsqr = b*b;
    const e = Math.sqrt((asqr-bsqr)/asqr);
    const eprime = Math.sqrt((asqr-bsqr)/bsqr);

    //Auxiliary values first
    const N = getN(latitude);
    const ratio = (bsqr / asqr);

    //Now calculate the Cartesian coordinates
    const X = (N + altitude) * Math.cos(latitude) * Math.cos(longitude);
    const Y = (N + altitude) * Math.cos(latitude) * Math.sin(longitude);

    //Sine of latitude looks right here
    const Z = (ratio * N + altitude) * Math.sin(latitude);

    return new Vector3(X, Y, Z);

}


export function LLAToECEF_Sphere(latitude, longitude, altitude) {

    const a    = wgs84.RADIUS;  // using the standard wgs84.RADIUS
    const X = (a + altitude) * Math.cos(latitude) * Math.cos(longitude);
    const Y = (a + altitude) * Math.cos(latitude) * Math.sin(longitude);
    const Z = (a + altitude) * Math.sin(latitude);

    return [X, Y, Z];
}

export function RLLAToECEFV_Sphere(latitude, longitude, altitude, radius = wgs84.RADIUS) {

    const X = (radius + altitude) * Math.cos(latitude) * Math.cos(longitude);
    const Y = (radius + altitude) * Math.cos(latitude) * Math.sin(longitude);
    const Z = (radius + altitude) * Math.sin(latitude);

    return new Vector3(X, Y, Z);
}

// Bowring method
// NOTE: this uses the WGS84 ellipse
// if using simple maps like map33 that use a sphere, then use the sphere version, next.
export function ECEFToLLA(X, Y, Z) {
    const a    = wgs84.RADIUS;
    const f    = wgs84.FLATTENING;
    const b    = wgs84.POLAR_RADIUS;
    const asqr = a*a;
    const bsqr = b*b;
    const e = Math.sqrt((asqr-bsqr)/asqr);
    const eprime = Math.sqrt((asqr-bsqr)/bsqr);

    //Auxiliary values first
    const p = Math.sqrt(X*X + Y*Y);
    const theta = Math.atan((Z*a)/(p*b));

    const sintheta = Math.sin(theta);
    const costheta = Math.cos(theta);

    const num = Z + eprime * eprime * b * sintheta * sintheta * sintheta;
    const denom = p - e * e * a * costheta * costheta * costheta;

    //Now calculate LLA
    const latitude  = Math.atan(num/denom);
    let longitude = Math.atan(Y/X);
    const N = getN(latitude);
    const altitude  = (p / Math.cos(latitude)) - N;

    if (X < 0 && Y < 0) {
        longitude = longitude - Math.PI;
    }

    if (X < 0 && Y > 0) {
        longitude = longitude + Math.PI;
    }

    return [latitude, longitude, altitude];
}

export function ECEFToLLA_Sphere(X, Y, Z) {
    const R = wgs84.RADIUS; // Radius of the Earth

    // Calculate LLA
    const latitude  = Math.atan2(Z, Math.sqrt(X*X + Y*Y));
    const longitude = Math.atan2(Y, X);
    const altitude  = Math.sqrt(X*X + Y*Y + Z*Z) - R;

    return [latitude, longitude, altitude];
}


// same functions, but passing and returning parameters as a Vector3
// with LL as degrees
export function ECEFToLLAVD_Sphere(V) {
    const a = ECEFToLLA_Sphere(V.x,V.y,V.z);
    return new Vector3(a[0] * 180 / Math.PI, a[1] * 180 / Math.PI, a[2])
}

export function EUSToLLA(eus) {
    const ecef = EUSToECEF(eus);
    return ECEFToLLAVD_Sphere(ecef);
}




// same functions, but passing and returning parameters as a Vector3
// with LL as degrees
export function ECEFToLLAVD(V) {
    const a = ECEFToLLA(V.x,V.y,V.z);
    return new Vector3(a[0] * 180 / Math.PI, a[1] * 180 / Math.PI, a[2])
}

// and with radians
export function ECEFToLLAV(V) {
    const a = ECEFToLLA(V.x,V.y,V.z);
    return new Vector3((a[0]),(a[1]),a[2])
}


export function LLAToECEFVD(V) {
    const a = RLLAToECEF(V.x * Math.PI / 180, V.y * Math.PI / 180, V.z);
    return new Vector3(a[0],a[1],a[2])
}


// N is the radius of curvature at a given latitude
export function getN(latitude) {

    const a    = wgs84.RADIUS;
    const f    = wgs84.FLATTENING;
    const b    = wgs84.POLAR_RADIUS;
    const asqr = a*a;
    const bsqr = b*b;
    const e = Math.sqrt((asqr-bsqr)/asqr);
    const eprime = Math.sqrt((asqr-bsqr)/bsqr);

    const sinlatitude = Math.sin(latitude);
    const denom = Math.sqrt(1-e*e*sinlatitude*sinlatitude);
    const N = a / denom;
    return N;
}


// Models in Google Earth exist in a local coordinate system, where point a is going to be at 0,0,0
// and point B will be a transformed A2B vector away (same length)
// we need to tranlast between coordinate systems. So we need to calculate a set or orthogonal vectors
// for a coordinate system at A
// The local coordinate system has basis vectors in ECEF of:
// x = due east (right)
// y = due north (forward)
// z = up from center (up)
// This is known in the literature as an ENU system.


// see: https://en.wikipedia.org/wiki/Geographic_coordinate_conversion#Geodetic_to/from_ENU_coordinates
// the latitude and longitude define the ENU coordinate system realtive to A
// so we just need the standard transform
// note Google Earth uses Geodetic latitude, as required. Meaning the up vector is perpendicular to
// the tangent of the ellipse, and not through the center of the ellipse
// this is basically a rotation matrix created with two angles.
// Roatate about (y?) with latitude, and then about z with longtitude

// lat1, lon1 in radians
export function ECEF2ENU(pos,lat1, lon1, radius, justRotate=false) {
    assert(radius !== undefined, "ECEF2ENU needs explicit radius" )
    // the origin in ECEF coordinates is at the surface with lat1, lon1

    const mECEF2ENU = new Matrix3().set(
        -Math.sin(lon1), Math.cos(lon1), 0,
        -Math.sin(lat1) * Math.cos(lon1), -Math.sin(lat1) * Math.sin(lon1), Math.cos(lat1),
        Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)
    );
    let enu
    if (!justRotate) {
        const originECEF = RLLAToECEFV_Sphere(lat1, lon1, 0, radius)
        enu = pos.clone().sub((originECEF)).applyMatrix3(mECEF2ENU)
    } else {
        enu = pos.clone().applyMatrix3(mECEF2ENU)
    }

    return enu;
}

export function ECEF2EUS(pos,lat1, lon1, radius, justRotate=false) {
    const enu = ECEF2ENU(pos,lat1, lon1, radius, justRotate)
    return new Vector3(enu.x, enu.z, -enu.y)
}

// Inverse of ECEF2ENU - converts from ENU to ECEF
export function ENU2ECEF(pos, lat1, lon1, radius, justRotate=false) {
    assert(radius !== undefined, "ENU2ECEF needs explicit radius")
    
    // Create the inverse transformation matrix (ENU to ECEF)
    const mECEF2ENU = new Matrix3().set(
        -Math.sin(lon1), Math.cos(lon1), 0,
        -Math.sin(lat1) * Math.cos(lon1), -Math.sin(lat1) * Math.sin(lon1), Math.cos(lat1),
        Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)
    );
    
    const mENU2ECEF = new Matrix3().copy(mECEF2ENU).invert();
    
    let ecef;
    if (!justRotate) {
        const originECEF = RLLAToECEFV_Sphere(lat1, lon1, 0, radius);
        ecef = pos.clone().applyMatrix3(mENU2ECEF).add(originECEF);
    } else {
        ecef = pos.clone().applyMatrix3(mENU2ECEF);
    }
    
    return ecef;
}

// Inverse of EUSToECEF - converts from ECEF to EUS (at Sit location)
export function ECEFToEUS(posECEF, radius) {
    assert(radius === undefined, "unexpected radius in ECEFToEUS")
    
    const lat1 = Sit.lat * Math.PI / 180;
    const lon1 = Sit.lon * Math.PI / 180;
    
    const mECEF2ENU = new Matrix3().set(
        -Math.sin(lon1), Math.cos(lon1), 0,
        -Math.sin(lat1) * Math.cos(lon1), -Math.sin(lat1) * Math.sin(lon1), Math.cos(lat1),
        Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)
    );
    
    // Get the origin in ECEF
    const originECEF = RLLAToECEFV_Sphere(lat1, lon1, 0);
    
    // Subtract origin and apply rotation to get ENU
    const enu = posECEF.clone().sub(originECEF).applyMatrix3(mECEF2ENU);
    
    // Convert from ENU to EUS (reverse of: ENU = (EUS.x, -EUS.z, EUS.y))
    // So: EUS.x = ENU.x, EUS.y = ENU.z, EUS.z = -ENU.y
    const eus = new Vector3(enu.x, enu.z, -enu.y);
    
    return eus;
}

// This is a work in progress.
// export function EUSToECEF(posEUS, lat1, lon1, radius) {
//     var mECEF2ENU = new Matrix3().set(
//         -sin(lon1), cos(lon1), 0,
//         -sin(lat1) * cos(lon1), -sin(lat1) * sin(lon1), cos(lat1),
//         cos(lat1) * cos(lon1), cos(lat1) * sin(lon1), sin(lat1)
//     );
//     var mENU2ECEF = new Matrix3().getInverse(ECEF2ENU);
//     var originECEF = RLLAToECEFV_Sphere(lat1, lon1, 0, radius)
//     var enu = new Vector3(eus.x, -eus.z, eus.y)
//     var ecef = enu.applyMatrix3() // TODO!!!!!!!!
//
// }

export function EUSToECEF(posEUS, radius) {
    assert(radius === undefined, "undexpected radius in EUSToECEF")

    const lat1 = Sit.lat * Math.PI / 180
    const lon1 = Sit.lon * Math.PI / 180

    const mECEF2ENU = new Matrix3().set(
        -Math.sin(lon1), Math.cos(lon1), 0,
        -Math.sin(lat1) * Math.cos(lon1), -Math.sin(lat1) * Math.sin(lon1), Math.cos(lat1),
        Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)
    );

    const mENU2ECEF = new Matrix3()
    mENU2ECEF.copy(mECEF2ENU)
    mENU2ECEF.invert()

    // RLLAToECEFV_Sphere converts from spherical coordinates to ECEF
    const originECEF = RLLAToECEFV_Sphere(lat1, lon1, 0);

    // Convert from eus to enu
    const enu = new Vector3(posEUS.x, -posEUS.z, posEUS.y);

    // Apply the matrix transformation
    const ecef = enu.applyMatrix3(mENU2ECEF);

    // You might want to add this ECEF coordinate to the origin to get the final ECEF coordinate
    ecef.add(originECEF);

    return ecef;
}

// Pre-computed constants for optimization - updated when Sit location changes
let _sitLatRad, _sitLonRad, _sitSinLat, _sitCosLat, _sitSinLon, _sitCosLon;
let _originEcefX, _originEcefY, _originEcefZ;
let _m00, _m01, _m10, _m11, _m12, _m20, _m21, _m22;
let _lastSitLat = null, _lastSitLon = null;

// Constant for radians conversion (Math.PI / 180)
const _DEG_TO_RAD = 0.017453292519943295;

// Update pre-computed constants when Sit location changes
function _updateSitConstants() {
    if (Sit.lat === _lastSitLat && Sit.lon === _lastSitLon) {
        return; // No change, constants are still valid
    }
    
    _lastSitLat = Sit.lat;
    _lastSitLon = Sit.lon;
    
    _sitLatRad = Sit.lat * _DEG_TO_RAD;
    _sitLonRad = Sit.lon * _DEG_TO_RAD;
    _sitSinLat = Math.sin(_sitLatRad);
    _sitCosLat = Math.cos(_sitLatRad);
    _sitSinLon = Math.sin(_sitLonRad);
    _sitCosLon = Math.cos(_sitLonRad);
    
    // Pre-compute origin ECEF coordinates
    _originEcefX = wgs84.RADIUS * _sitCosLat * _sitCosLon;
    _originEcefY = wgs84.RADIUS * _sitCosLat * _sitSinLon;
    _originEcefZ = wgs84.RADIUS * _sitSinLat;
    
    // Pre-compute transformation matrix elements
    _m00 = -_sitSinLon;
    _m01 = _sitCosLon;
    // _m02 = 0 (not needed, always zero)
    _m10 = -_sitSinLat * _sitCosLon;
    _m11 = -_sitSinLat * _sitSinLon;
    _m12 = _sitCosLat;
    _m20 = _sitCosLat * _sitCosLon;
    _m21 = _sitCosLat * _sitSinLon;
    _m22 = _sitSinLat;
}

// Convert LLA to Spherical EUS. Optional earth's radius parameter is deprecated, and should not be used.
// OPTIMIZED VERSION: All calculations inlined with pre-computed constants for maximum performance
export function LLAToEUSRadians(lat, lon, alt=0, radius) {
    assert(radius === undefined, "undexpected radius in LLAToEUS")
    assert(Sit.lat != undefined, "Sit.lat undefined in LLAToEUS")
    
    // Update constants if Sit location changed
    _updateSitConstants();
    
    // Pre-compute trigonometric functions
    const cos_lat = Math.cos(lat);
    const sin_lat = Math.sin(lat);
    const cos_lon = Math.cos(lon);
    const sin_lon = Math.sin(lon);
    
    // Convert LLA to ECEF (spherical) - inlined for speed
    const r_plus_alt = wgs84.RADIUS + alt;
    const ecef_x = r_plus_alt * cos_lat * cos_lon;
    const ecef_y = r_plus_alt * cos_lat * sin_lon;
    const ecef_z = r_plus_alt * sin_lat;
    
    // Subtract origin ECEF to get relative position
    const rel_x = ecef_x - _originEcefX;
    const rel_y = ecef_y - _originEcefY;
    const rel_z = ecef_z - _originEcefZ;
    
    // Apply ECEF to ENU transformation matrix (inlined)
    const enu_x = _m00 * rel_x + _m01 * rel_y;  // _m02 * rel_z is always 0
    const enu_y = _m10 * rel_x + _m11 * rel_y + _m12 * rel_z;
    const enu_z = _m20 * rel_x + _m21 * rel_y + _m22 * rel_z;
    
    // Convert ENU to EUS coordinate system and return
    return new Vector3(enu_x, enu_z, -enu_y);
}

// Convert LLA to Spherical EUS. Optional earth's radius parameter is deprecated, and should not be used.
// OPTIMIZED VERSION: Uses constant multiplier for degree to radian conversion
export function LLAToEUS(lat, lon, alt=0, radius) {
    // Convert degrees to radians using constant multiplier (faster than radians() function)
    return LLAToEUSRadians(lat * _DEG_TO_RAD, lon * _DEG_TO_RAD, alt, radius);
}

// vector input version
export function LLAVToEUS(lla, radius) {
    assert(radius === undefined, "undexpected radius in LLAVToEUS")
    return LLAToEUS(lla.x, lla.y, lla.z)
}

// Force update of LLA to EUS constants (call this if you manually change Sit.lat/lon)
export function updateLLAToEUSConstants() {
    _lastSitLat = null;
    _lastSitLon = null;
    _updateSitConstants();
}


// Convert RA, Dec to Az, El
// Inputs in radians, outputs in radians
// modified so az is positive clockwise from north
export function raDecToAzElRADIANS(ra, dec, lat, lon, lst) {
    // Calculate the Hour Angle (HA)
    const ha = lst - ra;

    // Calculate Altitude (Elevation - El)
    const sinEl = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
    const el = Math.asin(sinEl);

    // Calculate Azimuth (Az)
    const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
    const sinAz = Math.cos(dec) * Math.sin(ha) / Math.cos(el);
    let az = -Math.atan2(sinAz, cosAz);

    // // Convert azimuth from [-π, π] to [0, 2π]
    // if (az < 0) {
    //     az += 2 * Math.PI;
    // }

    return { az, el };
}

// GIven a date JS object (which also contains time) and a longitiude
// Find the Local Sidereal time.
export function getLST(date, longitude) {
    // Convert date to Julian Date
    const JD = date.getTime() / 86400000 + 2440587.5;

    // Calculate the number of centuries since the epoch J2000.0
    const T = (JD - 2451545.0) / 36525;

    // Calculate the Greenwich Mean Sidereal Time (GMST)
    let GMST = 280.46061837 + 360.98564736629 * (JD - 2451545) + T * T * (0.000387933 - T / 38710000);
    GMST %= 360;  // Reduce to between 0 and 360 degrees
    if (GMST < 0) GMST += 360;  // Make sure it's positive

    // Convert to radians
    GMST = GMST * Math.PI / 180;

    // Adjust by longitude to get Local Sidereal Time (in radians)
    const LST = GMST + longitude;

    // Reduce to between 0 and 2π radians
    return LST % (2 * Math.PI);
}


// given a position on the celestial sphere, find the az and el from a particular lat, lon
// BAD
export function ECEFCelestialToAzEl(ecef, lat, lon) {
    // First convert to ENU, so locally Z is up
    const enu = ECEF2ENU(ecef, lat, lon, 1, true)

    // elevation is now the angle between the ENU vector and the XY plane

    const r = enu.length();

    const el = Math.asin(enu.z/r)
    const az = Math.atan2(enu.x,enu.y)

    return {az,el}
}


//var mENU2ECEF = new Matrix3().getInverse(ECEF2ENU);