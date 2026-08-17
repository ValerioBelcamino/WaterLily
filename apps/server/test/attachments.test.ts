import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileAttachmentStore } from '../src/attachments.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'waterlily-attachments-'));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { force: true, recursive: true });
});

describe('file attachment store', () => {
  it('round-trips bytes through user-only files with integrity metadata', () => {
    const root = temporaryDirectory();
    const store = new FileAttachmentStore(root);
    const bytes = new TextEncoder().encode('private study notes');

    const descriptor = store.put({
      bytes,
      mediaType: 'text/plain',
      name: 'notes.txt',
    });

    expect(descriptor).toMatchObject({
      mediaType: 'text/plain',
      name: 'notes.txt',
      size: bytes.byteLength,
    });
    expect(descriptor.id).toMatch(/^attachment-[0-9a-f-]{36}$/u);
    expect(descriptor.sha256).toMatch(/^[0-9a-f]{64}$/u);
    const loaded = store.get(descriptor.id);
    expect({ ...loaded, bytes: Array.from(loaded.bytes) }).toEqual({
      bytes: Array.from(bytes),
      mediaType: 'text/plain',
      name: 'notes.txt',
    });
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, `${descriptor.id}.blob`)).mode & 0o777).toBe(
      0o600,
    );
    expect(statSync(join(root, `${descriptor.id}.json`)).mode & 0o777).toBe(
      0o600,
    );
  });

  it('rejects unsafe identifiers and tampered blobs or metadata', () => {
    const root = temporaryDirectory();
    const store = new FileAttachmentStore(root);
    expect(() => store.get('../credential')).toThrow('Invalid attachment id');

    const first = store.put({
      bytes: new Uint8Array([1, 2]),
      mediaType: 'application/pdf',
      name: 'paper.pdf',
    });
    writeFileSync(join(root, `${first.id}.blob`), new Uint8Array([3, 4]));
    expect(() => store.get(first.id)).toThrow('integrity check');

    const second = store.put({
      bytes: new Uint8Array([5]),
      mediaType: 'image/png',
      name: 'diagram.png',
    });
    const metadataPath = join(root, `${second.id}.json`);
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as object;
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, size: -1 }));
    chmodSync(metadataPath, 0o600);
    expect(() => store.get(second.id)).toThrow('metadata is invalid');
  });
});
