import {hexColor, intersectSphere2, MV3, perpendicularVector, V2, V3} from '../src/threeUtils.js';
import {Color, Ray, Sphere, Vector2, Vector3} from 'three';

describe('V2', () => {
    test('creates Vector2 with default values', () => {
        const v = V2();
        expect(v).toBeInstanceOf(Vector2);
        expect(v.x).toBe(0);
        expect(v.y).toBe(0);
    });

    test('creates Vector2 with specified values', () => {
        const v = V2(3, 4);
        expect(v.x).toBe(3);
        expect(v.y).toBe(4);
    });

    test('creates Vector2 with negative values', () => {
        const v = V2(-1.5, -2.5);
        expect(v.x).toBe(-1.5);
        expect(v.y).toBe(-2.5);
    });
});

describe('V3', () => {
    test('creates Vector3 with default values', () => {
        const v = V3();
        expect(v).toBeInstanceOf(Vector3);
        expect(v.x).toBe(0);
        expect(v.y).toBe(0);
        expect(v.z).toBe(0);
    });

    test('creates Vector3 with specified values', () => {
        const v = V3(1, 2, 3);
        expect(v.x).toBe(1);
        expect(v.y).toBe(2);
        expect(v.z).toBe(3);
    });

    test('creates Vector3 with negative values', () => {
        const v = V3(-1, -2, -3);
        expect(v.x).toBe(-1);
        expect(v.y).toBe(-2);
        expect(v.z).toBe(-3);
    });

    test('creates Vector3 with partial arguments', () => {
        const v = V3(5);
        expect(v.x).toBe(5);
        expect(v.y).toBe(0);
        expect(v.z).toBe(0);
    });
});

describe('MV3', () => {
    test('creates Vector3 from three numbers', () => {
        const v = MV3(1, 2, 3);
        expect(v).toBeInstanceOf(Vector3);
        expect(v.x).toBe(1);
        expect(v.y).toBe(2);
        expect(v.z).toBe(3);
    });

    test('creates Vector3 from array', () => {
        const v = MV3([4, 5, 6]);
        expect(v.x).toBe(4);
        expect(v.y).toBe(5);
        expect(v.z).toBe(6);
    });

    test('creates Vector3 from Vector3-like object', () => {
        const source = new Vector3(7, 8, 9);
        const v = MV3(source);
        expect(v.x).toBe(7);
        expect(v.y).toBe(8);
        expect(v.z).toBe(9);
        expect(v).not.toBe(source);
    });

    test('creates Vector3 from object with x,y,z', () => {
        const obj = { x: 10, y: 11, z: 12 };
        const v = MV3(obj);
        expect(v.x).toBe(10);
        expect(v.y).toBe(11);
        expect(v.z).toBe(12);
    });

    test('creates Vector3 with default values', () => {
        const v = MV3();
        expect(v.x).toBe(0);
        expect(v.y).toBe(0);
        expect(v.z).toBe(0);
    });
});

describe('perpendicularVector', () => {
    test('returns perpendicular vector to X axis', () => {
        const N = V3(1, 0, 0);
        const P = perpendicularVector(N);
        expect(N.dot(P)).toBeCloseTo(0, 10);
    });

    test('returns perpendicular vector to Y axis', () => {
        const N = V3(0, 1, 0);
        const P = perpendicularVector(N);
        expect(N.dot(P)).toBeCloseTo(0, 10);
    });

    test('returns perpendicular vector to Z axis', () => {
        const N = V3(0, 0, 1);
        const P = perpendicularVector(N);
        expect(N.dot(P)).toBeCloseTo(0, 10);
    });

    test('returns perpendicular vector to arbitrary vector', () => {
        const N = V3(1, 2, 3);
        const P = perpendicularVector(N);
        expect(N.dot(P)).toBeCloseTo(0, 10);
    });

    test('returns perpendicular vector to negative vector', () => {
        const N = V3(-1, -1, -1);
        const P = perpendicularVector(N);
        expect(N.dot(P)).toBeCloseTo(0, 10);
    });

    test('result is non-zero', () => {
        const testVectors = [
            V3(1, 0, 0),
            V3(0, 1, 0),
            V3(0, 0, 1),
            V3(1, 1, 1),
            V3(1, 2, 3)
        ];
        testVectors.forEach(N => {
            const P = perpendicularVector(N);
            expect(P.length()).toBeGreaterThan(0);
        });
    });
});

