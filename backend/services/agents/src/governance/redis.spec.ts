import { describe, expect, it } from 'vitest';
import { parse } from './redis.js';

describe('RESP2 parser', () => {
  const p = (s: string) => parse(Buffer.from(s), 0);
  it('parses simple types', () => {
    expect(p('+OK\r\n')).toEqual({ value: 'OK', end: 5 });
    expect(p(':42\r\n')?.value).toBe(42);
    expect(p('$-1\r\n')?.value).toBeNull();
    expect(p('$3\r\nabc\r\n')?.value).toBe('abc');
    expect(p('-ERR wrong\r\n')?.value).toBeInstanceOf(Error);
  });
  it('waits for incomplete replies', () => {
    expect(p('$5\r\nab')).toBeUndefined();
    expect(p('*2\r\n:1\r\n')).toBeUndefined();
  });
  it('parses arrays', () => {
    expect(p('*2\r\n$1\r\na\r\n:2\r\n')?.value).toEqual(['a', 2]);
  });
});
