// tests/unit/typeGuards.test.ts
import { describe, it, expect } from 'vitest';
import {
  isRecord,
  hasStringProperty,
  isJsonValue,
  assertDefined,
  narrowArray,
  isStringArray,
  isRecordOf,
} from '../../src/shared/typeGuards';

describe('isRecord', () => {
  it('should return true for plain objects', () => {
    expect(isRecord({ a: 1 })).toBe(true);
  });
  it('should return false for null', () => {
    expect(isRecord(null)).toBe(false);
  });
  it('should return false for arrays', () => {
    expect(isRecord([1, 2])).toBe(false);
  });
  it('should return false for strings', () => {
    expect(isRecord('hello')).toBe(false);
  });
});

describe('hasStringProperty', () => {
  it('should return true when property exists and is string', () => {
    expect(hasStringProperty({ name: 'test' }, 'name')).toBe(true);
  });
  it('should return false when property is not a string', () => {
    expect(hasStringProperty({ name: 42 }, 'name')).toBe(false);
  });
});

describe('isJsonValue', () => {
  it('should return true for primitives', () => {
    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue('str')).toBe(true);
    expect(isJsonValue(42)).toBe(true);
    expect(isJsonValue(true)).toBe(true);
  });
  it('should return true for valid JSON structures', () => {
    expect(isJsonValue({ a: [1, 'b', null] })).toBe(true);
  });
  it('should return false for functions', () => {
    expect(isJsonValue(() => {})).toBe(false);
  });
});

describe('assertDefined', () => {
  it('should not throw for defined values', () => {
    expect(() => assertDefined('hello')).not.toThrow();
  });
  it('should throw for undefined', () => {
    expect(() => assertDefined(undefined)).toThrow();
  });
  it('should throw for null', () => {
    expect(() => assertDefined(null)).toThrow();
  });
  it('should include custom message', () => {
    expect(() => assertDefined(undefined, 'custom')).toThrow('custom');
  });
});

describe('narrowArray', () => {
  it('should filter array with guard', () => {
    const result = narrowArray([1, 'a', 2, 'b'], (v): v is string => typeof v === 'string');
    expect(result).toEqual(['a', 'b']);
  });
  it('should return empty for non-array', () => {
    expect(narrowArray('not array', (v): v is string => typeof v === 'string')).toEqual([]);
  });
});

describe('isStringArray', () => {
  it('should return true for string arrays', () => {
    expect(isStringArray(['a', 'b'])).toBe(true);
  });
  it('should return false for mixed arrays', () => {
    expect(isStringArray(['a', 1])).toBe(false);
  });
  it('should return false for non-arrays', () => {
    expect(isStringArray('not array')).toBe(false);
  });
});

describe('isRecordOf', () => {
  it('should return true when all values match guard', () => {
    expect(isRecordOf({ a: 1, b: 2 }, (v): v is number => typeof v === 'number')).toBe(true);
  });
  it('should return false when some values fail guard', () => {
    expect(isRecordOf({ a: 1, b: 'x' }, (v): v is number => typeof v === 'number')).toBe(false);
  });
});
