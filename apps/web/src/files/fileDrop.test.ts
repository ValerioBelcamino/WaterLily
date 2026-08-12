import { describe, expect, it } from 'vitest';

import {
  MAX_DROPPED_FILE_BYTES,
  MAX_DROPPED_FILES,
  prepareDroppedFiles,
} from './fileDrop';

describe('dropped-file preparation', () => {
  it('reads supported Unicode text and strips a byte-order mark', async () => {
    const byteOrderMarked = new File(['placeholder'], 'notes.md', {
      lastModified: 123,
      type: 'text/markdown',
    });
    Object.defineProperty(byteOrderMarked, 'text', {
      value: () => Promise.resolve('\uFEFF# Notes\n\nλ = 2'),
    });
    const files = await prepareDroppedFiles([
      byteOrderMarked,
      new File(['{"ready":true}'], 'data.json', { lastModified: 456 }),
      new File(['<svg/>'], 'drawing.svg', {
        lastModified: 789,
        type: 'image/svg+xml',
      }),
    ]);

    expect(files).toEqual([
      {
        lastModified: 123,
        mediaType: 'text/markdown',
        name: 'notes.md',
        size: 11,
        text: '# Notes\n\nλ = 2',
      },
      {
        lastModified: 456,
        mediaType: 'text/plain',
        name: 'data.json',
        size: 14,
        text: '{"ready":true}',
      },
      {
        lastModified: 789,
        mediaType: 'image/svg+xml',
        name: 'drawing.svg',
        size: 6,
        text: '<svg/>',
      },
    ]);
  });

  it.each([
    [[], 'NO_FILES'],
    [
      Array.from(
        { length: MAX_DROPPED_FILES + 1 },
        (_, index) => new File(['x'], `${String(index)}.txt`),
      ),
      'TOO_MANY_FILES',
    ],
    [
      [new File(['x'.repeat(MAX_DROPPED_FILE_BYTES + 1)], 'large.txt')],
      'FILE_TOO_LARGE',
    ],
    [
      [new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })],
      'UNSUPPORTED_TYPE',
    ],
    [[new File(['unknown'], 'README')], 'UNSUPPORTED_TYPE'],
    [
      [new File(['text\0binary'], 'bad.txt', { type: 'text/plain' })],
      'BINARY_FILE',
    ],
    [[new File(['  \n'], 'empty.txt', { type: 'text/plain' })], 'EMPTY_FILE'],
  ])('rejects unsafe input with a typed %s result', async (files, code) => {
    await expect(prepareDroppedFiles(files)).rejects.toMatchObject({ code });
  });

  it('wraps browser read failures without exposing their details', async () => {
    const file = new File(['hidden'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      value: () => Promise.reject(new Error('private browser diagnostic')),
    });

    await expect(prepareDroppedFiles([file])).rejects.toMatchObject({
      code: 'READ_FAILED',
      message: 'notes.txt could not be read.',
    });
  });
});
