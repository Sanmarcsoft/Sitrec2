/**
 * @jest-environment jsdom
 */
import {CTrackFileMISB} from '../src/TrackFiles/CTrackFileMISB';
import {MISB, MISBFields} from '../src/MISBFields';

function createTestMISBArray(withCenter = false, withAngles = false) {
    const rows = [];
    for (let i = 0; i < 10; i++) {
        const row = new Array(MISBFields).fill(null);
        row[MISB.UnixTimeStamp] = 1609459200000 + i * 1000;
        row[MISB.SensorLatitude] = 40.0 + i * 0.001;
        row[MISB.SensorLongitude] = -104.0 + i * 0.001;
        row[MISB.SensorTrueAltitude] = 1000 + i * 10;
        if (withCenter) {
            row[MISB.FrameCenterLatitude] = 40.1 + i * 0.001;
            row[MISB.FrameCenterLongitude] = -104.1 + i * 0.001;
            row[MISB.FrameCenterElevation] = 500 + i * 5;
        }
        if (withAngles) {
            row[MISB.PlatformHeadingAngle] = 90 + i;
            row[MISB.PlatformPitchAngle] = 5 + i * 0.1;
            row[MISB.PlatformRollAngle] = i * 0.5;
            row[MISB.SensorRelativeAzimuthAngle] = 180;
            row[MISB.SensorRelativeElevationAngle] = -30;
            row[MISB.SensorRelativeRollAngle] = 0;
            row[MISB.SensorVerticalFieldofView] = 30;
        }
        row[MISB.PlatformTailNumber] = "N12345";
        rows.push(row);
    }
    return rows;
}

