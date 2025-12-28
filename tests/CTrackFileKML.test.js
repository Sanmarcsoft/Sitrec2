/**
 * @jest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import {CTrackFileKML} from '../src/TrackFiles/CTrackFileKML';
import {parseXml} from '../src/parseXml';
import {MISB} from '../src/MISBFields';

jest.mock('../src/nodes/CNodeTrack', () => ({
    CNodeTrackFromLLAArray: jest.fn()
}));
jest.mock('../src/nodes/CNodeDisplayTrack', () => ({
    CNodeDisplayTrack: jest.fn()
}));
jest.mock('../src/LayerMasks', () => ({
    MASK_WORLD: 1
}));
jest.mock('../src/Globals', () => ({
    CustomManager: { shouldIgnore: () => false, ignore: () => {} },
    NodeMan: { getUniqueID: (name) => name },
    Sit: { allowDashInFlightNumber: false }
}));
jest.mock('../src/CFeatureManager', () => ({
    FeatureManager: { addFeature: jest.fn() }
}));

const testADSBXPath = path.join(__dirname, '../data/test/ADSBX - 3 tracks  N2983Z-N410WN-N414WN-track-press_alt_uncorrected.kml');
const testFR24Path = path.join(__dirname, '../data/test/FR24 KML WN276-3d7b69c5.kml');
const testFlightAwarePath = path.join(__dirname, '../data/test/FlightAware_N494SA_KLAX_KIPL_20250602.kml');

describe('CTrackFileKML', () => {
    let adsbxData, adsbxParsed, adsbxTrackFile;
    let fr24Data, fr24Parsed, fr24TrackFile;
    let flightAwareData, flightAwareParsed, flightAwareTrackFile;

    beforeAll(() => {
        adsbxData = fs.readFileSync(testADSBXPath, 'utf-8');
        adsbxParsed = parseXml(adsbxData);
        adsbxTrackFile = new CTrackFileKML(adsbxParsed);

        fr24Data = fs.readFileSync(testFR24Path, 'utf-8');
        fr24Parsed = parseXml(fr24Data);
        fr24TrackFile = new CTrackFileKML(fr24Parsed);

        flightAwareData = fs.readFileSync(testFlightAwarePath, 'utf-8');
        flightAwareParsed = parseXml(flightAwareData);
        flightAwareTrackFile = new CTrackFileKML(flightAwareParsed);
    });

    describe('canHandle', () => {
        test('returns true for ADSBX KML data', () => {
            expect(CTrackFileKML.canHandle('test.kml', adsbxParsed)).toBe(true);
        });

        test('returns true for FR24 KML data', () => {
            expect(CTrackFileKML.canHandle('test.kml', fr24Parsed)).toBe(true);
        });

        test('returns true for FlightAware KML data', () => {
            expect(CTrackFileKML.canHandle('test.kml', flightAwareParsed)).toBe(true);
        });

        test('returns false for empty object', () => {
            expect(CTrackFileKML.canHandle('test.kml', {})).toBe(false);
        });

        test('returns false for null data', () => {
            expect(CTrackFileKML.canHandle('test.kml', null)).toBe(false);
        });

        test('returns false for string data', () => {
            expect(CTrackFileKML.canHandle('test.kml', 'not an object')).toBe(false);
        });

        test('returns false for STANAG XML data', () => {
            expect(CTrackFileKML.canHandle('test.xml', {nitsRoot: {}})).toBe(false);
        });

        test('returns true for KML without tracks (buildings only)', () => {
            const buildingsOnlyKml = {kml: {Document: {Placemark: {Polygon: {}}}}};
            expect(CTrackFileKML.canHandle('test.kml', buildingsOnlyKml)).toBe(true);
        });
    });

    describe('doesContainTrack', () => {
        test('returns true for ADSBX multi-track KML', () => {
            expect(adsbxTrackFile.doesContainTrack()).toBe(true);
        });

        test('returns true for FR24 KML', () => {
            expect(fr24TrackFile.doesContainTrack()).toBe(true);
        });

        test('returns true for FlightAware KML', () => {
            expect(flightAwareTrackFile.doesContainTrack()).toBe(true);
        });

        test('throws or returns false for empty KML', () => {
            const emptyTrack = new CTrackFileKML({kml: {}});
            try {
                const result = emptyTrack.doesContainTrack();
                expect(result).toBe(false);
            } catch (e) {
                expect(e).toBeDefined();
            }
        });

        test('throws or returns false for KML with only buildings', () => {
            const buildingsOnly = new CTrackFileKML({kml: {Document: {Placemark: {Polygon: {}}}}});
            try {
                const result = buildingsOnly.doesContainTrack();
                expect(result).toBe(false);
            } catch (e) {
                expect(e).toBeDefined();
            }
        });
    });

    describe('toMISB - ADSBX format', () => {
        test('returns MISB array for first track', () => {
            const misb = adsbxTrackFile.toMISB(0);
            expect(Array.isArray(misb)).toBe(true);
            expect(misb.length).toBeGreaterThan(0);
        });

        test('first entry has timestamp', () => {
            const misb = adsbxTrackFile.toMISB(0);
            expect(misb[0][MISB.UnixTimeStamp]).toBeDefined();
            expect(typeof misb[0][MISB.UnixTimeStamp]).toBe('number');
        });

        test('first entry has valid coordinates', () => {
            const misb = adsbxTrackFile.toMISB(0);
            expect(misb[0][MISB.SensorLatitude]).toBeDefined();
            expect(misb[0][MISB.SensorLongitude]).toBeDefined();
            expect(misb[0][MISB.SensorTrueAltitude]).toBeDefined();
        });

        test('timestamps increase through track points', () => {
            const misb = adsbxTrackFile.toMISB(0);
            for (let i = 2; i < Math.min(misb.length, 20); i++) {
                expect(misb[i][MISB.UnixTimeStamp]).toBeGreaterThanOrEqual(misb[i-1][MISB.UnixTimeStamp]);
            }
        });
    });

    describe('toMISB - FR24 format', () => {
        test('returns MISB array', () => {
            const misb = fr24TrackFile.toMISB(0);
            expect(Array.isArray(misb)).toBe(true);
            expect(misb.length).toBeGreaterThan(0);
        });

        test('first entry has valid coordinates from Nashville area', () => {
            const misb = fr24TrackFile.toMISB(0);
            expect(misb[0][MISB.SensorLatitude]).toBeCloseTo(36.12, 0);
            expect(misb[0][MISB.SensorLongitude]).toBeCloseTo(-86.67, 0);
        });
    });

    describe('toMISB - FlightAware format', () => {
        test('returns MISB array', () => {
            const misb = flightAwareTrackFile.toMISB(0);
            expect(Array.isArray(misb)).toBe(true);
            expect(misb.length).toBeGreaterThan(0);
        });

        test('first entry has valid coordinates from LA area', () => {
            const misb = flightAwareTrackFile.toMISB(0);
            expect(misb[0][MISB.SensorLatitude]).toBeCloseTo(33.9, 0);
            expect(misb[0][MISB.SensorLongitude]).toBeCloseTo(-118.4, 0);
        });
    });

    describe('multi-track handling (ADSBX)', () => {
        test('hasMoreTracks returns true for first track', () => {
            expect(adsbxTrackFile.hasMoreTracks(0)).toBe(true);
        });

        test('hasMoreTracks returns true for second track', () => {
            expect(adsbxTrackFile.hasMoreTracks(1)).toBe(true);
        });

        test('hasMoreTracks returns false after last track', () => {
            expect(adsbxTrackFile.hasMoreTracks(2)).toBe(false);
        });

        test('getTrackCount returns 3 for 3-track file', () => {
            expect(adsbxTrackFile.getTrackCount()).toBe(3);
        });

        test('can extract second track', () => {
            const misb = adsbxTrackFile.toMISB(1);
            expect(Array.isArray(misb)).toBe(true);
            expect(misb.length).toBeGreaterThan(0);
        });

        test('can extract third track', () => {
            const misb = adsbxTrackFile.toMISB(2);
            expect(Array.isArray(misb)).toBe(true);
            expect(misb.length).toBeGreaterThan(0);
        });
    });

    describe('single-track handling', () => {
        test('FlightAware hasMoreTracks returns false', () => {
            expect(flightAwareTrackFile.hasMoreTracks(0)).toBe(false);
        });

        test('FlightAware getTrackCount returns 1', () => {
            expect(flightAwareTrackFile.getTrackCount()).toBe(1);
        });

        test('FR24 hasMoreTracks returns false', () => {
            expect(fr24TrackFile.hasMoreTracks(0)).toBe(false);
        });

        test('FR24 getTrackCount returns 1', () => {
            expect(fr24TrackFile.getTrackCount()).toBe(1);
        });
    });

    describe('getShortName', () => {
        test('ADSBX extracts track name from first track', () => {
            const name = adsbxTrackFile.getShortName(0);
            expect(name).toBe('N2983Z');
        });

        test('FlightAware extracts flight number', () => {
            const name = flightAwareTrackFile.getShortName(0);
            expect(name).toBe('N494SA');
        });

        test('FR24 extracts flight name', () => {
            const name = fr24TrackFile.getShortName(0);
            expect(typeof name).toBe('string');
            expect(name.length).toBeGreaterThan(0);
        });
    });

    describe('error handling', () => {
        test('toMISB returns false for invalid track index', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const result = adsbxTrackFile.toMISB(99);
            expect(result).toBe(false);
            warnSpy.mockRestore();
        });

        test('toMISB throws or returns false for KML without tracks', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const emptyKml = new CTrackFileKML({kml: {}});
            try {
                const result = emptyKml.toMISB();
                expect(result).toBe(false);
            } catch (e) {
                expect(e).toBeDefined();
            }
            warnSpy.mockRestore();
        });
    });

    describe('extractObjects', () => {
        test('does not throw for track-only KML', () => {
            expect(() => flightAwareTrackFile.extractObjects()).not.toThrow();
        });
    });
});
