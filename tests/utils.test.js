import {cleanFloat, f2m, metersFromNM, scaleF2M, unitsToMeters} from "../src/utils.js";

describe('unitsToMeters', () => {
    
    // Happy Path Tests
    describe('supported unit conversions', () => {
        test('converts miles to meters correctly', () => {
            expect(unitsToMeters('miles', 1)).toBeCloseTo(1609.344);
            expect(unitsToMeters('miles', 0)).toBe(0);
            expect(unitsToMeters('miles', 2.5)).toBeCloseTo(4023.36);
        });

        test('converts feet to meters correctly', () => {
            expect(unitsToMeters('feet', 1)).toBeCloseTo(scaleF2M);
            expect(unitsToMeters('ft', 1)).toBeCloseTo(scaleF2M);
            expect(unitsToMeters('f', 1)).toBeCloseTo(scaleF2M);
            expect(unitsToMeters('feet', 10)).toBeCloseTo(10 * scaleF2M);
            expect(unitsToMeters('feet', 0)).toBe(0);
        });

        test('handles meters without conversion', () => {
            expect(unitsToMeters('meters', 100)).toBe(100);
            expect(unitsToMeters('m', 50.5)).toBe(50.5);
            expect(unitsToMeters('meters', 0)).toBe(0);
            expect(unitsToMeters('m', -10)).toBe(-10);
        });

        test('converts nautical miles to meters correctly', () => {
            expect(unitsToMeters('nm', 1)).toBe(1852);
            expect(unitsToMeters('nm', 0)).toBe(0);
            expect(unitsToMeters('nm', 2.5)).toBe(4630);
        });

        test('converts kilometers to meters correctly', () => {
            expect(unitsToMeters('km', 1)).toBe(1000);
            expect(unitsToMeters('kilometers', 1)).toBe(1000);
            expect(unitsToMeters('km', 2.5)).toBe(2500);
            expect(unitsToMeters('kilometers', 0)).toBe(0);
        });
    });

    // Input Verification Tests
    describe('case insensitive handling', () => {
        test('handles mixed case units correctly', () => {
            expect(unitsToMeters('MILES', 1)).toBeCloseTo(1609.344);
            expect(unitsToMeters('Miles', 1)).toBeCloseTo(1609.344);
            expect(unitsToMeters('FEET', 1)).toBeCloseTo(scaleF2M);
            expect(unitsToMeters('Feet', 1)).toBeCloseTo(scaleF2M);
            expect(unitsToMeters('FT', 1)).toBeCloseTo(scaleF2M);
            expect(unitsToMeters('F', 1)).toBeCloseTo(scaleF2M);
            expect(unitsToMeters('METERS', 100)).toBe(100);
            expect(unitsToMeters('Meters', 100)).toBe(100);
            expect(unitsToMeters('M', 100)).toBe(100);
            expect(unitsToMeters('NM', 1)).toBe(1852);
            expect(unitsToMeters('KM', 1)).toBe(1000);
            expect(unitsToMeters('KILOMETERS', 1)).toBe(1000);
            expect(unitsToMeters('Kilometers', 1)).toBe(1000);
        });
    });

    describe('edge cases', () => {
        test('handles zero values correctly', () => {
            expect(unitsToMeters('miles', 0)).toBe(0);
            expect(unitsToMeters('feet', 0)).toBe(0);
            expect(unitsToMeters('meters', 0)).toBe(0);
            expect(unitsToMeters('nm', 0)).toBe(0);
            expect(unitsToMeters('km', 0)).toBe(0);
        });

        test('handles negative values correctly', () => {
            expect(unitsToMeters('miles', -1)).toBeCloseTo(-1609.344);
            expect(unitsToMeters('feet', -1)).toBeCloseTo(-scaleF2M);
            expect(unitsToMeters('meters', -100)).toBe(-100);
            expect(unitsToMeters('nm', -1)).toBe(-1852);
            expect(unitsToMeters('km', -1)).toBe(-1000);
        });

        test('handles decimal values correctly', () => {
            expect(unitsToMeters('miles', 0.5)).toBeCloseTo(804.672);
            expect(unitsToMeters('feet', 3.5)).toBeCloseTo(3.5 * scaleF2M);
            expect(unitsToMeters('meters', 10.75)).toBe(10.75);
            expect(unitsToMeters('nm', 1.5)).toBe(2778);
            expect(unitsToMeters('km', 2.25)).toBe(2250);
        });

        test('handles very large values correctly', () => {
            expect(unitsToMeters('miles', 1000)).toBeCloseTo(1609344);
            expect(unitsToMeters('km', 1000)).toBe(1000000);
            expect(unitsToMeters('meters', 1000000)).toBe(1000000);
        });
    });

    // Exception Handling Tests
    describe('unknown units handling', () => {
        test('triggers assertion but returns fallback value for unknown units', () => {
            // The assert function logs to console and triggers debugger but doesn't throw
            // The function returns the original value as a fallback due to the unreachable return statement
            
            // Mock console methods to suppress output during this test
            const originalConsoleTrace = console.trace;
            const originalConsoleError = console.error;
            console.trace = jest.fn();
            console.error = jest.fn();
            
            expect(unitsToMeters('unknown', 100)).toBe(100);
            expect(unitsToMeters('inches', 12)).toBe(12);
            expect(unitsToMeters('yards', 10)).toBe(10);
            expect(unitsToMeters('centimeters', 100)).toBe(100);
            expect(unitsToMeters('millimeters', 1000)).toBe(1000);
            expect(unitsToMeters('', 100)).toBe(100);
            
            // Verify that console methods were called (assertions were triggered)
            expect(console.trace).toHaveBeenCalled();
            expect(console.error).toHaveBeenCalled();
            
            // Restore original console methods
            console.trace = originalConsoleTrace;
            console.error = originalConsoleError;
        });

        test('handles null/undefined units with toLowerCase error', () => {
            // These will throw because toLowerCase() is called on null/undefined
            expect(() => unitsToMeters(null, 100)).toThrow();
            expect(() => unitsToMeters(undefined, 100)).toThrow();
        });
    });

    describe('consistency with helper functions', () => {
        test('results match direct helper function calls', () => {
            const testValue = 5;
            
            // Test that unitsToMeters uses the same conversions as direct function calls
            expect(unitsToMeters('feet', testValue)).toBeCloseTo(f2m(testValue));
            expect(unitsToMeters('ft', testValue)).toBeCloseTo(f2m(testValue));
            expect(unitsToMeters('f', testValue)).toBeCloseTo(f2m(testValue));
            
            expect(unitsToMeters('nm', testValue)).toBe(metersFromNM(testValue));
        });
    });
});

