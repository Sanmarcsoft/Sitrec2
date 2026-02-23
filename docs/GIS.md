# GIS Concepts in Sitrec

Sitrec models the Earth as either a sphere or an oblate ellipsoid depending on the `useEllipsoid` setting. This document explains the reference surfaces and vertical datums involved, and how Sitrec converts between them.

## The WGS84 Ellipsoid

The **World Geodetic System 1984 (WGS84)** defines a reference ellipsoid that approximates the shape of the Earth. It is the coordinate system used by GPS and by most mapping services (Google Earth, Mapbox, Cesium, etc.).

Key parameters used in Sitrec (`LLA-ECEF-ENU.js`):

| Parameter | Value |
|-----------|-------|
| Semi-major axis (equatorial radius, *a*) | 6,378,137 m |
| Inverse flattening (1/*f*) | 298.257223563 |
| Flattening (*f*) | 1/298.257223563 |
| Semi-minor axis (polar radius, *b = a(1-f)*) | 6,356,752.314 m |

The difference between the equatorial and polar radii is about 21.4 km. This is small relative to the total radius but large enough to matter for accurate positioning — using a sphere instead of the ellipsoid introduces altitude errors of several kilometers at mid-latitudes.

When `useEllipsoid` is **false** (legacy mode), Sitrec treats both radii as equal to *a*, degenerating to a sphere. When **true**, the real WGS84 polar radius is used.

## The EGM96 Geoid

The ellipsoid is a smooth mathematical surface. The actual shape of sea level — driven by gravity variations from uneven mass distribution inside the Earth — is an irregular surface called the **geoid**.

**EGM96** (Earth Gravitational Model 1996) is a spherical harmonic model of the geoid. It defines the **geoid undulation** *N* at any point on Earth: the signed vertical distance between the geoid and the WGS84 ellipsoid. Typical values range from about -105 m to +85 m.

Sitrec uses the `egm96-universal` npm package to look up *N* at any latitude/longitude (`EGM96Geoid.js`).

## Three Kinds of Height

There are three common ways to express the height of a point:

```
Ellipsoid height (h)   — height above the WGS84 ellipsoid
Orthometric height (H) — height above the geoid (i.e. above mean sea level)
Geoid undulation (N)   — height of the geoid above the ellipsoid

h = H + N
```

In plain terms:
- **Orthometric height (H)** is what most people mean by "altitude above sea level" (MSL). It is what you see on a topographic map or an altimeter.
- **Ellipsoid height (h)** is the height above the WGS84 reference ellipsoid. It is what GPS receivers natively measure.
- **Geoid undulation (N)** is the difference. It varies smoothly across the Earth's surface and is provided by models like EGM96.

## AWS Terrain Tiles (Terrarium Format)

Sitrec loads elevation data from the **AWS Open Data Terrain Tiles** in Terrarium PNG format:

```
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
```

The elevation is encoded in the RGB channels of each pixel:

```
elevation = R * 256 + G + B / 256 - 32768   (meters)
```

These elevations are **orthometric heights** — heights above the EGM96 geoid (approximately MSL). They are *not* heights above the WGS84 ellipsoid.

### The Geoid Correction

Sitrec's internal coordinate system (EUS) is based on the WGS84 ellipsoid, so all positions are ultimately ellipsoid-relative. When loading Terrarium elevation tiles, Sitrec must convert orthometric heights to ellipsoid heights by adding the geoid undulation:

```
h_ellipsoid = h_terrarium + N
```

This is done per-pixel in `QuadTreeTile.js` (`computeElevationFromRGBA`). The geoid undulation is looked up at the four corners of each tile and bilinearly interpolated across the tile's pixels:

```javascript
const geoidCorners = geoidCorrectionForTile(mapProjection, z, x, y);
// ...
elevation[ij] = R * 256 + G + B / 256 - 32768
              + interpolateGeoidOffset(geoidCorners, xFrac, yFrac);
```

The same correction is applied to Mapbox terrain tiles (`computeElevationFromRGBA_MB`), which also provide orthometric heights.

Without this correction, terrain would be displaced vertically by up to ~100 m depending on location, causing visible misalignment with GPS tracks, satellite imagery, and 3D building tiles (which use ellipsoid coordinates).

## Coordinate Systems

Sitrec uses several coordinate systems internally:

| System | Description |
|--------|-------------|
| **LLA** | Latitude, Longitude, Altitude (geodetic, WGS84) |
| **ECEF** | Earth-Centered Earth-Fixed (Cartesian, origin at Earth's center) |
| **ENU** | East-North-Up (local tangent plane) |
| **EUS** | East-Up-South (Sitrec's rendering frame — a rotation of ENU to match Three.js conventions where Y is up) |

The conversion chain is: **LLA <-> ECEF <-> ENU <-> EUS**, implemented in `LLA-ECEF-ENU.js`. All conversions support both the spherical and ellipsoidal Earth models.

## 3D Tiles (Cesium / Google)

Cesium Ion and Google Photorealistic 3D Tiles are delivered in ECEF coordinates on the WGS84 ellipsoid. Sitrec transforms them into EUS using a precomputed ECEF-to-EUS matrix (`CNodeBuildings3DTiles.js`, `buildECEFToEUSMatrix4`). No geoid correction is needed here because the tile positions are already ellipsoid-relative.
