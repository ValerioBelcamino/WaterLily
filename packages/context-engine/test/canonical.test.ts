import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256 } from '../src/index.js';

describe('canonical JSON and hashing', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(
      canonicalJson({ z: 1, a: { y: true, x: null }, list: [3, 'two'] }),
    ).toBe('{"a":{"x":null,"y":true},"list":[3,"two"],"z":1}');
  });

  it('produces the standard SHA-256 digest', async () => {
    await expect(sha256('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('rejects unsupported and non-finite values', () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ value: undefined })).toThrow(TypeError);
  });
});
