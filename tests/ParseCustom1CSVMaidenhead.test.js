/**
 * @jest-environment jsdom
 */

jest.mock("../src/MISBUtils", () => {
    const MISB = {
        UnixTimeStamp: 2,
        SensorLatitude: 13,
        SensorLongitude: 14,
        SensorTrueAltitude: 15,
        TrackID: 59,
    };
    return {MISB, MISBFields: 121};
});

jest.mock("../src/Globals", () => ({
    GlobalDateTimeNode: {dateStart: new Date("2025-01-01T00:00:00.000Z")},
    Sit: {fps: 30},
}));

const {MISB} = require("../src/MISBUtils");
const {isCustom1, parseCustom1CSV} = require("../src/ParseCustom1CSV");
const {parseMGRS} = require("../src/CoordinateParser");

describe("parseCustom1CSV Maidenhead support", () => {
    test("detects DateTimeUtc + RegGrid files as CUSTOM1", () => {
        const csv = [
            ["DateTimeUtc", "RegGrid", "Grid56", "Grid"],
            ["2026-03-01 02:56", "RM50", "JH", "RM50JH"],
        ];

        expect(isCustom1(csv)).toBe(true);
    });

    test("parses Maidenhead from Grid, RegGrid+Grid56, and RegGrid fallback", () => {
        const csv = [
            ["DateTimeUtc", "RegGrid", "Grid56", "Grid"],
            ["2026-03-01 02:56", "RM50", "JH", "RM50JH"],
            ["2026-03-01 02:46", "RM50", "HK", ""],
            ["2026-03-01 02:26", "RM50", "", ""],
        ];

        const parsed = parseCustom1CSV(csv);

        // Data is reverse-chronological in the CSV, so after sorting:
        // [0] = 02:26 (RegGrid-only fallback, 4-char center)
        // [1] = 02:46 (RegGrid+Grid56 composite)
        // [2] = 02:56 (full 6-char Grid)
        expect(parsed[0][MISB.SensorLatitude]).toBeCloseTo(30.5, 6);
        expect(parsed[0][MISB.SensorLongitude]).toBeCloseTo(171, 6);

        expect(parsed[1][MISB.SensorLatitude]).toBeCloseTo(30.4375, 6);
        expect(parsed[1][MISB.SensorLongitude]).toBeCloseTo(170.625, 6);

        expect(parsed[2][MISB.SensorLatitude]).toBeCloseTo(30.3125, 6);
        expect(parsed[2][MISB.SensorLongitude]).toBeCloseTo(170.7916666667, 6);
    });

    test("parses DateTimeUtc as UTC timestamp", () => {
        const csv = [
            ["DateTimeUtc", "RegGrid", "Grid56", "Grid"],
            ["2026-03-01 02:56", "RM50", "JH", "RM50JH"],
        ];

        const parsed = parseCustom1CSV(csv);
        expect(parsed[0][MISB.UnixTimeStamp]).toBe(Date.UTC(2026, 2, 1, 2, 56, 0, 0));
    });

    test("prefers DateTimeUtc over generic Date when both exist", () => {
        const csv = [
            ["Date", "DateTimeUtc", "RegGrid"],
            ["2000-01-01 00:00", "2026-03-01 02:56", "RM50"],
        ];

        const parsed = parseCustom1CSV(csv);
        expect(parsed[0][MISB.UnixTimeStamp]).toBe(Date.UTC(2026, 2, 1, 2, 56, 0, 0));
    });

    test("keeps MGRS GRID parsing behavior", () => {
        const csv = [
            ["DateTimeUtc", "Grid"],
            ["2026-03-01 02:56", "18SUJ2337"],
        ];

        const parsed = parseCustom1CSV(csv);
        const expected = parseMGRS("18SUJ2337");

        expect(expected).not.toBeNull();
        expect(parsed[0][MISB.SensorLatitude]).toBeCloseTo(expected.lat, 6);
        expect(parsed[0][MISB.SensorLongitude]).toBeCloseTo(expected.lon, 6);
    });

    test("filters rows with missing coordinates for non-grid files", () => {
        const csv = [
            ["DateTimeUtc", "Lat", "Lon", "Altitude"],
            ["2026-03-01 02:56", "30.5", "171", "12,520"],
            ["2026-03-01 02:46", "", "", "12,500"],
            ["2026-03-01 02:36", "31.0", "172.0", "12,500"],
        ];

        const parsed = parseCustom1CSV(csv);
        expect(parsed).toHaveLength(2);

        // Reverse-chronological input is sorted ascending by timestamp.
        expect(parsed[0][MISB.UnixTimeStamp]).toBe(Date.UTC(2026, 2, 1, 2, 36, 0, 0));
        expect(parsed[1][MISB.UnixTimeStamp]).toBe(Date.UTC(2026, 2, 1, 2, 56, 0, 0));

        expect(parsed[0][MISB.SensorLatitude]).toBeCloseTo(31.0, 6);
        expect(parsed[0][MISB.SensorLongitude]).toBeCloseTo(172.0, 6);
        expect(parsed[1][MISB.SensorLatitude]).toBeCloseTo(30.5, 6);
        expect(parsed[1][MISB.SensorLongitude]).toBeCloseTo(171.0, 6);
    });
});
