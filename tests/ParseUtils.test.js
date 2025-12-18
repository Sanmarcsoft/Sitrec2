import {parseISODate} from "../src/ParseUtils";

describe('parseISODate', () => {
    describe('ISO 8601 with explicit timezone', () => {
        test('parses ISO date with Z (Zulu/UTC)', () => {
            const date = parseISODate('2024-04-24T16:44:11Z');
            expect(date.toISOString()).toBe('2024-04-24T16:44:11.000Z');
        });

        test('parses ISO date with milliseconds and Z', () => {
            const date = parseISODate('2024-04-24T16:44:11.000Z');
            expect(date.toISOString()).toBe('2024-04-24T16:44:11.000Z');
        });

        test('parses ISO date with positive timezone offset', () => {
            const date = parseISODate('2024-04-24T16:44:11+05:00');
            expect(date.getTime()).toBe(Date.parse('2024-04-24T16:44:11+05:00'));
        });

        test('parses ISO date with negative timezone offset', () => {
            const date = parseISODate('2024-04-24T16:44:11-07:00');
            expect(date.getTime()).toBe(Date.parse('2024-04-24T16:44:11-07:00'));
        });

        test('parses ISO date with milliseconds and timezone offset', () => {
            const date = parseISODate('2024-04-24T16:44:11.500+02:00');
            expect(date.getTime()).toBe(Date.parse('2024-04-24T16:44:11.500+02:00'));
        });
    });

    describe('ISO 8601 without timezone (assumes Zulu)', () => {
        test('appends Z to ISO date without timezone', () => {
            const date = parseISODate('2024-04-24T16:44:11');
            expect(date.toISOString()).toBe('2024-04-24T16:44:11.000Z');
        });

        test('appends Z to ISO date with milliseconds but no timezone', () => {
            const date = parseISODate('2024-04-24T16:44:11.123');
            expect(date.toISOString()).toBe('2024-04-24T16:44:11.123Z');
        });

        test('converts to UTC when Z is appended', () => {
            const dateWithoutTz = parseISODate('2024-04-24T16:44:11');
            const dateWithZ = parseISODate('2024-04-24T16:44:11Z');
            expect(dateWithoutTz.getTime()).toBe(dateWithZ.getTime());
        });
    });

    describe('edge cases and invalid input', () => {
        test('handles empty string', () => {
            const date = parseISODate('');
            expect(isNaN(date.getTime())).toBe(true);
        });

        test('handles null input', () => {
            const date = parseISODate(null);
            expect(isNaN(date.getTime())).toBe(true);
        });

        test('handles undefined input', () => {
            const date = parseISODate(undefined);
            expect(isNaN(date.getTime())).toBe(true);
        });

        test('handles invalid date string', () => {
            const date = parseISODate('not-a-date');
            expect(isNaN(date.getTime())).toBe(true);
        });

        test('handles malformed ISO string', () => {
            const date = parseISODate('2024-13-45T25:99:99Z');
            expect(isNaN(date.getTime())).toBe(true);
        });
    });

    describe('timezone offset regex accuracy', () => {
        test('does not append Z to string already ending with Z', () => {
            const date = parseISODate('2024-04-24T16:44:11Z');
            const isoStr = date.toISOString();
            expect(isoStr).not.toMatch(/ZZ/);
        });

        test('does not append Z to string with +HH:MM offset', () => {
            const dateStr = '2024-04-24T16:44:11+05:30';
            const date = parseISODate(dateStr);
            expect(date.getTime()).toBe(Date.parse(dateStr));
        });

        test('does not append Z to string with -HH:MM offset', () => {
            const dateStr = '2024-04-24T16:44:11-03:45';
            const date = parseISODate(dateStr);
            expect(date.getTime()).toBe(Date.parse(dateStr));
        });

        test('appends Z to ISO date with space before time', () => {
            const date = parseISODate('2024-04-24 16:44:11');
            expect(date.toISOString()).toMatch(/Z$/);
        });
    });

    describe('consistency with parseISODate usage', () => {
        test('can be used for CSV date parsing without manual timezone handling', () => {
            const csvDateWithoutTz = '2024-04-24T16:44:11';
            const date = parseISODate(csvDateWithoutTz).getTime();
            expect(typeof date).toBe('number');
            expect(isNaN(date)).toBe(false);
        });

        test('handles both timezone-aware and unaware dates', () => {
            const dates = [
                '2024-04-24T16:44:11Z',
                '2024-04-24T16:44:11+05:00',
                '2024-04-24T16:44:11'
            ];
            
            dates.forEach(dateStr => {
                const date = parseISODate(dateStr);
                expect(isNaN(date.getTime())).toBe(false);
            });
        });
    });
});