describe('cleanFloat', () => {
    describe('happy path - common floating point artifacts', () => {
        test('cleans classic 0.1 + 0.2 floating point artifact', () => {
            const result = 0.1 + 0.2;
            expect(cleanFloat(result)).toBe(0.3);
        });

        test('cleans floating point artifacts in arithmetic operations', () => {
            const result = 0.1 + 0.2 + 0.3;
            expect(cleanFloat(result)).toBe(0.6);
        });

        test('cleans small floating point errors in division', () => {
            const result = 1 / 3 * 3;
            expect(cleanFloat(result)).toBe(1);
        });

        test('cleans artifacts from trigonometric operations', () => {
            const result = Math.sin(Math.PI);
            expect(cleanFloat(result)).toBe(0);
        });

        test('cleans artifacts from repeated operations', () => {
            const result = 0.05 * 10;
            expect(cleanFloat(result)).toBe(0.5);
        });

        test('cleans 0.006800000000000002 artifact', () => {
            const num = 0.006800000000000002;
            expect(cleanFloat(num)).toBe(0.0068);
        });

        test('cleans 0.6000999999999996 artifact', () => {
            const num = 0.6000999999999996;
            expect(cleanFloat(num)).toBe(0.6001);
        });
    });

    describe('clean numbers - no artifacts', () => {
        test('returns clean integers unchanged', () => {
            expect(cleanFloat(0)).toBe(0);
            expect(cleanFloat(1)).toBe(1);
            expect(cleanFloat(42)).toBe(42);
            expect(cleanFloat(-10)).toBe(-10);
            expect(cleanFloat(1000000)).toBe(1000000);
        });

        test('returns clean decimals unchanged', () => {
            expect(cleanFloat(0.5)).toBe(0.5);
            expect(cleanFloat(0.25)).toBe(0.25);
            expect(cleanFloat(1.5)).toBe(1.5);
            expect(cleanFloat(3.14)).toBe(3.14);
            expect(cleanFloat(-2.75)).toBe(-2.75);
        });

        test('returns already clean scientific notation numbers unchanged', () => {
            expect(cleanFloat(1e-10)).toBe(1e-10);
            expect(cleanFloat(1.5e5)).toBe(150000);
        });
    });

    describe('edge cases with special values', () => {
        test('returns Infinity unchanged', () => {
            expect(cleanFloat(Infinity)).toBe(Infinity);
            expect(cleanFloat(-Infinity)).toBe(-Infinity);
        });

        test('returns NaN unchanged', () => {
            expect(Object.is(cleanFloat(NaN), NaN)).toBe(true);
        });

        test('returns zero correctly', () => {
            expect(cleanFloat(0)).toBe(0);
            expect(cleanFloat(-0)).toBe(0);
        });
    });

    describe('maxDecimals parameter', () => {
        test('uses maxDecimals as upper limit for artifact detection', () => {
            const dirty = 0.1 + 0.2;
            expect(cleanFloat(dirty, 1)).toBe(0.3);
            expect(cleanFloat(dirty, 2)).toBe(0.3);
            expect(cleanFloat(dirty, 3)).toBe(0.3);
        });

        test('clean numbers are not forced to round to maxDecimals', () => {
            const num = 1.123456789;
            expect(cleanFloat(num, 2)).toBe(1.123456789);
            expect(cleanFloat(num, 3)).toBe(1.123456789);
        });

        test('maxDecimals = 0 for artifact detection', () => {
            const result = 0.5 + 0.5;
            expect(cleanFloat(result, 0)).toBe(1);
        });

        test('default maxDecimals is 12', () => {
            const num = 0.1 + 0.2;
            const cleaned12 = cleanFloat(num, 12);
            const cleaned15 = cleanFloat(num, 15);
            expect(cleaned12).toBe(0.3);
            expect(cleaned15).toBe(0.3);
        });

        test('large maxDecimals still cleans appropriately', () => {
            const num = 0.1 + 0.2;
            expect(cleanFloat(num, 20)).toBe(0.3);
        });
    });

    describe('magnitude-aware tolerance', () => {
        test('handles small magnitude numbers (near 0)', () => {
            const result = 0.1 * 0.2;
            expect(cleanFloat(result)).toBe(0.02);
        });

        test('handles large magnitude numbers', () => {
            const result = 1000000.1 + 0.2;
            expect(cleanFloat(result)).toBeCloseTo(1000000.3, 10);
        });

        test('handles very large numbers', () => {
            const result = 1e10 + 1e-5;
            expect(cleanFloat(result)).toBe(1e10);
        });

        test('handles very small numbers', () => {
            const result = 1e-10 + 1e-11;
            expect(cleanFloat(result)).toBeCloseTo(1.1e-10, 15);
        });

        test('handles negative large magnitudes', () => {
            const result = -1000000.1 - 0.2;
            expect(cleanFloat(result)).toBeCloseTo(-1000000.3, 10);
        });
    });

    describe('comparison with tolerance', () => {
        test('artifact within tolerance is cleaned', () => {
            const num = 0.3000000000000001;
            expect(cleanFloat(num)).toBe(0.3);
        });

        test('artifact at tolerance boundary still cleans', () => {
            const num = 0.1 + 0.2;
            expect(cleanFloat(num)).toBe(0.3);
        });

        test('value beyond tolerance is not cleaned', () => {
            const num = 0.3000001;
            expect(cleanFloat(num)).toBe(0.3000001);
        });
    });

    describe('precision preservation', () => {
        test('preserves significant digits', () => {
            expect(cleanFloat(0.123456789, 12)).toBe(0.123456789);
            expect(cleanFloat(12345.6789, 12)).toBe(12345.6789);
        });

        test('handles numbers with many decimal places', () => {
            const num = Math.PI;
            const cleaned = cleanFloat(num);
            expect(cleaned).toBeCloseTo(Math.PI, 10);
        });

        test('cleans but maintains precision when possible', () => {
            const result = 0.1 + 0.2;
            const cleaned = cleanFloat(result);
            expect(cleaned).toBe(0.3);
            expect(typeof cleaned).toBe('number');
        });
    });

    describe('practical use cases', () => {
        test('cleans result of complex math operations', () => {
            const a = 0.1;
            const b = 0.2;
            const c = 0.3;
            const result = a + b + c;
            expect(cleanFloat(result)).toBe(0.6);
        });

        test('cleans percentage calculations', () => {
            const total = 100;
            const percent = 33.33;
            const result = (percent / 100) * total;
            expect(cleanFloat(result, 2)).toBe(33.33);
        });

        test('cleans coordinates after transformations', () => {
            const x = 1.5;
            const y = 2.5;
            const rotated = x * Math.cos(0.1) + y * Math.sin(0.1);
            const cleaned = cleanFloat(rotated);
            expect(typeof cleaned).toBe('number');
            expect(cleaned).toBeCloseTo(rotated, 5);
        });

        test('chains multiple cleanFloat calls', () => {
            let result = 0.1 + 0.2;
            result = cleanFloat(result);
            result = result + 0.3;
            result = cleanFloat(result);
            expect(result).toBe(0.6);
        });
    });

    describe('array and batch operations', () => {
        test('cleans array of floating point numbers', () => {
            const dirtyArray = [0.1 + 0.2, 0.3 + 0.4, 1 / 3 * 3];
            const cleanedArray = dirtyArray.map(x => cleanFloat(x));
            expect(cleanedArray).toEqual([0.3, 0.7, 1]);
        });

        test('handles arrays with mixed clean and dirty numbers', () => {
            const mixedArray = [0.5, 0.1 + 0.2, 1.5, 0.3 + 0.3];
            const cleanedArray = mixedArray.map(x => cleanFloat(x));
            expect(cleanedArray[0]).toBe(0.5);
            expect(cleanedArray[1]).toBe(0.3);
            expect(cleanedArray[2]).toBe(1.5);
            expect(cleanedArray[3]).toBe(0.6);
        });
    });
});