import { describe, expect, it } from 'vitest';

import { DatabaseError } from '../src/index.js';

describe('database errors', () => {
  it('defaults details without losing the native error cause', () => {
    const cause = new Error('native failure');
    const error = new DatabaseError('PERSISTENCE_FAILED', 'Could not write', {
      cause,
    });

    expect(error.name).toBe('DatabaseError');
    expect(error.details).toEqual({});
    expect(error.cause).toBe(cause);
  });
});
