import {abs, acos, asin, atan, atan2, cos, degrees, floor, radians, sin, tan} from '../src/mathUtils.js';

describe('mathUtils', () => {
    describe('radians', () => {
        test('converts 0 degrees to 0 radians', () => {
            expect(radians(0)).toBe(0);
        });

        test('converts 180 degrees to PI radians', () => {
            expect(radians(180)).toBeCloseTo(Math.PI, 10);
        });

        test('converts 90 degrees to PI/2 radians', () => {
            expect(radians(90)).toBeCloseTo(Math.PI / 2, 10);
        });

        test('converts 360 degrees to 2*PI radians', () => {
            expect(radians(360)).toBeCloseTo(2 * Math.PI, 10);
        });

        test('converts negative degrees correctly', () => {
            expect(radians(-90)).toBeCloseTo(-Math.PI / 2, 10);
        });

        test('converts 45 degrees correctly', () => {
            expect(radians(45)).toBeCloseTo(Math.PI / 4, 10);
        });

        test('handles fractional degrees', () => {
            expect(radians(30)).toBeCloseTo(Math.PI / 6, 10);
        });
    });

    describe('degrees', () => {
        test('converts 0 radians to 0 degrees', () => {
            expect(degrees(0)).toBe(0);
        });

        test('converts PI radians to 180 degrees', () => {
            expect(degrees(Math.PI)).toBeCloseTo(180, 10);
        });

        test('converts PI/2 radians to 90 degrees', () => {
            expect(degrees(Math.PI / 2)).toBeCloseTo(90, 10);
        });

        test('converts 2*PI radians to 360 degrees', () => {
            expect(degrees(2 * Math.PI)).toBeCloseTo(360, 10);
        });

        test('converts negative radians correctly', () => {
            expect(degrees(-Math.PI / 2)).toBeCloseTo(-90, 10);
        });

        test('converts PI/4 radians to 45 degrees', () => {
            expect(degrees(Math.PI / 4)).toBeCloseTo(45, 10);
        });
    });

    describe('radians and degrees round-trip', () => {
        test('radians(degrees(x)) returns x', () => {
            const testValues = [0, 1, 45, 90, 180, 270, 360, -45, -90];
            testValues.forEach(deg => {
                expect(degrees(radians(deg))).toBeCloseTo(deg, 10);
            });
        });

        test('degrees(radians(x)) returns x', () => {
            const testValues = [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI];
            testValues.forEach(rad => {
                expect(radians(degrees(rad))).toBeCloseTo(rad, 10);
            });
        });
    });

    describe('trigonometric wrappers', () => {
        test('sin matches Math.sin', () => {
            const values = [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, Math.PI];
            values.forEach(v => {
                expect(sin(v)).toBe(Math.sin(v));
            });
        });

        test('cos matches Math.cos', () => {
            const values = [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, Math.PI];
            values.forEach(v => {
                expect(cos(v)).toBe(Math.cos(v));
            });
        });

        test('tan matches Math.tan', () => {
            const values = [0, Math.PI / 6, Math.PI / 4];
            values.forEach(v => {
                expect(tan(v)).toBe(Math.tan(v));
            });
        });

        test('asin matches Math.asin', () => {
            const values = [0, 0.5, 1, -0.5, -1];
            values.forEach(v => {
                expect(asin(v)).toBe(Math.asin(v));
            });
        });

        test('acos matches Math.acos', () => {
            const values = [0, 0.5, 1, -0.5, -1];
            values.forEach(v => {
                expect(acos(v)).toBe(Math.acos(v));
            });
        });

        test('atan matches Math.atan', () => {
            const values = [0, 1, -1, 100];
            values.forEach(v => {
                expect(atan(v)).toBe(Math.atan(v));
            });
        });

        test('atan2 matches Math.atan2', () => {
            const pairs = [[0, 1], [1, 0], [1, 1], [-1, 1], [1, -1]];
            pairs.forEach(([y, x]) => {
                expect(atan2(y, x)).toBe(Math.atan2(y, x));
            });
        });
    });

    describe('utility wrappers', () => {
        test('abs matches Math.abs', () => {
            expect(abs(5)).toBe(5);
            expect(abs(-5)).toBe(5);
            expect(abs(0)).toBe(0);
            expect(abs(-3.14)).toBe(3.14);
        });

        test('floor matches Math.floor', () => {
            expect(floor(5.9)).toBe(5);
            expect(floor(5.1)).toBe(5);
            expect(floor(5)).toBe(5);
            expect(floor(-5.1)).toBe(-6);
            expect(floor(-5.9)).toBe(-6);
        });
    });
});