describe('CTrackFileMISB', () => {
    let misbArray;
    let trackFile;
    let misbWithCenter;
    let trackFileWithCenter;

    beforeAll(() => {
        misbArray = createTestMISBArray(false, true);
        trackFile = new CTrackFileMISB(misbArray);
        misbWithCenter = createTestMISBArray(true, true);
        trackFileWithCenter = new CTrackFileMISB(misbWithCenter);
    });

    describe('canHandle', () => {
        test('returns true for valid MISB array data', () => {
            expect(CTrackFileMISB.canHandle('test.klv', misbArray)).toBe(true);
        });

        test('returns false for empty array', () => {
            expect(CTrackFileMISB.canHandle('test.klv', [])).toBe(false);
        });

        test('returns false for null data', () => {
            expect(CTrackFileMISB.canHandle('test.klv', null)).toBe(false);
        });

        test('returns false for string data', () => {
            expect(CTrackFileMISB.canHandle('test.klv', 'not an array')).toBe(false);
        });

        test('returns false for object data', () => {
            expect(CTrackFileMISB.canHandle('test.klv', {kml: {}})).toBe(false);
        });
    });

    describe('doesContainTrack', () => {
        test('returns true for valid MISB data', () => {
            expect(trackFile.doesContainTrack()).toBe(true);
        });

        test('returns false for empty array', () => {
            const emptyTrack = new CTrackFileMISB([]);
            expect(emptyTrack.doesContainTrack()).toBe(false);
        });

        test('returns false for null data', () => {
            const nullTrack = new CTrackFileMISB(null);
            expect(nullTrack.doesContainTrack()).toBe(false);
        });
    });

    describe('toMISB', () => {
        test('returns MISB array for track index 0', () => {
            const misb = trackFile.toMISB(0);
            expect(Array.isArray(misb)).toBe(true);
            expect(misb.length).toBeGreaterThan(0);
        });

        test('track index 0 returns the original data', () => {
            const misb = trackFile.toMISB(0);
            expect(misb).toBe(misbArray);
        });

        test('first entry has sensor latitude', () => {
            const misb = trackFile.toMISB(0);
            expect(misb[0][MISB.SensorLatitude]).toBeDefined();
            expect(typeof misb[0][MISB.SensorLatitude]).toBe('number');
        });

        test('first entry has sensor longitude', () => {
            const misb = trackFile.toMISB(0);
            expect(misb[0][MISB.SensorLongitude]).toBeDefined();
            expect(typeof misb[0][MISB.SensorLongitude]).toBe('number');
        });

        test('first entry has timestamp', () => {
            const misb = trackFile.toMISB(0);
            expect(misb[0][MISB.UnixTimeStamp]).toBeDefined();
        });

        test('returns false for invalid track index', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const result = trackFile.toMISB(99);
            expect(result).toBe(false);
            warnSpy.mockRestore();
        });

        test('returns false for negative track index', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const result = trackFile.toMISB(-1);
            expect(result).toBe(false);
            warnSpy.mockRestore();
        });
    });

    describe('center track (index 1)', () => {
        test('trackFile without center has 1 track', () => {
            expect(trackFile._hasCenter()).toBe(false);
            expect(trackFile.getTrackCount()).toBe(1);
        });

        test('trackFileWithCenter has 2 tracks', () => {
            expect(trackFileWithCenter._hasCenter()).toBe(true);
            expect(trackFileWithCenter.getTrackCount()).toBe(2);
        });

        test('toMISB(1) returns center data with correct values', () => {
            const centerMisb = trackFileWithCenter.toMISB(1);
            expect(Array.isArray(centerMisb)).toBe(true);
            expect(centerMisb.length).toBe(10);
            expect(centerMisb[0][MISB.SensorLatitude]).toBeCloseTo(40.1, 3);
            expect(centerMisb[0][MISB.SensorLongitude]).toBeCloseTo(-104.1, 3);
            expect(centerMisb[0][MISB.SensorTrueAltitude]).toBe(500);
        });

        test('toMISB(1) returns false for track without center', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const result = trackFile.toMISB(1);
            expect(result).toBe(false);
            warnSpy.mockRestore();
        });
    });

    describe('getShortName', () => {
        test('prioritizes tail number over filename for track 0', () => {
            const name = trackFile.getShortName(0, 'Truck.klv');
            expect(name).toBe('N12345');
        });

        test('returns Center_ prefix with tail number for track 1', () => {
            const name = trackFileWithCenter.getShortName(1, 'Truck.klv');
            expect(name).toBe('Center_N12345');
        });

        test('uses tail number if available and no filename', () => {
            const name = trackFile.getShortName(0, '');
            expect(name).toBe('N12345');
        });

        test('falls back to filename if no tail number', () => {
            const noTailMisb = createTestMISBArray(false, false);
            noTailMisb[0][MISB.PlatformTailNumber] = null;
            const noTailFile = new CTrackFileMISB(noTailMisb);
            const name = noTailFile.getShortName(0, 'Truck.klv');
            expect(name).toBe('Truck');
        });

        test('returns default name if no tail number and no filename', () => {
            const noTailMisb = createTestMISBArray(false, false);
            noTailMisb[0][MISB.PlatformTailNumber] = null;
            const noTailFile = new CTrackFileMISB(noTailMisb);
            const name = noTailFile.getShortName(0, '');
            expect(name).toBe('MISB Track');
        });
    });

    describe('hasMoreTracks', () => {
        test('returns false for track 0 if no center track', () => {
            expect(trackFile.hasMoreTracks(0)).toBe(false);
        });

        test('returns true for track 0 if has center track', () => {
            expect(trackFileWithCenter.hasMoreTracks(0)).toBe(true);
        });

        test('returns false for last track', () => {
            expect(trackFileWithCenter.hasMoreTracks(1)).toBe(false);
        });
    });

    describe('getTrackCount', () => {
        test('returns 1 without center track', () => {
            expect(trackFile.getTrackCount()).toBe(1);
        });

        test('returns 2 with center track', () => {
            expect(trackFileWithCenter.getTrackCount()).toBe(2);
        });
    });

    describe('angle data detection', () => {
        test('_hasAngles returns true for data with angles', () => {
            expect(trackFile._hasAngles()).toBe(true);
        });

        test('_hasAngles returns false for data without angles', () => {
            const noAnglesMisb = createTestMISBArray(false, false);
            const noAnglesFile = new CTrackFileMISB(noAnglesMisb);
            expect(noAnglesFile._hasAngles()).toBe(false);
        });

        test('_hasFOV returns true for data with FOV', () => {
            expect(trackFile._hasFOV()).toBe(true);
        });

        test('_hasFOV returns false for data without FOV', () => {
            const noFOVMisb = createTestMISBArray(false, false);
            const noFOVFile = new CTrackFileMISB(noFOVMisb);
            expect(noFOVFile._hasFOV()).toBe(false);
        });
    });

    describe('extractObjects', () => {
        test('does not throw', () => {
            expect(() => trackFile.extractObjects()).not.toThrow();
        });
    });
});
