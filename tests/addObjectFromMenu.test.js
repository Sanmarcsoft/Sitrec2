import {parseObjectInput} from '../src/utils/parseObjectInput';

describe('parseObjectInput', () => {

    test('parses full input with name and altitude in meters', () => {
        const result = parseObjectInput("MyObject 37.7749 -122.4194 100m");
        expect(result).not.toBeNull();
        expect(result.name).toBe("MyObject");
        expect(result.lat).toBeCloseTo(37.7749);
        expect(result.lon).toBeCloseTo(-122.4194);
        expect(result.alt).toBeCloseTo(100);
        expect(result.hasExplicitAlt).toBe(true);
    });

    test('parses comma-separated input without name', () => {
        const result = parseObjectInput("37.7749, -122.4194, 100m");
        expect(result).not.toBeNull();
        expect(result.name).toBeNull();
        expect(result.lat).toBeCloseTo(37.7749);
        expect(result.lon).toBeCloseTo(-122.4194);
        expect(result.alt).toBeCloseTo(100);
        expect(result.hasExplicitAlt).toBe(true);
    });

    test('parses input with name but no altitude', () => {
        const result = parseObjectInput("Landmark 37.7749 -122.4194");
        expect(result).not.toBeNull();
        expect(result.name).toBe("Landmark");
        expect(result.lat).toBeCloseTo(37.7749);
        expect(result.lon).toBeCloseTo(-122.4194);
        expect(result.hasExplicitAlt).toBe(false);
    });

    test('parses input with altitude in feet and converts to meters', () => {
        const result = parseObjectInput("37.7749 -122.4194 300ft");
        expect(result).not.toBeNull();
        expect(result.lat).toBeCloseTo(37.7749);
        expect(result.lon).toBeCloseTo(-122.4194);
        expect(result.alt).toBeCloseTo(91.44); // 300 * 0.3048
        expect(result.hasExplicitAlt).toBe(true);
    });

    test('parses space-separated input without name or altitude', () => {
        const result = parseObjectInput("37.7749 -122.4194");
        expect(result).not.toBeNull();
        expect(result.name).toBeNull();
        expect(result.lat).toBeCloseTo(37.7749);
        expect(result.lon).toBeCloseTo(-122.4194);
        expect(result.hasExplicitAlt).toBe(false);
    });

    test('handles negative coordinates', () => {
        const result = parseObjectInput("-33.8688 151.2093 50m");
        expect(result).not.toBeNull();
        expect(result.lat).toBeCloseTo(-33.8688);
        expect(result.lon).toBeCloseTo(151.2093);
        expect(result.alt).toBeCloseTo(50);
    });

    test('handles altitude without unit suffix (defaults to meters)', () => {
        const result = parseObjectInput("37.7749 -122.4194 200");
        expect(result).not.toBeNull();
        expect(result.alt).toBeCloseTo(200);
        expect(result.hasExplicitAlt).toBe(true);
    });

    test('handles decimal altitude values', () => {
        const result = parseObjectInput("37.7749 -122.4194 123.45m");
        expect(result).not.toBeNull();
        expect(result.alt).toBeCloseTo(123.45);
    });

    test('returns null for empty string', () => {
        const result = parseObjectInput("");
        expect(result).toBeNull();
    });

    test('returns null for whitespace only', () => {
        const result = parseObjectInput("   ");
        expect(result).toBeNull();
    });

    test('returns null for invalid input (no numbers)', () => {
        const result = parseObjectInput("Just a name");
        expect(result).toBeNull();
    });

    test('returns null for insufficient coordinates (only one number)', () => {
        const result = parseObjectInput("37.7749");
        expect(result).toBeNull();
    });

    test('returns null for null input', () => {
        const result = parseObjectInput(null);
        expect(result).toBeNull();
    });

    test('handles multi-word names', () => {
        const result = parseObjectInput("Golden Gate Bridge 37.8199 -122.4783 67m");
        expect(result).not.toBeNull();
        expect(result.name).toBe("Golden Gate Bridge");
        expect(result.lat).toBeCloseTo(37.8199);
        expect(result.lon).toBeCloseTo(-122.4783);
        expect(result.alt).toBeCloseTo(67);
    });

    test('handles mixed comma and space separation', () => {
        const result = parseObjectInput("Object1 37.7749, -122.4194, 100m");
        expect(result).not.toBeNull();
        expect(result.name).toBe("Object1");
        expect(result.lat).toBeCloseTo(37.7749);
        expect(result.lon).toBeCloseTo(-122.4194);
        expect(result.alt).toBeCloseTo(100);
    });
});