describe('intersectSphere2', () => {
    test('detects intersection with sphere', () => {
        const sphere = new Sphere(V3(0, 0, 0), 1);
        const ray = new Ray(V3(-5, 0, 0), V3(1, 0, 0));
        const target0 = V3();
        const target1 = V3();
        
        const result = intersectSphere2(ray, sphere, target0, target1);
        expect(result).toBe(true);
        expect(target0.x).toBeCloseTo(-1, 5);
        expect(target1.x).toBeCloseTo(1, 5);
    });

    test('returns false for miss', () => {
        const sphere = new Sphere(V3(0, 0, 0), 1);
        const ray = new Ray(V3(-5, 5, 0), V3(1, 0, 0));
        const target0 = V3();
        
        const result = intersectSphere2(ray, sphere, target0);
        expect(result).toBe(false);
    });

    test('handles ray starting inside sphere', () => {
        const sphere = new Sphere(V3(0, 0, 0), 10);
        const ray = new Ray(V3(0, 0, 0), V3(1, 0, 0));
        const target0 = V3();
        const target1 = V3();
        
        const result = intersectSphere2(ray, sphere, target0, target1);
        expect(result).toBe(true);
        expect(target0.x).toBeCloseTo(10, 5);
    });

    test('handles tangent ray', () => {
        const sphere = new Sphere(V3(0, 0, 0), 1);
        const ray = new Ray(V3(-5, 1, 0), V3(1, 0, 0));
        const target0 = V3();
        
        const result = intersectSphere2(ray, sphere, target0);
        expect(result).toBe(true);
        expect(target0.y).toBeCloseTo(1, 5);
    });

    test('handles sphere at offset position', () => {
        const sphere = new Sphere(V3(10, 0, 0), 1);
        const ray = new Ray(V3(0, 0, 0), V3(1, 0, 0));
        const target0 = V3();
        const target1 = V3();
        
        const result = intersectSphere2(ray, sphere, target0, target1);
        expect(result).toBe(true);
        expect(target0.x).toBeCloseTo(9, 5);
        expect(target1.x).toBeCloseTo(11, 5);
    });

    test('returns false when sphere is behind ray', () => {
        const sphere = new Sphere(V3(-10, 0, 0), 1);
        const ray = new Ray(V3(0, 0, 0), V3(1, 0, 0));
        const target0 = V3();
        
        const result = intersectSphere2(ray, sphere, target0);
        expect(result).toBe(false);
    });

    test('works with large sphere (earth-like)', () => {
        const earthRadius = 6378137;
        const sphere = new Sphere(V3(0, -earthRadius, 0), earthRadius);
        const ray = new Ray(V3(0, 1000, 0), V3(0, -1, 0));
        const target0 = V3();
        
        const result = intersectSphere2(ray, sphere, target0);
        expect(result).toBe(true);
        expect(target0.y).toBeCloseTo(0, 0);
    });
});

describe('hexColor', () => {
    test('converts Color object to hex string', () => {
        const color = new Color(1, 0, 0);
        expect(hexColor(color)).toBe('#ff0000');
    });

    test('converts hex number to hex string', () => {
        expect(hexColor(0xff0000)).toBe('#ff0000');
        expect(hexColor(0x00ff00)).toBe('#00ff00');
        expect(hexColor(0x0000ff)).toBe('#0000ff');
    });

    test('converts color string to hex string', () => {
        expect(hexColor('red')).toBe('#ff0000');
        expect(hexColor('green')).toBe('#008000');
        expect(hexColor('blue')).toBe('#0000ff');
    });

    test('handles white and black', () => {
        expect(hexColor(0xffffff)).toBe('#ffffff');
        expect(hexColor(0x000000)).toBe('#000000');
    });

    test('handles fractional Color values', () => {
        const color = new Color(0.5, 0.5, 0.5);
        const hex = hexColor(color);
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    });
});
