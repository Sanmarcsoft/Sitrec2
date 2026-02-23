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


# (In Depth) Altitude Naming Conventions & the MSL Confusion Problem

## The Three Surfaces

| Surface | Description |
|---|---|
| **WGS84 Ellipsoid** | A smooth mathematical oblate spheroid. Pure geometry, no physical meaning. Reference for GPS. |
| **Geoid** | An equipotential gravitational surface approximating mean sea level. Irregular shape, physically meaningful. |
| **Mean Sea Level (MSL)** | Approximated by the geoid, but also used loosely for barometric altitude — the source of most confusion. |

---

## Standard Terms

### Ellipsoidal Height (geometric)
- **HAE** — Height Above Ellipsoid *(most common in military/DoD)*
- **Ellipsoidal height / ellipsoid height**
- **h** *(lowercase, formal geodetic literature)*
- *"GPS altitude"* *(informal)*

### Geoid / Orthometric Height (physical)
- **MSL** — Mean Sea Level *(aviation, colloquial — ambiguous, see below)*
- **AMSL** — Above Mean Sea Level *(aviation — same ambiguity)*
- **Orthometric height** *(formal geodetic term)*
- **H** *(uppercase, formal geodetic literature)*

### Geoid Undulation (the separation between the two)
- **N** — geoid undulation *(formal geodetic literature)*
- **Geoid separation** *(NMEA $GPGGA sentence field name)*
- **Geoid height** *(less precise — easily confused with "height above geoid")*

---

## The Fundamental Relationship

```
h (HAE) = H (orthometric/MSL) + N (geoid undulation)
```

The geoid undulation **N** ranges globally from approximately **−107 m** (Indian Ocean) to **+85 m** (North Atlantic). Over the continental US it is typically **+20 to +30 m**.

---

## Geoid Models

| Model | Resolution | Accuracy | Status |
|---|---|---|---|
| EGM96 | 15′ | ~1 m | Legacy — still dominant in military avionics, ArcGIS default |
| EGM2008 | 2.5′ / 1′ | ~10 cm | Current NGA standard, EPSG recommended, slow adoption |
| EGM2020 | TBD | Better | Not yet released as of early 2026; NGA plans ~2028 |

---

## The MSL Confusion Problem

"MSL" is used to mean **three different things** in practice:

### 1. Geodetic / GPS MSL (orthometric height)
Height above the geoid (EGM96 or EGM2008). Derived by GPS receiver applying a geoid model to the raw ellipsoidal height. This is the geodetically correct meaning.

### 2. Barometric / Aviation MSL
Height derived from atmospheric pressure, calibrated to the ISA (International Standard Atmosphere) model. Reported by altimeters and used in ATC. **Not the same as geodetic MSL** — deviates by tens of meters under non-standard temperature/pressure conditions.

### 3. "GPS altitude" mislabeled as MSL
Many GPS devices, NMEA sentences, and flight logs report the raw ellipsoidal height (HAE) but label it "altitude" or "MSL" — especially when the onboard geoid model is absent or low quality.

---

## NMEA $GPGGA Sentence
The NMEA standard correctly separates these:
```
$GPGGA,...,<MSL altitude>,M,<geoid separation>,M,...
```
- **MSL altitude** = orthometric height (H) above geoid
- **Geoid separation** = N (geoid height above ellipsoid)
- **Ellipsoidal height** = MSL altitude + geoid separation (h = H + N)

However, the geoid separation field is often populated from a coarse onboard table (sometimes just a single global constant), making it unreliable on many consumer devices.

---

## MISB ST 0601 (Military UAV Metadata)

| Tag | Name | Meaning |
|---|---|---|
| 15 | SensorTrueAltitude | MSL (orthometric, assumed EGM96) |
| 75 | SensorEllipsoidHeight | HAE (WGS84 ellipsoid) |
| 104 | SensorEllipsoidHeightExtended | HAE, extended precision |

The standard defines Tag 15 as "MSL" but **does not explicitly specify EGM96**. In practice, DoD platforms of the Predator/Reaper era use EGM96 as the geoid model. Tag 75 was added later specifically because Tag 15's ambiguity was a known problem.

---

## Summary of What to Assume

| Source | What "altitude" likely means |
|---|---|
| Raw GPS / GNSS receiver output | HAE (ellipsoidal) |
| NMEA $GPGGA "MSL altitude" field | Orthometric (geoid), quality varies |
| Aviation altimeter / ATC reports | Barometric MSL |
| Military KLV/MISB Tag 15 | EGM96 orthometric MSL |
| Military KLV/MISB Tag 75/104 | HAE (WGS84) |
| ArcGIS / web mapping elevation | EGM96 orthometric MSL |
| SRTM terrain data | EGM96 orthometric MSL |
