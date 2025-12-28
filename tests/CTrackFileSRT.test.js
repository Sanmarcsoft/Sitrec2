import fs from 'fs';
import path from 'path';
import {CTrackFileSRT} from '../src/TrackFiles/CTrackFileSRT';
import {MISB} from '../src/MISBFields';

const testSRTPath = path.join(__dirname, '../data/test/DJI_20231217152755_0007_D.SRT');

describe('CTrackFileSRT', () => {
    let srtData;
    let trackFile;

    beforeAll(() => {
        srtData = fs.readFileSync(testSRTPath, 'utf-8');
        trackFile = new CTrackFileSRT(srtData);
    });

    describe('canHandle', () => {
        test('returns true for valid SRT data', () => {
            expect(CTrackFileSRT.canHandle('test.srt', srtData)).toBe(true);
        });

        test('returns false for empty string', () => {
            expect(CTrackFileSRT.canHandle('test.srt', '')).toBe(false);
        });

        test('returns false for null data', () => {
            expect(CTrackFileSRT.canHandle('test.srt', null)).toBe(false);
        });

        test('returns false for object data', () => {
            expect(CTrackFileSRT.canHandle('test.srt', {})).toBe(false);
        });

        test('returns false for invalid SRT string', () => {
            expect(CTrackFileSRT.canHandle('test.srt', 'not valid srt data')).toBe(false);
        });
    });

    describe('doesContainTrack', () => {
        test('returns true for valid SRT data', () => {
            expect(trackFile.doesContainTrack()).toBe(true);
        });

        test('returns false for empty string', () => {
            const emptyTrack = new CTrackFileSRT('');
            expect(emptyTrack.doesContainTrack()).toBe(false);
        });

        test('returns false for invalid data', () => {
            const invalidTrack = new CTrackFileSRT('not valid srt data');
            expect(invalidTrack.doesContainTrack()).toBe(false);
        });

        test('returns false for null data', () => {
            const nullTrack = new CTrackFileSRT(null);
            expect(nullTrack.doesContainTrack()).toBe(false);
        });
    });

    describe('toMISB', () => {
        test('returns MISB array for valid SRT data', () => {
            const misb = trackFile.toMISB();
            expect(Array.isArray(misb)).toBe(true);
            expect(misb.length).toBeGreaterThan(0);
        });

        test('first entry has correct latitude from test file', () => {
            const misb = trackFile.toMISB();
            expect(parseFloat(misb[0][MISB.SensorLatitude])).toBeCloseTo(36.06571, 4);
        });

        test('first entry has correct longitude from test file', () => {
            const misb = trackFile.toMISB();
            expect(parseFloat(misb[0][MISB.SensorLongitude])).toBeCloseTo(-119.01938, 4);
        });

        test('first entry has correct altitude from test file', () => {
            const misb = trackFile.toMISB();
            expect(parseFloat(misb[0][MISB.SensorTrueAltitude])).toBeCloseTo(134.835, 2);
        });

        test('first entry has timestamp', () => {
            const misb = trackFile.toMISB();
            expect(misb[0][MISB.UnixTimeStamp]).toBeDefined();
            expect(typeof misb[0][MISB.UnixTimeStamp]).toBe('number');
        });

        test('first entry has vertical FOV computed from focal length', () => {
            const misb = trackFile.toMISB();
            expect(misb[0][MISB.SensorVerticalFieldofView]).toBeDefined();
            expect(misb[0][MISB.SensorVerticalFieldofView]).toBeCloseTo(5, 1);
        });

        test('returns false for invalid track index', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const result = trackFile.toMISB(1);
            expect(result).toBe(false);
            warnSpy.mockRestore();
        });

        test('returns false for invalid data', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const invalidTrack = new CTrackFileSRT('not valid');
            expect(invalidTrack.toMISB()).toBe(false);
            warnSpy.mockRestore();
        });
    });

    describe('getShortName', () => {
        test('returns filename without extension when provided', () => {
            expect(trackFile.getShortName(0, 'DJI_20231217152755_0007_D.SRT')).toBe('DJI_20231217152755_0007_D');
        });

        test('returns default name when no filename provided', () => {
            expect(trackFile.getShortName()).toBe('SRT Track');
        });
    });

    describe('hasMoreTracks', () => {
        test('returns false (SRT files contain single track)', () => {
            expect(trackFile.hasMoreTracks()).toBe(false);
            expect(trackFile.hasMoreTracks(0)).toBe(false);
            expect(trackFile.hasMoreTracks(1)).toBe(false);
        });
    });

    describe('getTrackCount', () => {
        test('returns 1 (SRT files contain single track)', () => {
            expect(trackFile.getTrackCount()).toBe(1);
        });
    });

    describe('extractObjects', () => {
        test('does not throw', () => {
            expect(() => trackFile.extractObjects()).not.toThrow();
        });
    });
});
