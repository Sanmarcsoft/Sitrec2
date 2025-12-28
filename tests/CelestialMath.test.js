import {
    calculateGST,
    celestialToECEF,
    getJulianDate,
    getSiderealTime,
    raDec2Celestial,
    raDecToAltAz
} from '../src/CelestialMath.js';

describe('getJulianDate', () => {
    test('converts J2000.0 epoch correctly', () => {
        const j2000 = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
        const jd = getJulianDate(j2000.getTime());
        expect(jd).toBeCloseTo(2451545.0, 1);
    });

    test('converts Unix epoch correctly', () => {
        const unixEpoch = new Date(Date.UTC(1970, 0, 1, 0, 0, 0));
        const jd = getJulianDate(unixEpoch.getTime());
        expect(jd).toBeCloseTo(2440587.5, 1);
    });

    test('handles date in 2024', () => {
        const date = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
        const jd = getJulianDate(date.getTime());
        expect(jd).toBeCloseTo(2460310.5, 0);
    });

    test('handles fractional days', () => {
        const noon = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
        const midnight = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));
        const jdNoon = getJulianDate(noon.getTime());
        const jdMidnight = getJulianDate(midnight.getTime());
        expect(jdNoon - jdMidnight).toBeCloseTo(0.5, 5);
    });
});

describe('getSiderealTime', () => {
    test('returns value in 0-360 degree range for zero longitude', () => {
        const date = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
        const gst = getSiderealTime(date.getTime(), 0);
        expect(gst).toBeGreaterThanOrEqual(0);
        expect(gst).toBeLessThan(360);
    });

    test('longitude offset changes result by same amount', () => {
        const date = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
        const gst0 = getSiderealTime(date.getTime(), 0);
        const gst90 = getSiderealTime(date.getTime(), 90);
        let diff = (gst90 - gst0 + 360) % 360;
        expect(diff).toBeCloseTo(90, 0);
    });

    test('GMST increases by ~360 degrees per sidereal day', () => {
        const date1 = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
        const date2 = new Date(Date.UTC(2024, 0, 1, 23, 56, 4));
        const gst1 = getSiderealTime(date1.getTime(), 0);
        const gst2 = getSiderealTime(date2.getTime(), 0);
        const diff = (gst2 - gst1 + 360) % 360;
        expect(Math.min(diff, 360 - diff)).toBeLessThan(1);
    });
});

describe('calculateGST', () => {
    test('returns value in radians', () => {
        const date = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
        const gst = calculateGST(date.getTime());
        expect(Math.abs(gst)).toBeLessThanOrEqual(2 * Math.PI);
    });

    test('changes over time', () => {
        const date1 = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
        const date2 = new Date(Date.UTC(2024, 0, 1, 6, 0, 0));
        const gst1 = calculateGST(date1.getTime());
        const gst2 = calculateGST(date2.getTime());
        expect(gst1).not.toBe(gst2);
    });

    test('increases with time', () => {
        const date1 = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
        const date2 = new Date(Date.UTC(2024, 0, 1, 1, 0, 0));
        const gst1 = calculateGST(date1.getTime());
        const gst2 = calculateGST(date2.getTime());
        const diff = gst2 - gst1;
        expect(diff).toBeGreaterThan(0);
    });
});

describe('raDec2Celestial', () => {
    test('vernal equinox (RA=0, Dec=0) points along X axis', () => {
        const result = raDec2Celestial(0, 0, 1);
        expect(result.x).toBeCloseTo(1, 5);
        expect(result.y).toBeCloseTo(0, 5);
        expect(result.z).toBeCloseTo(0, 5);
    });

    test('RA=90 degrees (PI/2), Dec=0 points along Y axis', () => {
        const result = raDec2Celestial(Math.PI / 2, 0, 1);
        expect(result.x).toBeCloseTo(0, 5);
        expect(result.y).toBeCloseTo(1, 5);
        expect(result.z).toBeCloseTo(0, 5);
    });

    test('Dec=90 degrees (PI/2) points along Z axis (north celestial pole)', () => {
        const result = raDec2Celestial(0, Math.PI / 2, 1);
        expect(result.x).toBeCloseTo(0, 5);
        expect(result.y).toBeCloseTo(0, 5);
        expect(result.z).toBeCloseTo(1, 5);
    });

    test('Dec=-90 degrees points along negative Z axis (south celestial pole)', () => {
        const result = raDec2Celestial(0, -Math.PI / 2, 1);
        expect(result.x).toBeCloseTo(0, 5);
        expect(result.y).toBeCloseTo(0, 5);
        expect(result.z).toBeCloseTo(-1, 5);
    });

    test('respects sphere radius parameter', () => {
        const radius = 1000;
        const result = raDec2Celestial(0, 0, radius);
        expect(result.length()).toBeCloseTo(radius, 0);
    });

    test('result vector has correct length', () => {
        const radii = [1, 100, 6378137];
        radii.forEach(r => {
            const result = raDec2Celestial(Math.PI / 4, Math.PI / 6, r);
            expect(result.length()).toBeCloseTo(r, 0);
        });
    });
});

