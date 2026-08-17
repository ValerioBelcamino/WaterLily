import { describe, expect, it } from 'vitest';

import {
  MAX_DROPPED_FILE_BYTES,
  MAX_DROPPED_FILES,
  prepareDroppedFiles,
} from './fileDrop';

describe('dropped-file preparation', () => {
  it('accepts supported native attachments without reading their contents', async () => {
    const markdown = new File(['# Notes'], 'notes.md', {
      lastModified: 123,
      type: 'text/markdown; charset=utf-8',
    });
    const document = new File(['document'], 'paper.pdf', {
      lastModified: 456,
      type: 'application/pdf',
    });
    const extensionFallback = new File(['x'], 'module.py', {
      lastModified: 789,
    });

    const files = await prepareDroppedFiles([
      markdown,
      document,
      extensionFallback,
    ]);

    expect(files).toEqual([
      {
        file: markdown,
        lastModified: 123,
        mediaType: 'text/markdown',
        name: 'notes.md',
        size: 7,
      },
      {
        file: document,
        lastModified: 456,
        mediaType: 'application/pdf',
        name: 'paper.pdf',
        size: 8,
      },
      {
        file: extensionFallback,
        lastModified: 789,
        mediaType: 'application/octet-stream',
        name: 'module.py',
        size: 1,
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
    [[new File(['program'], 'program.exe')], 'UNSUPPORTED_TYPE'],
    [[new File(['unknown'], 'README')], 'UNSUPPORTED_TYPE'],
    [[new File([], 'empty.txt', { type: 'text/plain' })], 'EMPTY_FILE'],
  ])('rejects invalid input with a typed %s result', async (files, code) => {
    await expect(prepareDroppedFiles(files)).rejects.toMatchObject({ code });
  });
});
