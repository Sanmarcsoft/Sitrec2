import CSV from '../src/utils/CSVParser.js';

describe('CSVParser', () => {
    describe('toArrays', () => {
        test('parses simple CSV', () => {
            const result = CSV.toArrays('a,b,c\n1,2,3');
            expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
        });

        test('handles empty input', () => {
            expect(CSV.toArrays('')).toEqual([]);
            expect(CSV.toArrays('   ')).toEqual([]);
        });

        test('handles single row', () => {
            expect(CSV.toArrays('a,b,c')).toEqual([['a', 'b', 'c']]);
        });

        test('handles quoted fields', () => {
            expect(CSV.toArrays('"hello",world')).toEqual([['hello', 'world']]);
        });

        test('handles quoted fields with commas inside', () => {
            expect(CSV.toArrays('"a,b",c')).toEqual([['a,b', 'c']]);
        });

        test('handles escaped quotes (doubled)', () => {
            expect(CSV.toArrays('"say ""hello""",world')).toEqual([['say "hello"', 'world']]);
        });

        test('handles multiple rows with different line endings', () => {
            expect(CSV.toArrays('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
            expect(CSV.toArrays('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
            expect(CSV.toArrays('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
        });

        test('handles trailing empty lines', () => {
            expect(CSV.toArrays('a,b\nc,d\n\n')).toEqual([['a', 'b'], ['c', 'd']]);
        });

        test('handles empty fields', () => {
            expect(CSV.toArrays('a,,c')).toEqual([['a', '', 'c']]);
            expect(CSV.toArrays(',b,')).toEqual([['', 'b', '']]);
        });

        test('throws on non-string input', () => {
            expect(() => CSV.toArrays(123)).toThrow('CSV data must be a string');
            expect(() => CSV.toArrays(null)).toThrow('CSV data must be a string');
        });

        test('handles custom separator', () => {
            expect(CSV.toArrays('a;b;c', { separator: ';' })).toEqual([['a', 'b', 'c']]);
        });

        test('handles numeric values as strings', () => {
            expect(CSV.toArrays('1,2.5,-3')).toEqual([['1', '2.5', '-3']]);
        });
    });

    describe('toObjects', () => {
        test('converts CSV to array of objects using headers', () => {
            const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
            const result = CSV.toObjects(csv);
            expect(result).toEqual([
                { name: 'Alice', age: '30', city: 'NYC' },
                { name: 'Bob', age: '25', city: 'LA' }
            ]);
        });

        test('returns empty array for single row (headers only)', () => {
            expect(CSV.toObjects('a,b,c')).toEqual([]);
        });

        test('returns empty array for empty input', () => {
            expect(CSV.toObjects('')).toEqual([]);
        });

        test('handles rows with fewer columns than headers', () => {
            const csv = 'a,b,c\n1,2';
            const result = CSV.toObjects(csv);
            expect(result).toEqual([{ a: '1', b: '2' }]);
        });

        test('handles quoted values', () => {
            const csv = 'name,location\n"John Doe","New York, NY"';
            const result = CSV.toObjects(csv);
            expect(result).toEqual([{ name: 'John Doe', location: 'New York, NY' }]);
        });
    });

    describe('fromArrays', () => {
        test('converts array of arrays to CSV string', () => {
            const data = [['a', 'b', 'c'], ['1', '2', '3']];
            const result = CSV.fromArrays(data);
            expect(result).toBe('a,b,c\r\n1,2,3');
        });

        test('handles empty array', () => {
            expect(CSV.fromArrays([])).toBe('');
        });

        test('quotes fields containing commas', () => {
            const data = [['hello, world', 'test']];
            expect(CSV.fromArrays(data)).toBe('"hello, world",test');
        });

        test('quotes fields containing quotes and escapes them', () => {
            const data = [['say "hello"', 'test']];
            expect(CSV.fromArrays(data)).toBe('"say ""hello""",test');
        });

        test('quotes fields containing newlines', () => {
            const data = [['line1\nline2', 'test']];
            expect(CSV.fromArrays(data)).toBe('"line1\nline2",test');
        });

        test('handles null and undefined values', () => {
            const data = [[null, undefined, 'test']];
            expect(CSV.fromArrays(data)).toBe(',,test');
        });

        test('handles numeric values', () => {
            const data = [[1, 2.5, -3]];
            expect(CSV.fromArrays(data)).toBe('1,2.5,-3');
        });

        test('throws on non-array input', () => {
            expect(() => CSV.fromArrays('not an array')).toThrow('Input data must be an array');
        });

        test('throws on non-array rows', () => {
            expect(() => CSV.fromArrays(['not', 'arrays'])).toThrow('Each row must be an array');
        });

        test('handles custom separator', () => {
            const data = [['a', 'b', 'c']];
            expect(CSV.fromArrays(data, { separator: ';' })).toBe('a;b;c');
        });
    });

    describe('fromObjects', () => {
        test('converts array of objects to CSV string', () => {
            const data = [
                { name: 'Alice', age: '30' },
                { name: 'Bob', age: '25' }
            ];
            const result = CSV.fromObjects(data);
            expect(result).toBe('name,age\r\nAlice,30\r\nBob,25');
        });

        test('returns empty string for empty array', () => {
            expect(CSV.fromObjects([])).toBe('');
        });

        test('handles objects with different keys', () => {
            const data = [
                { a: '1', b: '2' },
                { b: '3', c: '4' }
            ];
            const result = CSV.fromObjects(data);
            expect(result).toContain('a,b,c');
            expect(result).toContain('1,2,');
            expect(result).toContain(',3,4');
        });

        test('handles values needing quoting', () => {
            const data = [{ name: 'John, Jr.', city: 'NYC' }];
            const result = CSV.fromObjects(data);
            expect(result).toContain('"John, Jr."');
        });

        test('handles undefined values in objects', () => {
            const data = [{ a: '1', b: undefined }];
            const result = CSV.fromObjects(data);
            expect(result).toBe('a,b\r\n1,');
        });
    });

    describe('round-trip', () => {
        test('toArrays -> fromArrays preserves data', () => {
            const original = 'a,b,c\n1,2,3\n4,5,6';
            const arrays = CSV.toArrays(original);
            const result = CSV.fromArrays(arrays);
            const reparsed = CSV.toArrays(result);
            expect(reparsed).toEqual(arrays);
        });

        test('toObjects -> fromObjects preserves data', () => {
            const original = 'name,value\ntest,123';
            const objects = CSV.toObjects(original);
            const result = CSV.fromObjects(objects);
            const reparsed = CSV.toObjects(result);
            expect(reparsed).toEqual(objects);
        });
    });
});