describe('celestialToECEF', () => {
    test('converts equatorial position at GST=0', () => {
        const result = celestialToECEF(0, 0, 1, 0);
        expect(result.x).toBeCloseTo(1, 5);
        expect(result.y).toBeCloseTo(0, 5);
        expect(result.z).toBeCloseTo(0, 5);
    });

    test('GST rotation affects X and Y but not Z', () => {
        const gst = Math.PI / 2;
        const result = celestialToECEF(0, 0, 1, gst);
        expect(result.z).toBeCloseTo(0, 5);
        expect(Math.sqrt(result.x * result.x + result.y * result.y)).toBeCloseTo(1, 5);
    });

    test('declination affects Z component', () => {
        const dec = Math.PI / 4;
        const result = celestialToECEF(0, dec, 1, 0);
        expect(result.z).toBeCloseTo(Math.sin(dec), 5);
    });

    test('result has correct magnitude', () => {
        const dist = 1000;
        const result = celestialToECEF(Math.PI / 3, Math.PI / 6, dist, Math.PI / 4);
        expect(result.length()).toBeCloseTo(dist, 0);
    });
});

describe('raDecToAltAz', () => {
    test('returns object with az and el properties', () => {
        const jd = 2451545.0;
        const result = raDecToAltAz(0, 0, 0, 0, jd);
        expect(result).toHaveProperty('az');
        expect(result).toHaveProperty('el');
    });

    test('north celestial pole at north pole has high elevation', () => {
        const lat = Math.PI / 2;
        const lon = 0;
        const ra = 0;
        const dec = Math.PI / 2;
        const jd = 2451545.0;
        const result = raDecToAltAz(ra, dec, lat, lon, jd);
        expect(result.el).toBeCloseTo(Math.PI / 2, 1);
    });

    test('azimuth is in 0 to 2*PI range', () => {
        const testCases = [
            { ra: 0, dec: 0 },
            { ra: Math.PI, dec: 0 },
            { ra: Math.PI / 2, dec: Math.PI / 4 },
        ];
        
        const jd = 2451545.0;
        const lat = Math.PI / 4;
        const lon = 0;
        
        testCases.forEach(({ ra, dec }) => {
            const result = raDecToAltAz(ra, dec, lat, lon, jd);
            expect(result.az).toBeGreaterThanOrEqual(0);
            expect(result.az).toBeLessThanOrEqual(2 * Math.PI);
        });
    });

    test('elevation is in -PI/2 to PI/2 range', () => {
        const testCases = [
            { ra: 0, dec: 0 },
            { ra: Math.PI, dec: Math.PI / 4 },
            { ra: Math.PI / 2, dec: -Math.PI / 4 },
        ];
        
        const jd = 2451545.0;
        const lat = Math.PI / 4;
        const lon = 0;
        
        testCases.forEach(({ ra, dec }) => {
            const result = raDecToAltAz(ra, dec, lat, lon, jd);
            expect(result.el).toBeGreaterThanOrEqual(-Math.PI / 2);
            expect(result.el).toBeLessThanOrEqual(Math.PI / 2);
        });
    });

    test('longitude affects azimuth calculation', () => {
        const lat = Math.PI / 4;
        const jd = 2451545.0;
        const ra = Math.PI / 4;
        const dec = 0;
        
        const result1 = raDecToAltAz(ra, dec, lat, 0, jd);
        const result2 = raDecToAltAz(ra, dec, lat, Math.PI / 2, jd);
        
        expect(result1.az).not.toBeCloseTo(result2.az, 1);
    });
});
